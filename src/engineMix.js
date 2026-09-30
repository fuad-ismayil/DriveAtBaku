const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function smoothstep(low, high, value) {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

export function rpmWeights(points, rpm) {
  const weights = points.map(() => 0);
  if (!points.length) return weights;
  if (rpm <= points[0]) { weights[0] = 1; return weights; }
  for (let i = 1; i < points.length; i++) {
    if (rpm <= points[i]) {
      const t = smoothstep(points[i - 1], points[i], rpm);
      weights[i - 1] = Math.cos(t * Math.PI / 2);
      weights[i] = Math.sin(t * Math.PI / 2);
      return weights;
    }
  }
  weights[weights.length - 1] = 1;
  return weights;
}

export function engineMixTargets(state, vehicle) {
  const rpm = clamp(state.rpm, vehicle.idleRpm * 0.8, vehicle.redlineRpm + 300);
  const throttle = clamp(state.engineLoad ?? state.throttle ?? 0, 0, 1);
  const acceleration = clamp(state.acceleration ?? 0, -12, 12);
  const shifting = state.shiftTimer > 0;
  const idle = 1 - smoothstep(vehicle.idleRpm * 1.05, vehicle.idleRpm + 1250, rpm);
  const running = Math.sqrt(Math.max(0, 1 - idle * idle));
  const load = shifting ? 0.055 : clamp(0.08 + 0.83 * Math.pow(throttle, 0.72) + 0.08 * Math.max(0, acceleration) / 8, 0.08, 1);
  return { rpm, throttle, idle, running, load, shifting, speedKmh: Math.hypot(state.velocity.x, state.velocity.y) * 3.6 };
}

export function engineLayerGains(bank, rpm, idle, running, load) {
  const mixLoad = clamp(load, 0, 1);
  return {
    idle: (bank.idle.level ?? 1) * idle,
    on: rpmWeights(bank.on.map(layer => layer.rpm), rpm)
      .map((weight, index) => running * weight * Math.sqrt(mixLoad) * 0.98 * (bank.on[index].level ?? 1)),
    off: rpmWeights(bank.off.map(layer => layer.rpm), rpm)
      .map((weight, index) => running * weight * Math.sqrt(1 - mixLoad) * 0.78 * (bank.off[index].level ?? 1)),
  };
}
