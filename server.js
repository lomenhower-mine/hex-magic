const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000;
const srv=http.createServer((q,r)=>fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{
  r.writeHead(e?500:200,{'Content-Type':'text/html; charset=utf-8'});r.end(e?'error':d);}));
const wss=new WebSocketServer({server:srv});
const P=new Map();let nid=1;
const COL=[0xff5555,0x55ff88,0x5599ff,0xffcc44,0xcc66ff,0x44dddd];
const send=(ws,o)=>{if(ws.readyState===1)ws.send(JSON.stringify(o))};
const all=o=>P.forEach(p=>send(p.ws,o));
const len=v=>Math.hypot(v[0],v[1],v[2]);
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const nrm=v=>{const l=len(v)||1;return mul(v,1/l)};
const look=p=>{const c=Math.cos(p.pt);return[-Math.sin(p.yaw)*c,Math.sin(p.pt),-Math.cos(p.yaw)*c]};
const pop=(s,t)=>{if(!s.length)throw'Не хватает значений в стеке';const x=s.pop();if(t&&x.t!==t)throw'Неверный тип значения';return x};
const spend=(p,c)=>{if(p.mana<c)throw'Не хватает медиа';p.mana-=c};
const reach=(p,v)=>{if(len(sub(p.pos,v))>40)throw'Слишком далеко (макс. 40)'};
const spawn=()=>[(Math.random()-.5)*30,1.6,(Math.random()-.5)*30];
function hurt(p,d){p.hp-=d;if(p.hp<=0){p.hp=100;p.mana=100;p.stack=[];p.pos=spawn();
  send(p.ws,{t:'resp',pos:p.pos});all({t:'msg',m:p.name+' погиб'});}}
function boom(v,w){const r=2+1.5*w;
  P.forEach(p=>{const d=len(sub(p.pos,v));if(d<r){const k=1-d/r;
    const dir=nrm(add(sub(p.pos,v),[0,.6,0]));send(p.ws,{t:'imp',v:mul(dir,k*18)});hurt(p,k*10*w);}});
  all({t:'fx',k:'boom',p:v,r});}
const PAT={
 qaq:{n:'Отражение разума',c:0,f:(s,p)=>s.push({t:'e',id:p.id})},
 wa:{n:'Взор',c:0,f:(s,p)=>s.push({t:'v',v:look(p)})},
 wq:{n:'Позиция',c:0,f:s=>{const t=P.get(pop(s,'e').id);if(!t)throw'Цель исчезла';s.push({t:'v',v:[...t.pos]})}},
 ww:{n:'Число 1',c:0,f:s=>s.push({t:'n',v:1})},
 wd:{n:'Сложение',c:0,f:s=>{const b=pop(s),a=pop(s);if(a.t!==b.t||a.t==='e')throw'Нельзя сложить';
   s.push(a.t==='n'?{t:'n',v:a.v+b.v}:{t:'v',v:add(a.v,b.v)})}},
 ee:{n:'Умножение',c:0,f:s=>{const b=pop(s,'n'),a=pop(s);if(a.t==='n')s.push({t:'n',v:a.v*b.v});
   else if(a.t==='v')s.push({t:'v',v:mul(a.v,b.v)});else throw'Нельзя умножить'}},
 da:{n:'Обмен',c:0,f:s=>{const b=pop(s),a=pop(s);s.push(b,a)}},
 ed:{n:'Дубликат',c:0,f:s=>{const a=pop(s);s.push(a,{...a})}},
 ea:{n:'Отбросить',c:0,f:s=>{pop(s)}},
 dq:{n:'Луч',c:0,f:s=>{const d=nrm(pop(s,'v').v),o=pop(s,'v').v;let pt=o;
   for(let t=0;t<=40;t+=.25){pt=add(o,mul(d,t));if(pt[1]<=0){pt=[pt[0],0,pt[2]];break}}s.push({t:'v',v:pt})}},
 aaq:{n:'Взрыв',c:0,f:(s,p)=>{const w=Math.min(4,Math.max(.5,pop(s,'n').v)),v=pop(s,'v').v;
   reach(p,v);spend(p,15*w);boom(v,w)}},
 dde:{n:'Импульс',c:0,f:(s,p)=>{let v=pop(s,'v').v;const t=P.get(pop(s,'e').id);if(!t)throw'Цель исчезла';
   if(len(v)>30)v=mul(nrm(v),30);spend(p,5+len(v));send(t.ws,{t:'imp',v})}},
 qqa:{n:'Свет',c:0,f:(s,p)=>{const v=pop(s,'v').v;reach(p,v);spend(p,5);all({t:'fx',k:'light',p:v})}},
};
function cast(p,str){const d=PAT[str];
  try{if(!d)throw'Неизвестный узор';if(p.stack.length>=32)throw'Стек переполнен';d.f(p.stack,p);return{ok:1,n:d.n}}
  catch(e){if(typeof e!=='string')throw e;p.stack=[];p.mana=Math.max(0,p.mana-10);return{ok:0,n:d?d.n:'?',err:e}}}
const fmt=s=>s.map(x=>x.t==='n'?String(+x.v.toFixed(2)):x.t==='v'?'('+x.v.map(n=>n.toFixed(1))+')':(P.get(x.id)||{name:'?'}).name);
wss.on('connection',ws=>{let me=null;
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==='join'&&!me){const id=nid++;me={ws,id,name:String(m.name||'Маг').slice(0,16),col:COL[id%COL.length],
      pos:spawn(),yaw:0,pt:0,hp:100,mana:100,stack:[]};P.set(id,me);
      send(ws,{t:'init',id,pos:me.pos});all({t:'msg',m:me.name+' вошёл в игру'});}
    else if(!me)return;
    else if(m.t==='m'&&Array.isArray(m.p)){me.pos=m.p.slice(0,3).map(Number);me.yaw=+m.y||0;me.pt=+m.pt||0}
    else if(m.t==='pat'&&/^[wedaq]{0,12}$/.test(m.p)){const r=cast(me,m.p);send(ws,{t:'cast',...r,stack:fmt(me.stack),mana:me.mana})}
    else if(m.t==='close'){me.stack=[];send(ws,{t:'cast',ok:1,n:'Сессия закрыта',stack:[],mana:me.mana})}});
  ws.on('close',()=>{if(me){P.delete(me.id);all({t:'msg',m:me.name+' вышел'})}});});
let last=Date.now();
setInterval(()=>{const n=Date.now(),dt=(n-last)/1000;last=n;
  const ps=[...P.values()].map(p=>({id:p.id,n:p.name,c:p.col,p:p.pos,y:p.yaw,h:p.hp}));
  P.forEach(p=>{p.mana=Math.min(100,p.mana+6*dt);send(p.ws,{t:'s',ps,hp:p.hp,mana:p.mana})});},66);
srv.listen(PORT,()=>console.log('Hex Runes: http://localhost:'+PORT));
