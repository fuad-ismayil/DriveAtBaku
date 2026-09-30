import assert from 'node:assert/strict';
import { DriveCameraControls } from '../src/driveCameraControls.js';

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const settle = (camera, speed, frames = 90) => {
  let pose;
  for (let i = 0; i < frames; i++) pose = camera.update(1 / 60, speed);
  return pose;
};

const camera = new DriveCameraControls();
for (let i = 0; i < 65; i++) camera.move(50, 0, 0);
assert.ok(Math.abs(settle(camera, 0).yaw) > 5.6, 'stationary mouse look must cover a full circle');
assert.ok(Math.abs(settle(camera, 24).yaw) > 5.6, 'camera must remain free below 25 km/h');
const beforeTransition = camera.yaw;
camera.update(1 / 60, 27);
assert.ok(Math.abs(camera.yaw - beforeTransition) < 0.1, 'restriction transition must not snap');
assert.ok(Math.abs(camera.yaw - beforeTransition) < 0.15, 'high speed must not abruptly clamp the orbit');

camera.reset();
camera.move(20, 8, 0);
assert.ok(Math.abs(settle(camera, 0, 45).yaw) < 0.04, 'small stopped-car mouse movement must not swing the camera');
camera.reset();
camera.move(20, 8, 70);
assert.ok(Math.abs(settle(camera, 70, 25).yaw) < 0.12, 'precise mouse input should be gentle');
for (let i = 0; i < 10; i++) camera.move(70, -40, 70);
assert.ok(Math.abs(wrap(settle(camera, 70, 45).yaw)) > 0.57, 'camera must remain free to orbit at speed');
assert.ok(Math.abs(wrap(settle(camera, 70, 300).yaw)) < 0.1, 'high-speed orbit should recenter after mouse input stops');
camera.setRearHeld(true);
assert.ok(Math.abs(Math.abs(wrap(settle(camera, 70).yaw)) - Math.PI) < 0.03, 'middle hold must show the front of the car');
camera.setRearHeld(false);
assert.ok(Math.abs(wrap(settle(camera, 70).yaw)) < 0.03, 'middle release must return behind the car');
camera.reset();
for (let i = 0; i < 65; i++) camera.move(50, 0, 0);
assert.ok(Math.abs(settle(camera, 0).yaw) > 5.6, 'reverse uses the low-speed orbit rather than a forced camera flip');
camera.reset();
for (let i = 0; i < 160; i++) { camera.edgeMove(1, 0, 1 / 60, 0); camera.update(1 / 60, 0); }
assert.ok(Math.abs(camera.yaw) > 5.6, 'screen-edge fallback must permit full orbit without pointer lock');
console.log('Camera: stationary/reverse 360°, unrestricted smooth orbit, gentle small movements, high-speed recentring, middle hold/release passed.');
