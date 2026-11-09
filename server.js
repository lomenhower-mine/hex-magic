import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.static("."));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const players = new Map();
const zombies = new Map();

let phase = "idle"; // idle, countdown, playing, intermission, gameover, won
let countdown = 0;
let wave = 0;
let intermission = 0;
let kills = 0;
let lastTick = Date.now();

function send(socket, data) {
  if (socket.readyState === 1) socket.send(JSON.stringify(data));
}

function getState() {
  return {
    type: "state",
    phase,
    countdown,
    wave,
    intermission,
    kills,
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      z: p.z,
      health: p.health,
      coins: p.coins,
      level: p.level,
      alive: p.alive
    })),
    zombies: [...zombies.values()].map((z) => ({
      id: z.id,
      x: z.x,
      z: z.z,
      hp: z.hp,
      maxHp: z.maxHp
    }))
  };
}

function broadcastState() {
  const message = JSON.stringify(getState());
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

function startCountdown() {
  phase = "countdown";
  countdown = 20;
  wave = 0;
  kills = 0;
  zombies.clear();

  for (const p of players.values()) {
    p.health = 100;
    p.coins = 50;
    p.level = 1;
    p.alive = true;
    p.x = (Math.random() - 0.5) * 6;
    p.z = (Math.random() - 0.5) * 6;
  }
}

function spawnWave() {
  wave += 1;
  phase = "playing";

  const zombieCount = 3 + wave * 2;
  const maxHp = 45 + wave * 18;
  const speed = 1.1 + wave * 0.075;

  for (let i = 0; i < zombieCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 18 + Math.random() * 12;
    zombies.set(randomUUID(), {
      id: randomUUID(),
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      hp: maxHp,
      maxHp,
      speed,
      nextHit: 0
    });
  }
}

function endMatch(result) {
  phase = result;
  zombies.clear();
}

function livingPlayers() {
  return [...players.values()].filter((p) => p.alive);
}

function handleMessage(socket, player, data) {
  if (!data || typeof data.type !== "string") return;

  if (data.type === "join") {
    if (phase === "gameover" || phase === "won") {
      players.clear();
      zombies.clear();
      phase = "idle";
    }

    if (phase === "idle") {
      players.set(player.id, player);
      startCountdown();
    } else if (phase === "countdown") {
      players.set(player.id, player);
    }

    broadcastState();
    return;
  }

  if (data.type === "move" && players.has(player.id)) {
    const x = Number(data.x);
    const z = Number(data.z);

    if (Number.isFinite(x) && Number.isFinite(z)) {
      player.x = Math.max(-38, Math.min(38, x));
      player.z = Math.max(-38, Math.min(38, z));
    }
    return;
  }

  if (data.type === "upgrade" && players.has(player.id)) {
    if (phase !== "playing" && phase !== "intermission") return;

    const cost = player.level * 100;
    if (player.coins >= cost && player.level < 6) {
      player.coins -= cost;
      player.level += 1;
      broadcastState();
    }
    return;
  }

  if (data.type === "attack" && players.has(player.id) && phase === "playing") {
    const now = Date.now();
    if (now - (player.lastAttack || 0) < 250) return;
    player.lastAttack = now;

    const isSword = data.weapon === "sword";
    const range = isSword ? 3.2 : 24;
    const damage = (isSword ? 35 : 24) * player.level;

    let target = null;
    let bestDistance = range;

    for (const zombie of zombies.values()) {
      const distance = Math.hypot(zombie.x - player.x, zombie.z - player.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = zombie;
      }
    }

    if (target) {
      target.hp -= damage;

      if (target.hp <= 0) {
        zombies.delete(target.id);
        player.coins += 15 + wave * 2;
        kills += 1;
      }
    }

    return;
  }
}

wss.on("connection", (socket) => {
  const player = {
    id: randomUUID(),
    name: `Игрок ${players.size + 1}`,
    x: 0,
    z: 0,
    health: 100,
    coins: 50,
    level: 1,
    alive: true,
    lastAttack: 0
  };

  send(socket, { ...getState(), yourId: player.id });

  socket.on("message", (raw) => {
    try {
      handleMessage(socket, player, JSON.parse(raw.toString()));
    } catch {
      // Игнорируем некорректные сообщения клиента.
    }
  });

  socket.on("close", () => {
    players.delete(player.id);
    broadcastState();
  });
});

setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  if (phase === "countdown") {
    countdown -= 1;
    if (countdown <= 0) spawnWave();
    broadcastState();
    return;
  }

  if (phase === "intermission") {
    intermission -= dt;
    if (intermission <= 0) spawnWave();
    broadcastState();
    return;
  }

  if (phase !== "playing") return;

  const targets = livingPlayers();
  if (targets.length === 0) {
    endMatch("gameover");
    broadcastState();
    return;
  }

  for (const zombie of zombies.values()) {
    let target = null;
    let nearest = Infinity;

    for (const player of targets) {
      const distance = Math.hypot(player.x - zombie.x, player.z - zombie.z);
      if (distance < nearest) {
        nearest = distance;
        target = player;
      }
    }

    if (!target) continue;

    if (nearest > 1.5) {
      const dx = target.x - zombie.x;
      const dz = target.z - zombie.z;
      const length = Math.hypot(dx, dz) || 1;
      zombie.x += (dx / length) * zombie.speed * dt;
      zombie.z += (dz / length) * zombie.speed * dt;
    } else if (Date.now() > zombie.nextHit) {
      target.health -= 9 + wave;
      zombie.nextHit = Date.now() + 900;
      if (target.health <= 0) {
        target.health = 0;
        target.alive = false;
      }
    }
  }

  if (livingPlayers().length === 0) {
    endMatch("gameover");
  } else if (zombies.size === 0) {
    if (wave >= 20) {
      endMatch("won");
    } else {
      phase = "intermission";
      intermission = 6;
    }
  }

  broadcastState();
}, 200);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Игра запущена: http://localhost:${port}`);
});
