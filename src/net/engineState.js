// Reconstruct presentation from authoritative drivetrain state, never speed.
export function remoteEngineState(a, b = a, alpha = 0) {
  if (a.cid && b.cid && a.cid !== b.cid) { a = b; alpha = 0; }
  const discrete = alpha < 1 ? a : b;
  const blend = (x, y) => x + (y - x) * alpha;
  const load = s => s.au?.ld ?? s.in?.th ?? 0;
  return {
    rpm: blend(a.rpm ?? 900, b.rpm ?? 900),
    engineLoad: blend(load(a), load(b)),
    acceleration: blend(a.au?.ac ?? 0, b.au?.ac ?? 0),
    shiftTimer: discrete.au?.sh ?? 0,
    gear: discrete.gr ?? 1,
    velocity: { x: discrete.v?.[0] ?? 0, y: discrete.v?.[1] ?? 0 },
    throttle: discrete.in?.th ?? 0,
    braking: discrete.in?.br ?? 0,
    handbrake: Boolean(discrete.in?.hb),
    horn: Boolean(discrete.in?.hn),
    wheels: (discrete.w ?? []).map(wheel => ({ grounded: Boolean(wheel.c), slideSpeed: wheel.sl ?? 0 })),
  };
}
