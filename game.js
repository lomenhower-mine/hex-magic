import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080611);
scene.fog = new THREE.FogExp2(0x080611, 0.018);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 250);
camera.position.set(0, 1.7, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xc7a4ff, 0x100717, 2));

const purpleLight = new THREE.PointLight(0x8c35ff, 65, 65);
purpleLight.position.set(0, 8, 0);
scene.add(purpleLight);

const cyanLight = new THREE.PointLight(0x26dfff, 32, 35);
cyanLight.position.set(12, 4, -10);
scene.add(cyanLight);

// Тёмная арена и декоративная руническая окружность.
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(42, 96),
  new THREE.MeshStandardMaterial({
    color: 0x100a1d,
    emissive: 0x140824,
    roughness: 0.85
  })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.05;
scene.add(floor);

const grid = new THREE.GridHelper(84, 42, 0x562c7f, 0x26183b);
grid.position.y = 0.01;
scene.add(grid);

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(34, 0.12, 8, 160),
  new THREE.MeshBasicMaterial({ color: 0xb14cff })
);
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.08;
scene.add(ring);

const starGeometry = new THREE.BufferGeometry();
const starPositions = [];
for (let i = 0; i < 500; i++) {
  starPositions.push(
    (Math.random() - 0.5) * 180,
    Math.random() * 65 + 5,
    (Math.random() - 0.5) * 180
  );
}
starGeometry.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(starPositions, 3)
);
scene.add(new THREE.Points(
  starGeometry,
  new THREE.PointsMaterial({ color: 0xc5a1ff, size: 0.16 })
));

const players = new Map();
const zombies = new Map();
const keys = {};
const clock = new THREE.Clock();

let socket;
let myId = null;
let gamePhase = "idle";
let selectedWeapon = "gun";
let yaw = 0;
let pitch = 0;
let verticalVelocity = 0;
let grounded = true;
let lastMove = 0;
let attackReady = true;

const ui = {
  overlay: document.querySelector("#overlay"),
  join: document.querySelector("#join"),
  message: document.querySelector("#message"),
  wave: document.querySelector("#wave"),
  stats: document.querySelector("#stats"),
  weapon: document.querySelector("#weapon"),
  upgrade: document.querySelector("#upgrade")
};

function send(data) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("message", (event) => {
    const state = JSON.parse(event.data);

    if (state.yourId) myId = state.yourId;
    if (state.type !== "state") return;

    gamePhase = state.phase;
    syncPlayers(state.players || []);
    syncZombies(state.zombies || []);
    updateHUD(state);
  });

  socket.addEventListener("close", () => {
    ui.message.textContent = "Соединение с сервером потеряно";
  });
}

function makePlayer(id) {
  if (id === myId || players.has(id)) return;

  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.8, 4, 8),
    new THREE.MeshStandardMaterial({
      color: 0x9b62ff,
      emissive: 0x521b9c,
      emissiveIntensity: 1.2
    })
  );
  body.position.y = 0.95;
  group.add(body);
  scene.add(group);
  players.set(id, group);
}

function syncPlayers(list) {
  const aliveIds = new Set(list.map((p) => p.id));

  for (const p of list) {
    if (p.id === myId) continue;
    makePlayer(p.id);
    const group = players.get(p.id);
    if (group) {
      group.position.set(p.x, 0, p.z);
      group.visible = p.alive;
    }
  }

  for (const [id, group] of players) {
    if (!aliveIds.has(id)) {
      scene.remove(group);
      players.delete(id);
    }
  }

  const me = list.find((p) => p.id === myId);
  if (me) {
    ui.stats.innerHTML =
      `❤️ ${me.health} здоровья<br>✦ ${me.coins} монет<br>Оружие ${me.level} уровня`;
  }
}

function makeZombie(id) {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x58834a,
    emissive: 0x235b2c,
    emissiveIntensity: 1.3,
    roughness: 0.8
  });

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.75, 4, 8),
    bodyMaterial
  );
  body.position.y = 0.75;
  group.add(body);

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff3158 });
  for (const x of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), eyeMaterial);
    eye.position.set(x, 1.04, -0.36);
    group.add(eye);
  }

  const aura = new THREE.PointLight(0x46ff69, 2.5, 4);
  aura.position.y = 1.1;
  group.add(aura);

  group.userData.hpBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.07, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xff3158 })
  );
  group.userData.hpBar.position.set(0, 1.45, 0);
  group.add(group.userData.hpBar);

  scene.add(group);
  zombies.set(id, group);
}

