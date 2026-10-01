import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTireEffects } from '../src/tireEffects.js';
import { createDynamicsState } from '../src/vehicleDynamics.js';
import { VEHICLES } from '../src/vehicleCatalog.js';

const scene = new THREE.Scene(), effects = createTireEffects(scene), vehicle = VEHICLES.elantra;
const state = createDynamicsState(0, vehicle);
state.velocity.set(0, 12, 0);
for (const wheel of state.wheels) { wheel.grounded = true; wheel.load = 3000; wheel.contact.copy(wheel.hp).setZ(0); }
function step(n, slip = 15, weather = { wet: 0, snow: 0 }) {
  for (let i = 0; i < n; i++) {
    for (const wheel of state.wheels) { wheel.slideSpeed = slip; wheel.contact.y += .2; }
    effects.update(1 / 60, state, vehicle, weather, true);
  }
}
step(60, 0); assert.equal(effects.stats.marks, 0); assert.equal(effects.stats.emittedSmoke, 0, 'rolling tires create neither smoke nor skid marks');
step(60); assert.ok(effects.stats.marks > 0 && effects.stats.emittedSmoke > 0, 'loaded sliding tires produce marks and small puffs');
const marks = scene.getObjectByName('tire marks'), smoke = scene.getObjectByName('subtle tire smoke');
assert.ok(marks.visible && smoke.visible);
assert.equal(smoke.userData.excludeFromReflection, true, 'transient smoke never enters car reflection captures');
for (const v of marks.geometry.getAttribute('position').array) assert.ok(Number.isFinite(v));
for (let i = 0; i < marks.geometry.drawRange.count; i++) assert.ok(Math.abs(marks.geometry.getAttribute('position').getZ(i) - .012) < .00001, 'marks conform to contact planes without z fighting');
for (let i = 0; i < smoke.geometry.instanceCount; i++) assert.ok(smoke.geometry.getAttribute('particle').getZ(i) <= .11, 'puff opacity stays subtle');
let before = effects.stats.marks;
for (const wheel of state.wheels) wheel.contact.y += 100;
step(1); assert.equal(effects.stats.marks, before, 'teleports cannot draw rubber ribbons across the world');
effects.reset(); let emitted = effects.stats.emittedSmoke;
step(90, 15, { wet: 1, snow: 0 }); assert.equal(effects.stats.emittedSmoke, emitted, 'wet tires do not emit dry rubber smoke');
step(90, 15, { wet: .25, snow: .9 }); assert.equal(effects.stats.emittedSmoke, emitted, 'snow suppresses dry rubber smoke');
before = effects.stats.marks;
for (const wheel of state.wheels) wheel.grounded = false;
step(60); assert.equal(effects.stats.marks, before); assert.equal(effects.stats.emittedSmoke, emitted, 'airborne tires emit nothing');
for (const wheel of state.wheels) { wheel.grounded = true; wheel.surfaceMu = .65; }
step(60); assert.equal(effects.stats.marks, before, 'grass never receives asphalt rubber strips');
for (const wheel of state.wheels) wheel.surfaceMu = 1;
step(700); assert.equal(marks.geometry.drawRange.count, effects.stats.markLimit * 6, 'mark buffers stay bounded under sustained sliding');
assert.ok(effects.stats.activeSmoke <= effects.stats.smokeLimit);
effects.update(2, state, vehicle, {}, false); assert.equal(smoke.visible, false, 'puffs fade promptly after sliding stops');
effects.update(.1, state, vehicle, {}, false, false); assert.equal(marks.visible, false, 'garage hides road effects');
effects.reset(); before = effects.stats.marks; step(1); assert.equal(effects.stats.marks, before, 'recovering starts a new contact history');
let released = 0;
for (const object of [marks, smoke]) { object.geometry.addEventListener('dispose', () => released++); object.material.addEventListener('dispose', () => released++); }
effects.dispose(); assert.equal(scene.children.length, 0); assert.equal(released, 4);
console.log('Tire effects: rolling/sliding, real contact planes, wet/snow/grass/airborne suppression, teleport breaks, fading, bounded pools and cleanup passed.');
