// Hex Runes: Blocks — сервер: раздаёт index.html, ведёт комнаты-миры, выполняет руны/жезлы
const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000,GY=9; // GY — высота земли для руны «Луч» (поверхность деревни/плоских миров)
const srv=http.createServer((q,r)=>fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{
  r.writeHead(e?500:200,{'Content-Type':'text/html; charset=utf-8'});r.end(e?'error':d);}));
const wss=new WebSocketServer({server:srv,maxPayload:16384});
const P=new Map();let nid=1;
const send=(ws,o)=>{if(ws.readyState===1)ws.send(JSON.stringify(o))};
const room=(p,o,self)=>P.forEach(q=>{if(q.w===p.w&&(self||q!==p))send(q.ws,o)});
const len=v=>Math.hypot(v[0],v[1],v[2]);
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const nrm=v=>{const l=len(v)||1;return mul(v,1/l)};
const look=p=>{const c=Math.cos(p.pt);return[-Math.sin(p.yaw)*c,Math.sin(p.pt),-Math.cos(p.yaw)*c]};
const pop=(s,t)=>{if(!s.length)throw'Не хватает значений в стеке';const x=s.pop();if(t&&x.t!==t)throw'Неверный тип значения';return x};
const spend=(p,c)=>{if(p.mana<c)throw'Не хватает медиа';p.mana-=c};
const reach=(p,v)=>{if(len(sub(p.pos,v))>40)throw'Слишком далеко (макс. 40)'};
const mate=(p,id)=>{const t=P.get(id);if(!t||t.w!==p.w)throw'Цель исчезла';return t};
const PAT={
 qaq:{n:'Отражение разума',f:(s,p)=>s.push({t:'e',id:p.id})},
 wa:{n:'Взор',f:(s,p)=>s.push({t:'v',v:look(p)})},
 wq:{n:'Позиция',f:(s,p)=>{const t=mate(p,pop(s,'e').id);s.push({t:'v',v:[...t.pos]})}},
 ww:{n:'Число 1',f:s=>s.push({t:'n',v:1})},
 wd:{n:'Сложение',f:s=>{const b=pop(s),a=pop(s);if(a.t!==b.t||a.t==='e')throw'Нельзя сложить';
   s.push(a.t==='n'?{t:'n',v:a.v+b.v}:{t:'v',v:add(a.v,b.v)})}},
 ee:{n:'Умножение',f:s=>{const b=pop(s,'n'),a=pop(s);if(a.t==='n')s.push({t:'n',v:a.v*b.v});
   else if(a.t==='v')s.push({t:'v',v:mul(a.v,b.v)});else throw'Нельзя умножить'}},
 da:{n:'Обмен',f:s=>{const b=pop(s),a=pop(s);s.push(b,a)}},
 ed:{n:'Дубликат',f:s=>{const a=pop(s);s.push(a,{...a})}},
 ea:{n:'Отбросить',f:s=>{pop(s)}},
 dq:{n:'Луч',f:s=>{const d=nrm(pop(s,'v').v),o=pop(s,'v').v;let pt=o;
   for(let t=0;t<=40;t+=.25){pt=add(o,mul(d,t));if(pt[1]<=GY){pt=[pt[0],GY,pt[2]];break}}s.push({t:'v',v:pt})}},
 aaq:{n:'Взрыв',f:(s,p)=>{const w=Math.min(4,Math.max(.5,pop(s,'n').v)),v=pop(s,'v').v;
   reach(p,v);spend(p,15*w);room(p,{t:'fx',k:'boom',p:v,r:2+1.5*w,w,id:String(p.id)},1)}},
 dde:{n:'Импульс',f:(s,p)=>{let v=pop(s,'v').v;const t=mate(p,pop(s,'e').id);
   if(len(v)>30)v=mul(nrm(v),30);spend(p,5+len(v));send(t.ws,{t:'imp',v})}},
 qqa:{n:'Свет',f:(s,p)=>{const v=pop(s,'v').v;reach(p,v);spend(p,5);room(p,{t:'fx',k:'light',p:v},1)}},
};
function cast(p,str){const d=PAT[str];
  try{if(!d)throw'Неизвестный узор';if(p.stack.length>=32)throw'Стек переполнен';d.f(p.stack,p);return{ok:1,n:d.n}}
  catch(e){if(typeof e!=='string')throw e;p.stack=[];p.mana=Math.max(0,p.mana-10);return{ok:0,n:d?d.n:'?',err:e}}}
const fmt=s=>s.map(x=>x.t==='n'?String(+x.v.toFixed(2)):x.t==='v'?'('+x.v.map(n=>n.toFixed(1))+')':(P.get(x.id)||{name:'?'}).name);
const okPat=x=>typeof x==='string'&&/^[wedaq]{0,12}$/.test(x);
const RL=new Set(['b','chat','drop','pk','give']); // сообщения, которые сервер просто пересылает в комнату
wss.on('connection',ws=>{let me=null;
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==='join'){const nm=String(m.name||'Маг').slice(0,16),w=String(m.w||'lobby').slice(0,24);
      if(!me){me={ws,id:nid++,name:nm,w:null,pos:[0,0,0],yaw:0,pt:0,mana:100,stack:[],wc:0};P.set(me.id,me);send(ws,{t:'init',id:String(me.id)})}
      else if(me.w)room(me,{t:'bye',id:String(me.id)});
      me.name=nm;me.w=w;me.stack=[];room(me,{t:'hi',n:nm,id:String(me.id)})}
    else if(!me||!me.w)return;
    else if(m.t==='p'&&Array.isArray(m.p)&&m.p.length>=3){me.pos=[+m.p[0]||0,(+m.p[1]||0)+1.6,+m.p[2]||0];me.yaw=+m.y||0;me.pt=+m.pt||0;
      room(me,{t:'p',id:String(me.id),n:me.name,p:me.pos.map((v,i)=>i==1?v-1.6:v),y:me.yaw})}
    else if(RL.has(m.t)){const o={...m,id:String(me.id)};if(m.t==='chat'){o.n=me.name;o.m=String(m.m||'').slice(0,120)}if(m.t==='give')o.n=me.name;room(me,o)}
    else if(m.t==='pat'&&okPat(m.p)){const r=cast(me,m.p);send(ws,{t:'cast',...r,stack:fmt(me.stack),mana:me.mana})}
    else if(m.t==='wand'&&Array.isArray(m.seq)&&m.seq.length<=40&&m.seq.every(okPat)){ // жезл: выполняет записанное заклинание на чистом стеке
      const n=Date.now();if(n<me.wc)return;me.wc=n+400;const keep=me.stack;me.stack=[];let r={ok:1,n:'готово'};
      for(const s of m.seq){r=cast(me,s);if(!r.ok)break}me.stack=keep;
      send(ws,{t:'cast',ok:r.ok,n:'Жезл: '+r.n,err:r.err,w:1,stack:fmt(me.stack),mana:me.mana})}
    else if(m.t==='close'){me.stack=[];send(ws,{t:'cast',ok:1,n:'Сессия закрыта',stack:[],mana:me.mana})}});
  ws.on('close',()=>{if(me){if(me.w)room(me,{t:'bye',id:String(me.id)});P.delete(me.id)}});});
let last=Date.now();
setInterval(()=>{const n=Date.now(),dt=(n-last)/1000;last=n;P.forEach(p=>{p.mana=Math.min(100,p.mana+6*dt);send(p.ws,{t:'s',mana:p.mana})})},250);
srv.listen(PORT,()=>console.log('Hex Runes: Blocks — http://localhost:'+PORT));
