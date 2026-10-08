import http from 'http';
import { randomBytes } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const PROTOCOL_VERSION = 1;
const MAX_PLAYERS = 32;
const SERVER_TICK_HZ = 30;
const TICK_INTERVAL_MS = Math.round(1000 / SERVER_TICK_HZ);
const MAX_MSG_BYTES = 4096;
const HEARTBEAT_INTERVAL_MS = 15000;
const SUMMARY_INTERVAL_MS = 60000;

const COLOR_PALETTE = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8',
  '#f58231', '#911eb4', '#42d4f4', '#f032e6',
  '#bfef45', '#fabed4', '#469990', '#dcbeff',
  '#9a6324', '#fffac8', '#800000', '#aaffc3',
];

const allowedOriginsEnv = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true; // Direct clients, node scripts, curl
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'driveatbaku.netlify.app' ||
      host === 'driveatbaku.vercel.app' ||
      host === 'driveatbaku.games' ||
      host === 'www.driveatbaku.games'
    ) return true;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.endsWith('.trycloudflare.com')) return true;
    if (allowedOriginsEnv.includes(origin.toLowerCase()) || allowedOriginsEnv.includes(host)) return true;
    return false;
  } catch {
    return false;
  }
}

function getRemoteIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return String(cfIp).trim();
  return req.socket?.remoteAddress || 'unknown';
}

function sanitizeNick(rawNick, existingNicks) {
  let nick = String(rawNick || '')
    .replace(/[\u0000-\u001F\u007F-\u009F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (!nick) nick = 'Player';

  if (!existingNicks.has(nick.toLowerCase())) {
    return nick;
  }
  let suffix = 2;
  while (existingNicks.has(`${nick} ${suffix}`.toLowerCase())) {
    suffix++;
  }
  return `${nick} ${suffix}`.slice(0, 16);
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const p = Array.isArray(raw.p) ? raw.p.slice(0, 3).map(Number) : [0, 0, 0];
  const q = Array.isArray(raw.q) ? raw.q.slice(0, 4).map(Number) : [0, 0, 0, 1];
  const v = Array.isArray(raw.v) ? raw.v.slice(0, 3).map(Number) : [0, 0, 0];
  const av = Array.isArray(raw.av) ? raw.av.slice(0, 3).map(Number) : [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(p[i])) p[i] = 0;
    if (!Number.isFinite(v[i])) v[i] = 0;
    if (!Number.isFinite(av[i])) av[i] = 0;
  }
  for (let i = 0; i < 4; i++) {
    if (!Number.isFinite(q[i])) q[i] = i === 3 ? 1 : 0;
  }

  const spd = Number.isFinite(raw.spd) ? Number(raw.spd) : 0;
  const input = raw.in && typeof raw.in === 'object' ? {
    th: Number.isFinite(raw.in.th) ? Math.max(0, Math.min(1, raw.in.th)) : 0,
    br: Number.isFinite(raw.in.br) ? Math.max(0, Math.min(1, raw.in.br)) : 0,
    st: Number.isFinite(raw.in.st) ? Math.max(-1, Math.min(1, raw.in.st)) : 0,
    hb: raw.in.hb ? 1 : 0,
    hn: raw.in.hn ? 1 : 0,
    rev: raw.in.rev ? 1 : 0,
  } : { th: 0, br: 0, st: 0, hb: 0, hn: 0, rev: 0 };

  const li = raw.li && typeof raw.li === 'object' ? {
    head: Number.isFinite(raw.li.head) ? raw.li.head : 0,
    brake: raw.li.brake ? 1 : 0,
    rev: raw.li.rev ? 1 : 0,
  } : { head: 0, brake: 0, rev: 0 };

  const wheels = [];
  if (Array.isArray(raw.w)) {
    for (let i = 0; i < Math.min(4, raw.w.length); i++) {
      const item = raw.w[i] || {};
      const wheelEntry = {
        st: Number.isFinite(item.st) ? Number(item.st) : 0,
        rot: Number.isFinite(item.rot) ? Number(item.rot) : 0,
        sl: Number.isFinite(item.sl) ? Number(item.sl) : 0,
        sk: item.sk ? 1 : 0,
        sm: Number.isFinite(item.sm) ? Math.max(0, Math.min(1, Number(item.sm))) : 0,
        c: item.c ? 1 : 0,
      };
      if (Array.isArray(item.cp) && item.cp.length === 3 && item.cp.every(Number.isFinite)) {
        wheelEntry.cp = item.cp.map(n => Math.round(n * 1000) / 1000);
      }
      wheels.push(wheelEntry);
    }
  }

  const cid = typeof raw.cid === 'string' && ['ferrari', 'elantra', 'amg', 'prado'].includes(raw.cid)
    ? raw.cid : 'ferrari';
  const col = typeof raw.col === 'string' && /^#[0-9a-f]{6}$/i.test(raw.col) ? raw.col : null;
  const plt = raw.plt && typeof raw.plt === 'object' ? {
    enabled: raw.plt.enabled !== false,
    region: String(raw.plt.region || '10').slice(0, 2),
    letters: String(raw.plt.letters || 'AA').slice(0, 2),
    serial: String(raw.plt.serial || '001').slice(0, 3),
    hyphens: Boolean(raw.plt.hyphens),
    format: raw.plt.format === 'compact' ? 'compact' : 'long',
    identity: raw.plt.identity === 'new' ? 'new' : 'older',
  } : null;
  const rpm = Number.isFinite(raw.rpm) ? Math.max(0, Math.min(10000, Math.round(raw.rpm))) : 900;
  const gr = Number.isFinite(raw.gr) ? Math.max(0, Math.min(8, Math.round(raw.gr))) : 1;

  return {
    seq: Number.isFinite(raw.seq) ? (raw.seq >>> 0) : 0,
    ts: Number.isFinite(raw.ts) ? Number(raw.ts) : 0,
    cid,
    col,
    plt,
    rpm,
    gr,
    p: p.map(n => Math.round(n * 1000) / 1000),
    q: q.map(n => Math.round(n * 10000) / 10000),
    v: v.map(n => Math.round(n * 100) / 100),
    av: av.map(n => Math.round(n * 100) / 100),
    spd: Math.round(spd * 10) / 10,
    in: input,
    li,
    w: wheels,
  };
}

const players = new Map();
let nextColorIndex = 0;
let nextSpawnIndex = 0;
let totalMessagesReceived = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
    res.end(JSON.stringify({
      ok: true,
      players: players.size,
      uptime: Math.floor(process.uptime()),
      maxPlayers: MAX_PLAYERS,
    }));
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

const wss = new WebSocketServer({ server });

function safeSend(ws, payload) {
  // Do not let a throttled tab turn into an unbounded send queue. A later
  // snapshot supersedes every queued transform it would have received.
  if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 128 * 1024) {
    try {
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    } catch {
      // Ignore transient write errors
    }
  }
}