function syncZombies(list) {
  const aliveIds = new Set(list.map((z) => z.id));

  for (const z of list) {
    if (!zombies.has(z.id)) makeZombie(z.id);

    const group = zombies.get(z.id);
    group.position.set(z.x, 0, z.z);

    const ratio = Math.max(0, z.hp / z.maxHp);
    group.userData.hpBar.scale.x = ratio;
    group.userData.hpBar.position.x = -(1 - ratio) * 0.45;
    group.userData.hpBar.material.color.setHSL(ratio * 0.32, 1, 0.5);
  }

  for (const [id, group] of zombies) {
    if (!aliveIds.has(id)) {
      scene.remove(group);
      zombies.delete(id);
    }
  }
}

function updateHUD(state) {
  ui.wave.textContent =
    state.wave > 0 ? `ВОЛНА ${state.wave} / 20 · УБИЙСТВ ${state.kills}` : "Ожидание игроков";

  if (state.phase === "countdown") {
    ui.message.textContent = `Начало через ${Math.ceil(state.countdown)}`;
  } else if (state.phase === "intermission") {
    ui.message.textContent = `Волна ${state.wave + 1} через ${Math.ceil(state.intermission)}`;
  } else if (state.phase === "playing") {
    ui.message.textContent = `ВОЛНА ${state.wave}`;
  } else if (state.phase === "won") {
    ui.message.textContent = "ПОБЕДА — 20 ВОЛН ПРОЙДЕНЫ!";
    ui.overlay.classList.remove("hidden");
  } else if (state.phase === "gameover") {
    ui.message.textContent = "КОМАНДА ПАЛА";
    ui.overlay.classList.remove("hidden");
  } else {
    ui.message.textContent = "";
  }
}

ui.join.addEventListener("click", () => {
  send({ type: "join" });
  renderer.domElement.requestPointerLock();
  ui.join.textContent = "Вы в очереди!";
});

ui.upgrade.addEventListener("click", () => send({ type: "upgrade" }));

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === renderer.domElement) {
    ui.overlay.classList.add("hidden");
  } else if (gamePhase === "idle" || gamePhase === "countdown") {
    ui.overlay.classList.remove("hidden");
  }
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= event.movementX * 0.002;
  pitch -= event.movementY * 0.002;
  pitch = THREE.MathUtils.clamp(pitch, -1.45, 1.45);
  camera.rotation.order = "YXZ";
  camera.rotation.set(pitch, yaw, 0);
});

addEventListener("keydown", (event) => {
  keys[event.code] = true;

  if (event.key === "1") {
    selectedWeapon = "gun";
    ui.weapon.textContent = "1 — Магический пистолет";
  }
  if (event.key === "2") {
    selectedWeapon = "sword";
    ui.weapon.textContent = "2 — Рунический меч";
  }
});

addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

addEventListener("mousedown", (event) => {
  if (event.button !== 0 || document.pointerLockElement !== renderer.domElement) return;
  if (gamePhase !== "playing" || !attackReady) return;

  attackReady = false;
  send({ type: "attack", weapon: selectedWeapon });

  if (selectedWeapon === "gun") {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const bolt = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x76f5ff })
    );
    bolt.position.copy(camera.position).addScaledVector(direction, 0.8);
    scene.add(bolt);

    const start = bolt.position.clone();
    const end = start.clone().addScaledVector(direction, 25);
    const started = performance.now();

    function animateBolt(now) {
      const t = Math.min((now - started) / 180, 1);
      bolt.position.lerpVectors(start, end, t);
      if (t < 1) requestAnimationFrame(animateBolt);
      else scene.remove(bolt);
    }
    requestAnimationFrame(animateBolt);
  } else {
    ui.message.textContent = "⚔";
    setTimeout(() => {
      if (gamePhase === "playing") ui.message.textContent = "";
    }, 180);
  }

  setTimeout(() => { attackReady = true; }, 260);
});

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const movement = new THREE.Vector3();

  if (keys.KeyW) movement.add(forward);
  if (keys.KeyS) movement.sub(forward);
  if (keys.KeyD) movement.add(right);
  if (keys.KeyA) movement.sub(right);

  if (movement.lengthSq() > 0) {
    movement.normalize().multiplyScalar(7 * dt);
    camera.position.add(movement);
  }

  if (keys.Space && grounded) {
    verticalVelocity = 5.5;
    grounded = false;
  }

  verticalVelocity -= 10 * dt;
  camera.position.y += verticalVelocity * dt;

  if (camera.position.y <= 1.7) {
    camera.position.y = 1.7;
    verticalVelocity = 0;
    grounded = true;
  }

  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -38, 38);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -38, 38);

  purpleLight.position.x = Math.sin(performance.now() * 0.0004) * 9;
  purpleLight.position.z = Math.cos(performance.now() * 0.0004) * 9;
  ring.rotation.z += dt * 0.08;

  if (socket?.readyState === WebSocket.OPEN &&
      performance.now() - lastMove > 80) {
    lastMove = performance.now();
    send({ type: "move", x: camera.position.x, z: camera.position.z });
  }

  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

connect();
animate();
