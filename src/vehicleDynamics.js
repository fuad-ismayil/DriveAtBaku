import * as THREE from 'three';
import { VEHICLES } from './vehicleCatalog.js';

const UP = new THREE.Vector3(0, 0, 1);
const clamp = THREE.MathUtils.clamp;
const approach = (value, target, rate) => value + clamp(target - value, -rate, rate);
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pacejka = ({ B, C, E }, slip) => { const x = B * slip; return Math.sin(C * Math.atan(x - E * (x - Math.atan(x)))); };
export const GEAR_LABELS = ['R', 'N', '1', '2', '3', '4', '5', '6', '7'];

function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (rpm <= curve[i][0]) {
    const [lowRpm, lowTorque] = curve[i - 1], [highRpm, highTorque] = curve[i];
    return THREE.MathUtils.lerp(lowTorque, highTorque, (rpm - lowRpm) / (highRpm - lowRpm));
  }
  return curve[curve.length - 1][1];
}
function flatGround(origin, direction, maxDistance) {
  if (direction.z >= -0.001) return null;
  const distance = -origin.z / direction.z;
  return distance >= 0 && distance <= maxDistance
    ? { distance, point: origin.clone().addScaledVector(direction, distance), normal: UP, mu: 1, rr: 0.013 } : null;
}
function shift(state, gear, settings) {
  if (gear === state.gear || gear < 0 || gear >= settings.gears.length) return;
  const launching = state.gear === 1 && gear === 2;
  state.shiftDirection = gear > state.gear ? 1 : -1;
  state.gear = gear;
  state.shiftTimer = launching ? 0.07 : settings.shiftTime;
  state.shiftCooldown = launching ? 0.28 : 0.55;
}

export function createDynamicsState(heading = 0, settings = VEHICLES.ferrari, roadPosition = new THREE.Vector3()) {
  const staticCompression = settings.massKg * 9.81 / (4 * settings.suspK);
  const comHeight = settings.wheelRadius + settings.suspRest - staticCompression - settings.hardpointZ;
  const state = {
    position: roadPosition.clone().addScaledVector(UP, comHeight),
    quaternion: new THREE.Quaternion().setFromAxisAngle(UP, heading),
    velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    force: new THREE.Vector3(), torque: new THREE.Vector3(), comHeight, staticCompression, wheels: [],
    gear: 1, autoTransmission: true, shiftTimer: 0, shiftCooldown: 0, shiftDirection: 0,
    rpm: settings.idleRpm, throttle: 0, braking: 0, engineLoad: 0, brakeForceInput: 0, steer: 0, handbrake: false, horn: false,
    yawRate: 0, heading, longitudinalSpeed: 0, lateralSpeed: 0, acceleration: 0, distance: 0,
    groundedWheels: 0, absActive: false, tcsActive: false, escActive: false, tcsFactor: 1,
    aids: { abs: true, tcs: true, esc: false }, escBrake: [0, 0, 0, 0],
    scratch: Object.fromEntries(['right','forward','up','down','hardpoint','wheelForward','wheelSide','contactVelocity','force','arm','cross','localTorque','worldAccel'].map(k => [k, new THREE.Vector3()])),
  };
  state.scratch.inverse = new THREE.Quaternion();
  state.scratch.spin = new THREE.Quaternion();
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    state.wheels.push({
      hp: new THREE.Vector3((i % 2 ? 1 : -1) * settings.trackM / 2, (front ? 1 : -1) * settings.wheelbaseM / 2, settings.hardpointZ),
      front, steer: 0, omega: 0, spinAngle: 0, compression: staticCompression,
      grounded: false, contact: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), load: 0, surfaceMu: 1,
      slipRatio: 0, slipAngle: 0, slideSpeed: 0, absFactor: 1,
    });
  }
  return state;
}

function addForceAtPoint(state, force, point) {
  const t = state.scratch;
  state.force.add(force);
  t.arm.subVectors(point, state.position);
  t.cross.crossVectors(t.arm, force);
  state.torque.add(t.cross);
}

