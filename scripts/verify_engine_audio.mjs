import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { engineLayerGains, engineMixTargets, rpmWeights } from '../src/engineMix.js';
import { ENGINE_BANKS, EngineAudio } from '../src/engineAudio.js';
import { VEHICLES } from '../src/vehicleCatalog.js';

const points = [900, 2400, 4500, 7000];
for (let rpm = 700; rpm <= 9000; rpm += 100) {
  const weights = rpmWeights(points, rpm);
  assert.ok(weights.every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 1));
  assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight * weight, 0) - 1) < 1e-9);
}
const state = { rpm: 900, throttle: 0, engineLoad: 0, acceleration: 0, shiftTimer: 0, velocity: { x: 0, y: 0 } };
assert.equal(engineMixTargets(state, VEHICLES.ferrari).idle, 1);
state.rpm = 5000;
const coast = engineMixTargets(state, VEHICLES.ferrari);
state.engineLoad = 1;
state.acceleration = 7;
const full = engineMixTargets(state, VEHICLES.ferrari);
assert.ok(full.load > coast.load + 0.75, 'full throttle needs a different recorded mix');
state.shiftTimer = 0.12;
assert.ok(engineMixTargets(state, VEHICLES.ferrari).load < coast.load, 'shift must unload the engine');

for (const vehicle of Object.values(VEHICLES)) {
  const bank = ENGINE_BANKS[vehicle.id];
  for (const throttle of [0, 1]) for (let rpm = vehicle.idleRpm; rpm <= vehicle.redlineRpm; rpm += 100) {
    const probe = { ...state, rpm, throttle, engineLoad: throttle, shiftTimer: 0 };
    const target = engineMixTargets(probe, vehicle);
    const layers = engineLayerGains(bank, rpm, target.idle, target.running, target.load);
    const presence = Math.hypot(layers.idle, ...layers.on, ...layers.off) * vehicle.soundVol;
    assert.ok(presence > 0.55, `${vehicle.id} needs continuous engine presence at ${rpm} RPM`);
  }
}

for (const file of ['car-rpm-0.wav', 'car-rpm-1.wav', 'car-rpm-2.wav', 'car-rpm-3.wav', 'car-rpm-4.wav', 'car-rpm-5.wav', 'v8-load-5570.wav', 'v8-overrun-5580.wav']) {
  const path = fileURLToPath(new URL(`../public/assets/audio/engines/${file}`, import.meta.url));
  assert.ok(statSync(path).size > 30000, `${file} must be a recorded audio asset`);
  assert.equal(readFileSync(path).toString('ascii', 0, 4), 'RIFF', `${file} must be a WAV file`);
}
// Exercise the real audio update path without requiring an audio device.
const parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
const layer = () => ({ gain: { gain: parameter() }, source: { playbackRate: parameter() }, rpm: 1000 });
const audio = new EngineAudio(); audio.context = { currentTime: 0, state: 'running' };
for (const name of ['wind', 'skid']) audio[name] = { gain: { gain: parameter() }, filter: { frequency: parameter() } };
audio.horn = { gain: parameter() }; audio.master = { gain: parameter() };
for (const [id, config] of Object.entries(ENGINE_BANKS)) audio.banks.set(id, {
  config, bus: { gain: parameter() }, tone: { frequency: parameter() }, idle: layer(),
  on: config.on.map(layer), off: config.off.map(layer),
});
const audioState = { ...state, rpm: 3000, shiftTimer: 0, gear: 2, wheels: [{ grounded: true, slideSpeed: 10.2 }] };
audio.update(audioState, VEHICLES.elantra, true);
assert.ok(Math.abs(audio.banks.get('elantra').bus.gain.value / (VEHICLES.elantra.soundVol * .95) - 1.6) < 1e-9, 'Elantra engine bus has the requested additional presence');
assert.equal(audio.banks.get('ferrari').bus.gain.value, 0, 'inactive car stays silent');
assert.ok(Math.abs(audio.skid.gain.gain.value - .14) < 1e-9, 'moderate tire slip is 30% quieter');
audioState.wheels[0].slideSpeed = 100; audio.update(audioState, VEHICLES.elantra, true);
assert.equal(audio.skid.gain.gain.value, .16, 'extreme squeal has a lower ceiling');
audio.update(audioState, VEHICLES.elantra, false);
assert.equal(audio.skid.gain.gain.value, 0); assert.equal(audio.banks.get('elantra').bus.gain.value, 0);
console.log('Audio: recorded assets, RPM crossfades, continuous presence, load/coast/shift mix, Elantra presence, restrained slip and pause muting passed.');
