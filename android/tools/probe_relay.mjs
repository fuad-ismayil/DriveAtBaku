// Short protocol diagnostic: only inspect this client's own echoed state.
import { mkdirSync, writeFileSync } from 'node:fs';
const address = process.argv[2];
if (!address) throw new Error('Provide a relay WebSocket URL explicitly.');
const socket = new WebSocket(address);
const result = await new Promise((resolve, reject) => {
  let id;
  const timeout = setTimeout(() => reject(new Error('Relay echo timeout')), 10000);
  socket.addEventListener('error', reject);
  socket.addEventListener('open', () => socket.send(JSON.stringify({ t: 'join', nick: 'Signal diagnostic', v: 1 })));
  socket.addEventListener('message', event => {
    const packet = JSON.parse(String(event.data));
    if (packet.t === 'welcome') {
      id = packet.id;
      socket.send(JSON.stringify({ t: 'state', seq: 1, ts: Date.now(), cid: 'ferrari', col: '#a80719',
        rpm: 900, gr: 1, au: { ld:0.72,sh:0.1,ac:6 }, p: [0,0,-500], q: [0,0,0,1], v: [0,0,0], av: [0,0,0], spd: 0,
        plt: { enabled:true,region:'99',letters:'AB',serial:'808',hyphens:false,identity:'new',format:'compact' },
        in: { th:0,br:0,st:0,hb:0,hn:0,rev:0 }, li: { head:0,brake:0,rev:0,sig:'left',sigRev:1,sigAt:packet.serverTime }, w: [] }));
    }
    if (packet.t === 'snapshot' && packet.states?.[id]) {
      clearTimeout(timeout);
      resolve({ address, returnedLights: packet.states[id].li, returnedAudio: packet.states[id].au, returnedPlate: packet.states[id].plt, engineStatePreserved: packet.states[id].au?.ld === .72 && packet.states[id].au?.sh === .1 && packet.states[id].au?.ac === 6, indicatorsPreserved: packet.states[id].li?.sig === 'left', platesPreserved: packet.states[id].plt?.serial === '808' && packet.states[id].plt?.format === 'compact' });
    }
  });
}).finally(() => socket.close());
mkdirSync('artifacts/android', { recursive: true });
writeFileSync('artifacts/android/relay-capability.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