function synchronizeStaticWheel(wheel, longitudinal, driveTorque, brake, state, settings, index) {
  if (!wheel.grounded || wheel.load <= 0 || driveTorque !== 0 || brake > 0 || state.handbrake || state.escBrake[index] > 0 || Math.abs(wheel.omega) >= 3) return;
  const oppositeGear = state.gear === 0 ? state.longitudinalSpeed > 0 : state.gear > 1 && state.longitudinalSpeed < 0;
  // Use the existing static-contact region for an unpowered opposite-gear roll;
  // ordinary travel only needs the near-rest residual-spin correction.
  const limit = oppositeGear ? 1.4 : .25;
  if (state.velocity.lengthSq() < limit * limit) wheel.omega = Math.abs(longitudinal) < .005 ? 0 : longitudinal / settings.wheelRadius;
}

function integrateWheel(wheel, index, tireForce, longitudinal, driveTorque, overrunTorque, brake, state, settings, dt) {
  const driveShare = (wheel.front ? settings.drive.front : settings.drive.rear) * 0.5;
  let torque = driveTorque * driveShare;
  // Overrun resists actual rotation in either gear. Limit it to the wheel's
  // momentum so it cannot start or reverse a stopped wheel in one step.
  torque -= Math.sign(wheel.omega) * Math.min(overrunTorque * driveShare, Math.abs(wheel.omega) * settings.wheelInertia / dt);
  if (wheel.grounded && Math.abs(wheel.slipRatio) > 0.22 && torque !== 0) {
    const limit = wheel.load * settings.wheelRadius * settings.tireGrip
      * (0.88 + 0.22 * clamp(1 - 1.4 * (Math.abs(wheel.slipRatio) - 0.22), 0, 1));
    torque = clamp(torque, -limit, limit);
  }
  wheel.omega += torque / settings.wheelInertia * dt;
  if (wheel.grounded) {
    const groundOmega = longitudinal / settings.wheelRadius;
    const reaction = -tireForce * settings.wheelRadius / settings.wheelInertia * dt;
    wheel.omega = (wheel.omega - groundOmega) * (wheel.omega + reaction - groundOmega) <= 0
      ? groundOmega : wheel.omega + reaction;
  }
  let brakeTorque = brake * settings.brakeTorqueMax * (wheel.front ? settings.brakeBias : 1 - settings.brakeBias);
  if (state.aids.abs && brakeTorque > 0 && wheel.grounded && state.velocity.lengthSq() > 4) {
    // Hold the tyre near peak braking force rather than releasing it almost
    // completely after a lock.  This makes the pedal more immediate and cuts
    // wheel slip while retaining a natural, progressive stop.
    if (wheel.slipRatio < -0.12) { wheel.absFactor = 0.38; state.absActive = true; }
    else wheel.absFactor = Math.min(1, wheel.absFactor + 14 * dt);
    brakeTorque *= wheel.absFactor;
  } else wheel.absFactor = 1;
  brakeTorque += state.escBrake[index];
  if (state.handbrake && !wheel.front) brakeTorque += settings.handbrakeTorque;
  const change = brakeTorque / settings.wheelInertia * dt;
  wheel.omega = Math.abs(wheel.omega) <= change ? 0 : wheel.omega - Math.sign(wheel.omega) * change;
  // The existing static-contact blend removes tire reaction at rest. Synchronize
  // free, loaded wheels there so suspension settling cannot leave residual spin.
  // Keep powered launches, wheelspin, airborne wheels and normal rolling intact.
  synchronizeStaticWheel(wheel, longitudinal, driveTorque, brake, state, settings, index);
  wheel.omega = clamp(wheel.omega, -320, 320);
  wheel.spinAngle += wheel.omega * dt;
}

