import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const address = process.argv[2];
if (!address) throw new Error('Provide the relay WebSocket URL explicitly.');
const peers = [0, 1].map(index => ({ index, socket: new WebSocket(address), id: '', horn: false, seq: 0, seen: new Map() }));
let timer;
try {
  await Promise.all(peers.map(peer => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Relay join timeout')), 15000);
    peer.socket.addEventListener('open', () => peer.socket.send(JSON.stringify({ t: 'join', nick: `Horn relay QA ${peer.index + 1}`, v: 1 })));
    peer.socket.addEventListener('error', reject);
    peer.socket.addEventListener('message', event => {
      const packet = JSON.parse(String(event.data));
      if (packet.t === 'welcome') { peer.id = packet.id; clearTimeout(timeout); resolve(); }
      if (packet.t === 'snapshot') for (const [id, state] of Object.entries(packet.states || {})) peer.seen.set(id, state);
    });
  })));
  function send() {
    for (const peer of peers) peer.socket.send(JSON.stringify({
      t: 'state', seq: ++peer.seq, ts: Date.now(), cid: 'ferrari', col: '#a80719', rpm: 900, gr: 1,
      // These diagnostic ghosts stay far outside the playable city/audio range.
      p: [peer.index ? 15000 : -15000, -15000, -500], q: [0, 0, 0, 1], v: [0, 0, 0], av: [0, 0, 0], spd: 0,
      au: { ld: 0, sh: 0, ac: 0 }, in: { th: 0, br: 0, st: 0, hb: 0, hn: Number(peer.horn), rev: 0 },
      li: { head: 0, brake: 0, rev: 0, sig: 'off', sigRev: 0, sigAt: Date.now() }, w: [],
    }));
  }
  timer = setInterval(send, 100);
  const phases = [];
  for (const values of [[false, false], [true, false], [false, true], [true, true], [false, false]]) {
    const minimumSeq = peers.map(peer => peer.seq + 1);
    peers.forEach((peer, index) => peer.horn = values[index]);
    send();
    const start = Date.now();
    while (!peers.every((receiver, index) => {
      const sender = peers[1 - index], state = receiver.seen.get(sender.id);
      return state?.seq >= minimumSeq[1 - index] && Boolean(state.in?.hn) === sender.horn;
    })) {
      assert.ok(Date.now() - start < 12000, 'Relay did not preserve both directions of horn state');
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    phases.push({ a: values[0], b: values[1], roundTripMs: Date.now() - start });
  }
  const report = { passed: true, address, phases };
  mkdirSync('artifacts/android', { recursive: true });
  writeFileSync('artifacts/android/horn-relay.json', JSON.stringify(report, null, 2));
  console.log('PUBLIC_HORN_RELAY_PASS', JSON.stringify(report));
} finally {
  clearInterval(timer);
  for (const peer of peers) peer.socket.close();
}
