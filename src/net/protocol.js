export const PROTOCOL_VERSION = 1;
export const NET_SEND_HZ = 20;
export const NET_SEND_INTERVAL_MS = Math.round(1000 / NET_SEND_HZ);
export const SERVER_TICK_HZ = 20;
export const INTERP_DELAY_MS = 100;
export const REMOTE_CARS_COLLIDE = false;

// 16 staggered grid spawn slots along the Baku starting straight
const BASE_SPAWN = [681.197388, 479.707794, 1.63323259];
const BASE_HEADING = -1.1289341745376043;
const FWD_X = -Math.sin(BASE_HEADING); // ~0.904
const FWD_Y = Math.cos(BASE_HEADING);  // ~0.427
const RIGHT_X = FWD_Y;                // ~0.427
const RIGHT_Y = -FWD_X;               // ~-0.904

export const SPAWN_POINTS = Array.from({ length: 16 }, (_, i) => {
  const row = Math.floor(i / 2);
  const col = (i % 2 === 0) ? -1 : 1;
  const fwdDist = -row * 8.5; // Staggered rows going back
  const sideDist = col * 2.3; // Staggered left/right columns
  return {
    position: [
      BASE_SPAWN[0] + FWD_X * fwdDist + RIGHT_X * sideDist,
      BASE_SPAWN[1] + FWD_Y * fwdDist + RIGHT_Y * sideDist,
      BASE_SPAWN[2],
    ],
    heading: BASE_HEADING,
  };
});

/**
 * Rounds float to fixed precision
 */
export function round(val, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

/**
 * Format client state into the §4 compact wire payload (<400 bytes)
 */
export function formatStatePayload(seq, ts, raw) {
  return {
    t: 'state',
    seq: seq >>> 0,
    ts: round(ts, 1),
    cid: raw.cid || 'ferrari',
    col: raw.col || '#a80719',
    plt: raw.plt || null,
    rpm: Math.round(raw.rpm || 900),
    gr: raw.gr ?? 1,
    p: [round(raw.p[0], 3), round(raw.p[1], 3), round(raw.p[2], 3)],
    q: [round(raw.q[0], 4), round(raw.q[1], 4), round(raw.q[2], 4), round(raw.q[3], 4)],
    v: [round(raw.v[0], 2), round(raw.v[1], 2), round(raw.v[2], 2)],
    av: [round(raw.av[0], 2), round(raw.av[1], 2), round(raw.av[2], 2)],
    spd: round(raw.spd, 1),
    in: {
      th: round(raw.in.th, 2),
      br: round(raw.in.br, 2),
      st: round(raw.in.st, 2),
      hb: raw.in.hb ? 1 : 0,
      rev: raw.in.rev ? 1 : 0,
    },
    li: {
      head: raw.li.head ?? 0,
      brake: raw.li.brake ? 1 : 0,
      rev: raw.li.rev ? 1 : 0,
    },
    w: (raw.w || []).map(wheel => {
      const entry = {
        st: round(wheel.st, 2),
        rot: round(wheel.rot, 2),
        sl: round(wheel.sl, 2),
        sk: wheel.sk ? 1 : 0,
        sm: round(wheel.sm, 2),
        c: wheel.c ? 1 : 0,
      };
      if (wheel.c && wheel.cp) {
        entry.cp = [round(wheel.cp[0], 3), round(wheel.cp[1], 3), round(wheel.cp[2], 3)];
      }
      return entry;
    }),
  };
}