export function stepDynamics(state, input, dt, settings = VEHICLES.ferrari, sampleGround = flatGround) {
  const q = state.quaternion, t = state.scratch;
  t.right.set(1, 0, 0).applyQuaternion(q);
  t.forward.set(0, 1, 0).applyQuaternion(q);
  t.up.set(0, 0, 1).applyQuaternion(q);
  t.down.copy(t.up).negate();
  const speedBefore = state.velocity.dot(t.forward), speed = state.velocity.length();
  const limit = THREE.MathUtils.lerp(settings.maxSteer, settings.steerHighSpeed, clamp(speed / 42, 0, 1));
  state.steer = approach(state.steer, clamp(input.steer ?? 0, -1, 1) * limit, 4.2 * dt);
  const throttleTarget = clamp(input.throttle ?? 0, 0, 1), brakeTarget = clamp(input.brake ?? 0, 0, 1);
  state.throttle = approach(state.throttle, throttleTarget, (throttleTarget > state.throttle ? 7 : 8) * dt);
  state.braking = approach(state.braking, brakeTarget, (brakeTarget > state.braking ? 9 : 11) * dt);
  state.handbrake = Boolean(input.handbrake);
  state.horn = Boolean(input.horn);

  // Reference gearbox: reverse / neutral / 1st..., with automatic reverse at a stop.
  const gas = state.gear === 0 && state.autoTransmission ? state.braking : state.throttle;
  const brake = state.gear === 0 && state.autoTransmission ? state.throttle : state.braking;
  state.tcsActive = false;
  if (state.aids.tcs && state.gear !== 1) {
    let highestSlip = 0;
    for (const wheel of state.wheels) if (wheel.grounded && (wheel.front ? settings.drive.front : settings.drive.rear))
      highestSlip = Math.max(highestSlip, state.gear === 0 ? -wheel.slipRatio : wheel.slipRatio);
    const target = highestSlip > 0.16 ? clamp(1 - 1.8 * (highestSlip - 0.16), 0.65, 1) : 1;
    state.tcsFactor += (target - state.tcsFactor) * clamp(dt * (target < state.tcsFactor ? 30 : 4.5), 0, 1);
    state.tcsActive = state.tcsFactor < 0.92 && gas > 0.1;
  } else state.tcsFactor = 1;
  const effectiveGas = gas * state.tcsFactor;
  state.engineLoad = effectiveGas;
  state.brakeForceInput = brake;

  state.escActive = false;
  state.escBrake.fill(0);
  if (state.aids.esc && Math.abs(speedBefore) > 5 && state.gear !== 1) {
    const desiredYaw = clamp(Math.tan(state.steer) * speedBefore / settings.wheelbaseM, -1.3, 1.3);
    const error = state.angularVelocity.dot(t.up) - desiredYaw;
    if (Math.abs(error) > 0.28) {
      const correction = clamp(1.5 * (Math.abs(error) - 0.28), 0, 1);
      state.escActive = true;
      if (error > 0) { state.escBrake[0] = 1700 * correction; state.escBrake[2] = 750 * correction; }
      else { state.escBrake[1] = 1700 * correction; state.escBrake[3] = 750 * correction; }
    }
  }

  state.shiftTimer = Math.max(0, state.shiftTimer - dt);
  state.shiftCooldown = Math.max(0, state.shiftCooldown - dt);
  let wheelOmega = 0, drivenCount = 0;
  for (const wheel of state.wheels) if (wheel.front ? settings.drive.front : settings.drive.rear) { wheelOmega += wheel.omega; drivenCount++; }
  wheelOmega = drivenCount ? wheelOmega / drivenCount : 0;
  let ratio = settings.gears[state.gear] * settings.finalDrive;
  let coupled = state.gear !== 1 && state.shiftTimer <= 0 && !input.clutch;
  const wheelRpm = Math.max(settings.idleRpm, 60 * Math.abs(wheelOmega * ratio) / (2 * Math.PI));
  const freeRpm = settings.idleRpm + effectiveGas * (settings.redlineRpm - settings.idleRpm);
  const shiftRpm = state.shiftDirection > 0
    ? Math.min(state.rpm, wheelRpm + 220)
    : Math.max(state.rpm, Math.min(settings.redlineRpm, wheelRpm + 250));
  const rpmTarget = coupled ? wheelRpm : state.shiftTimer > 0 && state.gear > 1 ? shiftRpm : freeRpm;
  const rpmResponse = coupled ? 30 : state.shiftTimer > 0 ? (state.shiftDirection > 0 ? 10 : 12) : 4;
  state.rpm += (rpmTarget - state.rpm) * clamp(rpmResponse * dt, 0, 1);
  state.rpm = clamp(state.rpm, settings.idleRpm * 0.8, settings.redlineRpm + 300);
  if (state.autoTransmission && state.shiftCooldown <= 0) {
    if (state.gear >= 2 && state.rpm > settings.redlineRpm - 350 && state.gear < settings.gears.length - 1) shift(state, state.gear + 1, settings);
    else if (state.gear > 2 && state.rpm < settings.idleRpm + 1000) shift(state, state.gear - 1, settings);
    else if (state.gear >= 1 && brakeTarget > 0.4 && speedBefore < 0.6 && speedBefore > -3) shift(state, 0, settings);
    else if (state.gear === 0 && throttleTarget > 0.4 && speedBefore > -0.6) shift(state, 2, settings);
    else if (state.gear === 1 && throttleTarget > 0.2) shift(state, 2, settings);
  } else if (!state.autoTransmission) {
    if (input.shiftUp) shift(state, state.gear + 1, settings);
    if (input.shiftDown) shift(state, state.gear - 1, settings);
  }
  ratio = settings.gears[state.gear] * settings.finalDrive;
  coupled = state.gear !== 1 && state.shiftTimer <= 0 && !input.clutch;
  let engineTorque = 0, engineOverrun = 0;
  if (coupled && state.rpm < settings.redlineRpm + 150) {
    const launchAssist = 1 + ((settings.launchTorqueMultiplier ?? 1) - 1)
      * (1 - smooth(3, 12, Math.abs(speedBefore)));
    engineTorque = torqueAt(settings.torqueCurve, state.rpm) * effectiveGas * launchAssist;
    engineOverrun = settings.engineBraking * state.rpm / settings.redlineRpm * (1 - effectiveGas);
  }
  const driveTorque = engineTorque * ratio * settings.drivelineEff;
  const overrunTorque = engineOverrun * Math.abs(ratio) * settings.drivelineEff;

  state.force.set(0, 0, -9.81 * settings.massKg);
  state.torque.set(0, 0, 0);
  state.force.addScaledVector(state.velocity, -settings.dragCoef * speed);
  state.force.z += settings.liftCoef * speedBefore * Math.abs(speedBefore) * 0.5;
  state.groundedWheels = 0;
  state.absActive = false;
  let highestRoad = -Infinity;
  const maxRay = settings.suspRest + settings.wheelRadius + 0.15;
  for (let index = 0; index < 4; index++) {
    const wheel = state.wheels[index];
    wheel.steer = wheel.front ? state.steer : 0;
    t.hardpoint.copy(wheel.hp).applyQuaternion(q).add(state.position);
    const hit = sampleGround(t.hardpoint, t.down, maxRay);
    const previousCompression = wheel.compression;
    if (!hit) {
      wheel.grounded = false; wheel.compression = 0; wheel.load = 0; wheel.slideSpeed = 0;
      integrateWheel(wheel, index, 0, 0, driveTorque, overrunTorque, brake, state, settings, dt);
      continue;
    }
    wheel.grounded = true;
    wheel.surfaceMu = hit.mu ?? 1;
    state.groundedWheels++;
    wheel.contact.copy(hit.point);
    wheel.normal.copy(hit.normal ?? UP).normalize();
    if (wheel.normal.dot(t.up) < 0) wheel.normal.negate();
    highestRoad = Math.max(highestRoad, hit.point.z);
    wheel.compression = clamp(settings.suspRest + settings.wheelRadius - hit.distance, 0, settings.suspRest);
    const compressionRate = (wheel.compression - previousCompression) / dt;
    let spring = settings.suspK * wheel.compression;
    if (wheel.compression > settings.suspTravel) spring += settings.bumpStopK * (wheel.compression - settings.suspTravel);
    wheel.load = Math.max(0, spring + (compressionRate > 0 ? settings.suspCComp : settings.suspCReb) * compressionRate);
    t.force.copy(t.up).multiplyScalar(wheel.load);
    addForceAtPoint(state, t.force, t.hardpoint);

    t.wheelForward.set(-Math.sin(wheel.steer), Math.cos(wheel.steer), 0).applyQuaternion(q);
    t.wheelForward.addScaledVector(wheel.normal, -t.wheelForward.dot(wheel.normal)).normalize();
    t.wheelSide.crossVectors(t.wheelForward, wheel.normal).normalize();
    t.arm.subVectors(wheel.contact, state.position);
    t.contactVelocity.crossVectors(state.angularVelocity, t.arm).add(state.velocity);
    const longitudinal = t.contactVelocity.dot(t.wheelForward), lateral = t.contactVelocity.dot(t.wheelSide);
    synchronizeStaticWheel(wheel, longitudinal, driveTorque, brake, state, settings, index);
    const wheelSurfaceSpeed = wheel.omega * settings.wheelRadius;
    wheel.slipRatio = (wheelSurfaceSpeed - longitudinal) / Math.max(Math.abs(longitudinal), 2.2);
    wheel.slipAngle = Math.atan2(lateral, Math.abs(longitudinal) + 0.6);
    wheel.slideSpeed = Math.hypot(wheelSurfaceSpeed - longitudinal, lateral);
    const grip = (hit.mu ?? 1) * wheel.load * settings.tireGrip;
    let fx = pacejka(settings.pacLong, wheel.slipRatio) * grip;
    let lateralScale = settings.latGripScale * (wheel.front ? 1 : settings.rearLatScale);
    if (state.handbrake && !wheel.front) lateralScale *= 0.55;
    let fy = -pacejka(settings.pacLat, wheel.slipAngle) * grip * lateralScale;
    const combined = Math.hypot(fx, fy);
    if (combined > grip && combined > 0) { fx *= grip / combined; fy *= grip / combined; }
    const stick = smooth(1.4, 0.25, speed) * smooth(3, 0.5, Math.abs(wheel.omega));
    if (stick > 0) {
      fx = THREE.MathUtils.lerp(fx, clamp(-longitudinal * wheel.load * 1.8, -grip, grip), stick);
      fy = THREE.MathUtils.lerp(fy, clamp(-lateral * wheel.load * 1.8, -grip, grip), stick);
    }
    const rolling = -(hit.rr ?? 0.013) * wheel.load * clamp(longitudinal / 0.8, -1, 1);
    t.force.copy(t.wheelForward).multiplyScalar(fx + rolling).addScaledVector(t.wheelSide, fy);
    addForceAtPoint(state, t.force, wheel.contact);
    integrateWheel(wheel, index, fx, longitudinal, driveTorque, overrunTorque, brake, state, settings, dt);
  }

  state.velocity.addScaledVector(state.force, dt / settings.massKg);
  const { width, length, height } = settings.dims;
  const ix = settings.massKg * (length * length + height * height) / 12;
  const iy = settings.massKg * (width * width + height * height) / 12;
  const iz = settings.massKg * (width * width + length * length) / 12;
  t.inverse.copy(q).invert();
  t.localTorque.copy(state.torque).applyQuaternion(t.inverse);
  t.localTorque.set(t.localTorque.x / ix, t.localTorque.y / iy, t.localTorque.z / iz);
  t.worldAccel.copy(t.localTorque).applyQuaternion(q);
  state.angularVelocity.addScaledVector(t.worldAccel, dt).multiplyScalar(1 - 0.12 * dt);
  state.angularVelocity.x = clamp(state.angularVelocity.x, -2.5, 2.5);
  state.angularVelocity.y = clamp(state.angularVelocity.y, -2.5, 2.5);
  state.angularVelocity.z = clamp(state.angularVelocity.z, -4, 4);
  state.position.addScaledVector(state.velocity, dt);
  const rotation = state.angularVelocity.length() * dt;
  if (rotation > 1e-9) {
    t.spin.setFromAxisAngle(t.worldAccel.copy(state.angularVelocity).normalize(), rotation);
    q.premultiply(t.spin).normalize();
  }
  if (highestRoad > -Infinity && state.position.z < highestRoad + 0.25) {
    state.position.z = highestRoad + 0.25;
    if (state.velocity.z < 0) state.velocity.z *= -0.25;
  }
  t.forward.set(0, 1, 0).applyQuaternion(q);
  t.right.set(1, 0, 0).applyQuaternion(q);
  state.heading = Math.atan2(-t.forward.x, t.forward.y);
  state.yawRate = state.angularVelocity.z;
  state.longitudinalSpeed = state.velocity.dot(t.forward);
  state.lateralSpeed = state.velocity.dot(t.right);
  state.acceleration = (state.longitudinalSpeed - speedBefore) / dt;
  state.distance += Math.hypot(state.velocity.x, state.velocity.y) * dt;
  return state.position;
}
