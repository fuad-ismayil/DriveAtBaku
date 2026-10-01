import assert from 'node:assert/strict';
import { accelerationPullback, chaseCameraOffset } from '../src/cameraTuning.js';

for (const vehicle of ['ferrari', 'elantra', 'amg', 'prado']) {
  const surge = accelerationPullback(8, 30);
  const cruising = accelerationPullback(3, 115);
  const topSpeed = accelerationPullback(3, 180);
  assert.ok(surge > 1.4 && surge <= 1.55, 'hard launch should produce a short camera kick');
  assert.ok(cruising < surge && cruising > 0, 'camera should ease back as acceleration fades');
  assert.equal(topSpeed, 0, 'high speed alone must not keep the camera pulled back');
  assert.equal(accelerationPullback(-2, 30), 0, 'braking must not add pullback');
  const normal = chaseCameraOffset(0, vehicle, 0, 0);
  const kicked = chaseCameraOffset(surge, vehicle, 30, 0);
  assert.ok(kicked.distance - normal.distance <= 1.55 + 1e-9, 'camera kick must stay below two metres');
  assert.ok(kicked.fov >= 55 && kicked.fov <= 65, 'dynamic follow FOV should stay cinematic');
}
assert.ok(chaseCameraOffset(0, 'prado', 0, 0).height > 2.8, 'SUV camera clears the taller body');
console.log('Acceleration pullback peaks at 1.55 m and returns at high speed.');
