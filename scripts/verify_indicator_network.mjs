import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { indicatorLevels } from '../src/vehicleIndicators.js';
const require=createRequire(new URL('../server/package.json',import.meta.url));
const {WebSocket}=require('ws');
const allocation=net.createServer();await new Promise(r=>allocation.listen(0,'127.0.0.1',r));const port=allocation.address().port;await new Promise(r=>allocation.close(r));
const relay=spawn(process.execPath,['server/server.js'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
const clients=[];
async function connect(nick) {
  const ws=new WebSocket(`ws://127.0.0.1:${port}`),messages=[],waiters=[];
  ws.on('message',data=>{const m=JSON.parse(String(data));messages.push(m);for(const check of [...waiters])check();});
  const wait=predicate=>new Promise((resolve,reject)=>{const check=()=>{const i=messages.findIndex(predicate);if(i<0)return;clearTimeout(timer);waiters.splice(waiters.indexOf(check),1);resolve(messages.splice(i,1)[0]);};const timer=setTimeout(()=>{waiters.splice(waiters.indexOf(check),1);reject(Error('relay message timeout'));},5000);waiters.push(check);check();});
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});ws.send(JSON.stringify({t:'join',v:1,nick}));
  const welcome=await wait(m=>m.t==='welcome');const c={ws,wait,messages,id:welcome.id,welcome};clients.push(c);return c;
}
const raw=(seq,sig='left',rev=1,at=Date.now()-250,cid='ferrari')=>({t:'state',seq,cid,p:[0,0,0],q:[0,0,0,1],v:[0,0,0],av:[0,0,0],spd:0,in:{},li:{head:2,brake:1,rev:1,sig,sigRev:rev,sigAt:at}});
const send=(c,s)=>c.ws.send(JSON.stringify(s));
try {
  await new Promise((r,j)=>{const timeout=setTimeout(()=>j(Error('relay startup timeout')),5000);relay.stdout.on('data',d=>{if(String(d).includes('listening on port')){clearTimeout(timeout);r();}});relay.once('exit',code=>j(Error(`relay exited ${code}`)));});
  const a=await connect('Signal driver'),b=await connect('Observer');
  send(a,raw(1));let s=(await b.wait(m=>m.t==='snapshot'&&m.states[a.id]?.seq===1)).states[a.id];
  const firstAt=s.li.sigAt;assert.equal(s.li.sig,'left');assert.equal(s.li.head,2);assert.equal(s.li.brake,1);assert.equal(s.li.rev,1);
  const c=await connect('Late observer');assert.equal(c.welcome.players.find(p=>p.id===a.id).state.li.sigAt,firstAt,'join includes current mode and original phase');
  for(const now of [firstAt+399,firstAt+400,firstAt+800])assert.deepEqual(indicatorLevels(s.li.sig,firstAt,now),indicatorLevels(c.welcome.players.find(p=>p.id===a.id).state.li.sig,firstAt,now));
  send(a,raw(2,'left',1,Date.now()));s=(await b.wait(m=>m.t==='snapshot'&&m.states[a.id]?.seq===2)).states[a.id];assert.equal(s.li.sigAt,firstAt,'unchanged mode does not restart blink');
  send(a,raw(1,'right',99));s=(await c.wait(m=>m.t==='snapshot'&&m.states[a.id]?.seq===2)).states[a.id];assert.equal(s.li.sig,'left','stale packet cannot restore an old mode');
  for(const [seq,mode] of [[3,'hazard'],[4,'right'],[5,'off'],[6,'left']]) {send(a,raw(seq,mode,seq));s=(await b.wait(m=>m.t==='snapshot'&&m.states[a.id]?.seq===seq)).states[a.id];assert.equal(s.li.sig,mode);assert.ok(Math.abs(s.li.sigAt-Date.now())<1000);}
  send(a,raw(7,'hazard',7));const saved=(await c.wait(m=>m.t==='snapshot'&&m.states[a.id]?.seq===7)).states[a.id];
  // No state sends during several complete blink cycles. Repeated relay snapshots
  // retain the reference instead of transmitting individual on/off transitions.
  await new Promise(r=>setTimeout(r,1700));const last=c.messages.filter(m=>m.t==='snapshot').at(-1).states[a.id];assert.deepEqual(last.li,saved.li);assert.equal(last.seq,7);
  send(a,raw(8,'off',8,Date.now(),'prado'));s=(await b.wait(m=>m.t==='snapshot'&&m.states[a.id]?.seq===8)).states[a.id];assert.equal(s.cid,'prado');assert.equal(s.li.sig,'off');
  send(a,raw(9,'invalid',9,Infinity));s=(await b.wait(m=>m.t==='snapshot'&&m.states[a.id]?.seq===9)).states[a.id];assert.equal(s.li.sig,'off');assert.ok(Number.isFinite(s.li.sigAt));
  a.ws.close();await b.wait(m=>m.t==='left'&&m.id===a.id);
  const again=await connect('Signal driver');send(again,raw(1,'hazard',10));s=(await b.wait(m=>m.t==='snapshot'&&m.states[again.id]?.seq===1)).states[again.id];assert.equal(s.li.sig,'hazard');assert.ok(!again.welcome.players.some(p=>p.id===a.id),'disconnected object is absent on reconnect');
  console.log('Indicator relay: three clients, late join, stationary blinking without sends, stable phase, mode switches, stale packets, malformed state, vehicle change, disconnect and reconnect passed.');
} finally {for(const c of clients)c.ws.terminate();relay.kill();}
