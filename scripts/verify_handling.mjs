import assert from 'node:assert/strict';
import { createDynamicsState, stepDynamics } from '../src/vehicleDynamics.js';
import { VEHICLES } from '../src/vehicleCatalog.js';

const STEP = 1 / 120;
function accelerate(vehicle, targetKmh = 100) {
  const state = createDynamicsState(0, vehicle);
  let steps = 0;
  while (state.longitudinalSpeed < targetKmh / 3.6 && steps < 3600) {
    stepDynamics(state, { throttle: 1 }, STEP, vehicle);
    steps++;
  }
  return { state, seconds: steps * STEP };
}

const ferrari = accelerate(VEHICLES.ferrari);
const elantra = accelerate(VEHICLES.elantra);
const ferrariZeroTo30 = accelerate(VEHICLES.ferrari, 30);
const elantraZeroTo30 = accelerate(VEHICLES.elantra, 30);
assert.ok(ferrariZeroTo30.seconds < 2.2, 'Ferrari should pull away promptly from a standstill');
assert.ok(elantraZeroTo30.seconds < 3.6, 'Elantra should launch without excessive hesitation');
assert.ok(ferrari.seconds > 3 && ferrari.seconds < 8, 'Ferrari launch should reach 100 km/h');
assert.ok(elantra.seconds > ferrari.seconds && elantra.seconds < 17, 'sedan should accelerate more slowly');
assert.ok(ferrari.state.gear >= 3 && elantra.state.gear >= 3, 'automatic gearbox should upshift');

const brakeStart = ferrari.state.position.y;
let brakeSteps = 0;
while (ferrari.state.longitudinalSpeed > 0.25 && brakeSteps < 1200) {
  stepDynamics(ferrari.state, { brake: 1 }, STEP, VEHICLES.ferrari);
  brakeSteps++;
}
const brakeDistance = ferrari.state.position.y - brakeStart;
assert.ok(brakeDistance > 25 && brakeDistance < 60, 'full braking should stop in a plausible distance');
assert.ok(ferrari.state.gear === 0, 'automatic gearbox should select reverse at a stop');

const reverse = createDynamicsState(0, VEHICLES.ferrari);
for (let i = 0; i < 360; i++) stepDynamics(reverse, { brake: 1 }, STEP, VEHICLES.ferrari);
assert.ok(reverse.longitudinalSpeed < -2, 'brake pedal should drive in reverse from a stop');

const turn = createDynamicsState(0, VEHICLES.ferrari);
for (let i = 0; i < 240; i++) stepDynamics(turn, { throttle: 1, steer: 1 }, STEP, VEHICLES.ferrari);
assert.ok(turn.heading > 0.2, 'left steering should turn left');

const idle = createDynamicsState(0, VEHICLES.ferrari);
for (let i = 0; i < 600; i++) stepDynamics(idle, {}, STEP, VEHICLES.ferrari);
assert.ok(Math.abs(idle.rpm - VEHICLES.ferrari.idleRpm) < 20, 'engine should settle to idle');
assert.equal(idle.groundedWheels, 4, 'all four suspension springs should hold the car on the road');
assert.ok(idle.wheels.every(w => w.compression > 0 && w.compression < VEHICLES.ferrari.suspTravel), 'suspension should settle within travel');

const manual = createDynamicsState(0, VEHICLES.elantra);
manual.autoTransmission = false;
stepDynamics(manual, { shiftUp: true }, STEP, VEHICLES.elantra);
assert.equal(manual.gear, 2, 'manual shift should select first gear');
let revSteps = 0;
while (manual.rpm < 5000 && revSteps++ < 1600) stepDynamics(manual, { throttle: 1 }, STEP, VEHICLES.elantra);
assert.ok(manual.rpm >= 5000, 'manual test must reach a useful shift RPM');
const beforeUpshift = manual.rpm;
stepDynamics(manual, { throttle: 1, shiftUp: true }, STEP, VEHICLES.elantra);
for (let i = 0; i < 28; i++) stepDynamics(manual, { throttle: 1 }, STEP, VEHICLES.elantra);
assert.equal(manual.gear, 3);
assert.ok(manual.rpm < beforeUpshift - 350, 'RPM should fall during the upshift, matching the sound');
const beforeDownshift = manual.rpm;
stepDynamics(manual, { shiftDown: true }, STEP, VEHICLES.elantra);
for (let i = 0; i < 28; i++) stepDynamics(manual, {}, STEP, VEHICLES.elantra);
assert.equal(manual.gear, 2);
assert.ok(manual.rpm > beforeDownshift + 350, 'RPM should rise during the downshift, matching the sound');

function simulateAtFps(fps) {
  const state = createDynamicsState(0, VEHICLES.elantra);
  let accumulator = 0;
  for (let frame = 0; frame < fps * 5; frame++) {
    accumulator += 1 / fps;
    while (accumulator + 1e-10 >= STEP) {
      stepDynamics(state, { throttle: 1 }, STEP, VEHICLES.elantra);
      accumulator -= STEP;
    }
  }
  return state.position.y;
}
assert.ok(Math.abs(simulateAtFps(30) - simulateAtFps(144)) < 0.1, 'fixed-step motion should not depend on render rate');

console.log(JSON.stringify({
  ferrariZeroTo100Seconds: +ferrari.seconds.toFixed(2),
  elantraZeroTo100Seconds: +elantra.seconds.toFixed(2),
  ferrariZeroTo30Seconds: +ferrariZeroTo30.seconds.toFixed(2),
  elantraZeroTo30Seconds: +elantraZeroTo30.seconds.toFixed(2),
  ferrariBrakeDistanceMeters: +brakeDistance.toFixed(1),
  reverseSpeedKmh: +(reverse.longitudinalSpeed * 3.6).toFixed(1),
  fourWheelSuspension: idle.groundedWheels,
}, null, 2));
