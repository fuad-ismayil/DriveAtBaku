import { writeFileSync } from 'node:fs';
import { VEHICLES } from '../../src/vehicleCatalog.js';
import { ENGINE_BANKS } from '../../src/engineAudio.js';
import { engineMixTargets, rpmWeights } from '../../src/engineMix.js';
import { RoomLightActivity } from '../../src/roomLightActivity.js';
const audio = [];
for (const [id, vehicle] of Object.entries(VEHICLES)) for (const rpm of [vehicle.idleRpm, 1800, 3200, 4500, 5900, 7400]) for (const load of [0, .35, 1]) for (const shifting of [false, true]) {
  const state = { rpm, engineLoad: load, throttle: .5, acceleration: load * 6, shiftTimer: shifting ? .1 : 0, velocity: { x: 0, y: 0 } };
  const target = engineMixTargets(state, vehicle);
  audio.push({ id, state: { rpm, engine_load: load, throttle: .5, acceleration: load * 6, shift_timer: state.shiftTimer }, target, on: rpmWeights(ENGINE_BANKS[id].on.map(x=>x.rpm), target.rpm), off: rpmWeights(ENGINE_BANKS[id].off.map(x=>x.rpm), target.rpm) });
}
const activity = new RoomLightActivity(64, { seed: 599 }); activity.setNight(true);
const rooms = [];
for (let i=0;i<360;i++) { activity.update(10); if (i%6 === 0) rooms.push({ time: activity.time, states: [...activity.states], events: activity.events }); }
writeFileSync('android/game/assets/data/presentation-reference.json', JSON.stringify({ audio, rooms }));
console.log(`Prepared ${audio.length} audio targets and ${rooms.length} independent-room reference snapshots.`);
