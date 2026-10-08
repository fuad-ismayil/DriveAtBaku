import { WebSocket } from 'ws';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8787';
const NUM_CLIENTS = Number(process.env.CLIENTS) || 10;
const DURATION_SEC = Number(process.env.DURATION) || 10;
const SEND_HZ = 20;
const SEND_INTERVAL_MS = Math.round(1000 / SEND_HZ);

console.log(`Starting load test with ${NUM_CLIENTS} clients connecting to ${SERVER_URL} for ${DURATION_SEC}s...`);

let snapshotsReceived = 0;
let statesSent = 0;
let errors = 0;
const clients = [];

async function runClient(index) {
  return new Promise(resolve => {
    const ws = new WebSocket(SERVER_URL);
    let interval = null;
    let seq = 0;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        t: 'join',
        nick: `Bot_${index}`,
        v: 1,
      }));
    });

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.t === 'welcome') {
          interval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              seq++;
              const angle = (Date.now() / 1000) + index;
              const fakeState = {
                t: 'state',
                seq,
                ts: Date.now(),
                p: [681 + Math.cos(angle) * 10, 479 + Math.sin(angle) * 10, 1.63],
                q: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)],
                v: [Math.cos(angle) * 15, Math.sin(angle) * 15, 0],
                av: [0, 0, 0.5],
                spd: 54.0,
                in: { th: 1, br: 0, st: 0.1, hb: 0, rev: 0 },
                li: { head: 1, brake: 0, rev: 0 },
                w: [
                  { st: 0.1, rot: 1.0, sl: 0.2, sk: 0, sm: 0, c: 1, cp: [681, 479, 1.5] },
                  { st: 0.1, rot: 1.0, sl: 0.2, sk: 0, sm: 0, c: 1, cp: [682, 479, 1.5] },
                  { st: 0.0, rot: 1.0, sl: 0.2, sk: 0, sm: 0, c: 1, cp: [681, 477, 1.5] },
                  { st: 0.0, rot: 1.0, sl: 0.2, sk: 0, sm: 0, c: 1, cp: [682, 477, 1.5] },
                ],
              };
              ws.send(JSON.stringify(fakeState));
              statesSent++;
            }
          }, SEND_INTERVAL_MS);
        } else if (msg.t === 'snapshot') {
          snapshotsReceived++;
        }
      } catch (err) {
        errors++;
      }
    });

    ws.on('error', () => {
      errors++;
    });

    clients.push({ ws, close: () => { clearInterval(interval); ws.close(); resolve(); } });
  });
}

const startTime = Date.now();
for (let i = 0; i < NUM_CLIENTS; i++) {
  runClient(i);
}

setTimeout(() => {
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n=== Load Test Results ===`);
  console.log(`Duration: ${elapsed.toFixed(1)}s`);
  console.log(`Clients: ${NUM_CLIENTS}`);
  console.log(`States sent: ${statesSent} (${(statesSent / elapsed).toFixed(1)}/s)`);
  console.log(`Snapshots received: ${snapshotsReceived} (${(snapshotsReceived / elapsed).toFixed(1)}/s)`);
  console.log(`Errors: ${errors}`);
  for (const client of clients) client.close();
  process.exit(0);
}, DURATION_SEC * 1000);
