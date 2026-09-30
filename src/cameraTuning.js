const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

// Acceleration makes a short camera kick, but sustained high speed does not
// keep pushing the camera away from the car.
export function accelerationPullback(accelerationMps2, speedKmh) {
  const surge = clamp((accelerationMps2 - 0.8) / 5.2, 0, 1);
  const highSpeedFade = 1 - smoothstep(45, 155, speedKmh);
  return 1.55 * surge * highSpeedFade;
}

export function chaseCameraOffset(pullbackMetres, vehicleId, speedKmh, yawRate) {
  const cruise = smoothstep(0, 150, speedKmh);
  const turn = clamp(Math.abs(yawRate) / 1.2, 0, 1);
  return {
    distance: (vehicleId === 'elantra' ? 6.1 : 5.85) + clamp(pullbackMetres, 0, 1.55),
    height: 2.35 + 0.1 * cruise + 0.1 * turn + 0.08 * clamp(pullbackMetres, 0, 1.55),
    fov: 60 + 2 * cruise + 1.2 * clamp(pullbackMetres, 0, 1.55) / 1.55,
  };
}