function broadcast(payload, excludeWs = null) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const player of players.values()) {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      safeSend(player.ws, serialized);
    }
  }
}

wss.on('connection', (ws, req) => {
  const origin = req.headers.origin;
  const clientIp = getRemoteIp(req);

  if (!isAllowedOrigin(origin)) {
    console.warn(`[REJECT] Disallowed origin: "${origin}" from ${clientIp}`);
    ws.close(4003, 'Disallowed Origin');
    return;
  }

  if (players.size >= MAX_PLAYERS) {
    safeSend(ws, { t: 'error', code: 'full', message: 'Room is full' });
    ws.close(4002, 'Room Full');
    return;
  }

  ws.isAlive = true;
  ws.missedPongs = 0;
  ws.on('pong', () => {
    ws.isAlive = true;
    ws.missedPongs = 0;
  });

  let playerId = null;
  let stateRateCount = 0;
  let stateRateStart = Date.now();

  ws.on('message', data => {
    totalMessagesReceived++;
    if (data.length > MAX_MSG_BYTES) return; // Drop over-sized payload

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // Ignore malformed JSON
    }

    ws.isAlive = true;
    ws.missedPongs = 0;

    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      if (playerId) return; // Already joined

      if (msg.v !== PROTOCOL_VERSION) {
        safeSend(ws, { t: 'error', code: 'version', message: 'Protocol version mismatch' });
        ws.close(4001, 'Version Mismatch');
        return;
      }

      if (players.size >= MAX_PLAYERS) {
        safeSend(ws, { t: 'error', code: 'full', message: 'Room is full' });
        ws.close(4002, 'Room Full');
        return;
      }

      const existingNicks = new Set([...players.values()].map(p => p.nick.toLowerCase()));
      const nick = sanitizeNick(msg.nick, existingNicks);
      const id = randomBytes(4).toString('hex');
      const color = COLOR_PALETTE[nextColorIndex % COLOR_PALETTE.length];
      nextColorIndex++;
      const spawnIndex = nextSpawnIndex % 16;
      nextSpawnIndex++;

      const player = {
        id,
        nick,
        color,
        ws,
        ip: clientIp,
        spawnIndex,
        lastState: null,
        lastSeen: Date.now(),
      };

      // Gather current players list for welcome packet
      const currentPlayers = [];
      for (const p of players.values()) {
        currentPlayers.push({
          id: p.id,
          nick: p.nick,
          color: p.color,
          state: p.lastState,
        });
      }

      playerId = id;
      players.set(id, player);

      console.log(`[JOIN] ${nick} (${id}) from ${clientIp} [total: ${players.size}]`);

      safeSend(ws, {
        t: 'welcome',
        id,
        color,
        spawnIndex,
        players: currentPlayers,
        serverTime: Date.now(),
      });

      broadcast({
        t: 'joined',
        player: { id, nick, color },
      }, ws);

      return;
    }

    if (!playerId) {
      // Must join first
      return;
    }

    const player = players.get(playerId);
    if (!player) return;

    player.lastSeen = Date.now();

    if (msg.t === 'state') {
      const now = Date.now();
      if (now - stateRateStart > 1000) {
        stateRateStart = now;
        stateRateCount = 0;
      }
      stateRateCount++;
      if (stateRateCount > 45) {
        // Rate-limit exceeded: drop state packet
        return;
      }

      const validatedState = sanitizeState(msg);
      if (validatedState) {
        player.lastState = validatedState;
      }
      return;
    }

    if (msg.t === 'ping') {
      safeSend(ws, {
        t: 'pong',
        ts: Number(msg.ts) || 0,
        serverTime: Date.now(),
      });
      return;
    }

    if (msg.t === 'chat') {
      const text = String(msg.msg || '')
        .replace(/[\u0000-\u001F\u007F-\u009F<>]/g, '')
        .trim()
        .slice(0, 200);
      if (text) {
        broadcast({
          t: 'chat',
          id: player.id,
          nick: player.nick,
          msg: text,
        });
      }
    }
  });

  const cleanup = () => {
    if (playerId && players.has(playerId)) {
      const player = players.get(playerId);
      players.delete(playerId);
      console.log(`[LEAVE] ${player.nick} (${player.id}) left [total: ${players.size}]`);
      broadcast({ t: 'left', id: playerId });
      playerId = null;
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// Snapshot broadcast tick. Serialize once and send the same immutable packet
// to everyone; clients already ignore their own id. This avoids constructing
// and encoding N nearly-identical snapshots for N connected players.
const snapshotInterval = setInterval(() => {
  if (players.size === 0) return;

  const now = Date.now();
  const states = {};
  for (const [id, player] of players) {
    if (player.lastState) {
      states[id] = player.lastState;
    }
  }

  if (Object.keys(states).length === 0) return;

  const serialized = JSON.stringify({ t: 'snapshot', ts: now, states });
  for (const player of players.values()) safeSend(player.ws, serialized);
}, TICK_INTERVAL_MS);

// Heartbeat & liveness check (15s)
// Uses application-level activity (lastSeen) because Cloudflare Quick Tunnels
// frequently intercept or drop low-level WebSocket ping/pong control frames.
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, player] of players) {
    if (now - player.lastSeen > 40000) {
      console.log(`[TIMEOUT] Player ${player.nick} (${id}) inactive for >40s, closing socket`);
      player.ws.terminate();
    }
  }
  wss.clients.forEach(ws => {
    try { ws.ping(); } catch { /* ignore */ }
  });
}, HEARTBEAT_INTERVAL_MS);

// Summary logging interval (60s)
let lastSummaryTime = Date.now();
let lastSummaryMsgCount = 0;
const summaryInterval = setInterval(() => {
  const now = Date.now();
  const elapsedSec = (now - lastSummaryTime) / 1000;
  const msgDelta = totalMessagesReceived - lastSummaryMsgCount;
  const rate = (msgDelta / elapsedSec).toFixed(1);
  console.log(`[STATUS] Players: ${players.size}/${MAX_PLAYERS} | ${rate} msgs/sec | Uptime: ${Math.floor(process.uptime())}s`);
  lastSummaryTime = now;
  lastSummaryMsgCount = totalMessagesReceived;
}, SUMMARY_INTERVAL_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DriveAtBaku Multiplayer Server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

function shutdown() {
  clearInterval(snapshotInterval);
  clearInterval(heartbeatInterval);
  clearInterval(summaryInterval);
  wss.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
