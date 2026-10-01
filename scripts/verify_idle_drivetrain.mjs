import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDynamicsState, stepDynamics } from '../src/vehicleDynamics.js';
import { VEHICLES } from '../src/vehicleCatalog.js';

const dt = 1 / 120;
const run = (state, vehicle, seconds, input = {}, ground) => {
  for (let i = 0; i < seconds / dt; i++) stepDynamics(state, input, dt, vehicle, ground);
};
for (const vehicle of Object.values(VEHICLES)) {
  for (const heading of [0, 1.3]) for (const gear of [0, 1, 2]) {
    const state = createDynamicsState(heading, vehicle);
    state.autoTransmission = false;
    // Select through the same shift path as the game, including the clutch delay.
    if (gear !== 1) stepDynamics(state, gear === 0 ? { shiftDown: true } : { shiftUp: true }, dt, vehicle);
    run(state, vehicle, 60);
    assert.equal(state.gear, gear);
    assert.ok(state.velocity.length() < 1e-8, `${vehicle.id} ${gear}: no unpowered creep`);
    assert.ok(Math.hypot(state.position.x, state.position.y) < 1e-8, 'idle engine braking creates no body motion');
    assert.ok(state.wheels.every(w => w.omega === 0 && w.spinAngle === 0), 'reset wheels remain stopped in N, R and 1st');
  }
  for (const omega of [-.585, .585]) {
    const state = createDynamicsState(0, vehicle);
    run(state, vehicle, 1);
    state.wheels.forEach(w => { w.omega = omega; });
    run(state, vehicle, 5);
    assert.ok(state.velocity.length() < .005, 'small residual wheel spin cannot propel the car');
    assert.ok(state.wheels.every(w => w.omega === 0), 'static contact removes residual suspension-settling spin');
    const angles = state.wheels.map(w => w.spinAngle);
    run(state, vehicle, 5);
    assert.deepEqual(state.wheels.map(w => w.spinAngle), angles, 'settled wheels do not keep visually rotating');
  }
  // Wrong-direction coasting must dissipate energy rather than accelerate.
  for (const [gear, velocity] of [[0, 3], [2, -3]]) {
    const state = createDynamicsState(0, vehicle);
    state.autoTransmission = false; state.gear = gear;
    state.velocity.y = velocity;
    state.wheels.forEach(w => { w.omega = velocity / vehicle.wheelRadius; });
    run(state, vehicle, 5);
    assert.ok(Math.abs(state.longitudinalSpeed) < Math.abs(velocity) * .8, 'overrun slows an opposite-direction roll');
    run(state, vehicle, 25);
    assert.ok(Math.abs(state.longitudinalSpeed) < .05, 'opposite gear cannot cause a runaway at zero throttle');
  }
  for (const [gear, direction] of [[0, -1], [2, 1]]) {
    const state = createDynamicsState(0, vehicle);
    state.autoTransmission = false; state.gear = gear;
    run(state, vehicle, 3, { throttle: 1 });
    assert.ok(state.longitudinalSpeed * direction > 1, 'powered pullaway still follows the selected gear');
    assert.ok(state.wheels.every(w => w.omega * direction > 0), 'wheel rotation follows powered road travel');
  }
  const airborne = createDynamicsState(0, vehicle);
  airborne.wheels.forEach(w => { w.omega = .585; });
  run(airborne, vehicle, .1, {}, () => null);
  assert.ok(airborne.wheels.every(w => w.omega === .585), 'neutral airborne wheels are not artificially synchronized');
  const spinning = createDynamicsState(0, vehicle);
  spinning.wheels.forEach(w => { w.omega = 20; });
  stepDynamics(spinning, {}, dt, vehicle);
  assert.ok(spinning.wheels.some(w => Math.abs(w.omega) > 3), 'static correction does not erase a burnout');
  // Gravity-driven rolling remains available; this is not a global velocity clamp.
  const normal = new THREE.Vector3(0, -.1, 1).normalize();
  const slope = (origin, direction, maxDistance) => {
    const distance = -origin.dot(normal) / direction.dot(normal);
    return distance >= 0 && distance <= maxDistance
      ? { distance, point: origin.clone().addScaledVector(direction, distance), normal, mu: 1, rr: .013 } : null;
  };
  const downhill = createDynamicsState(0, vehicle);
  run(downhill, vehicle, 3, {}, slope);
  assert.ok(downhill.position.y < -.01, 'neutral car can still roll downhill');
}
console.log('Idle drivetrain: both cars, reset/60s N/R/1st idle, residual wheel spin, opposite-gear coasting, powered directions, airborne spin, burnout and downhill roll passed.');
