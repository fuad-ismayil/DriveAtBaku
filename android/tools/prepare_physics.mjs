import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { VEHICLES } from '../../src/vehicleCatalog.js';
import { createDynamicsState, stepDynamics } from '../../src/vehicleDynamics.js';
import { ENGINE_BANKS } from '../../src/engineAudio.js';

mkdirSync('android/native/generated', { recursive: true });
mkdirSync('artifacts/android', { recursive: true });
const scalar = ['massKg','wheelbaseM','trackM','wheelRadius','wheelInertia','suspRest','suspTravel','suspK','suspCComp','suspCReb','bumpStopK','hardpointZ','idleRpm','redlineRpm','engineBraking','finalDrive','drivelineEff','shiftTime','brakeTorqueMax','brakeBias','handbrakeTorque','latGripScale','rearLatScale','tireGrip','dragCoef','liftCoef','maxSteer','steerHighSpeed','launchTorqueMultiplier'];
const hash = createHash('sha256').update(readFileSync('src/vehicleDynamics.js')).digest('hex');
let header = `// Generated from src/vehicleCatalog.js; regenerate with prepare_physics.mjs.\n#pragma once\n#include "../simulation.hpp"\nnamespace dab {\ninline constexpr const char* reference_sha256="${hash}";\ninline Settings vehicle_settings(int index){ Settings s;switch(index){\n`;
for (const [index, vehicle] of Object.values(VEHICLES).entries()) {
  header += `case ${index}:\n`;
  for (const key of scalar) header += `s.${key}=${vehicle[key] ?? 1};\n`;
  for (const key of ['width','length','height']) header += `s.${key}=${vehicle.dims[key]};\n`;
  header += `s.driveFront=${vehicle.drive.front};s.driveRear=${vehicle.drive.rear};\n`;
  for (const key of ['pacLong','pacLat']) header += `s.${key}={${vehicle[key].B},${vehicle[key].C},${vehicle[key].E}};\n`;
  header += `s.gears={${vehicle.gears.join(',')}};\ns.torqueCurve={${vehicle.torqueCurve.map(p => `{${p.join(',')}}`).join(',')}};break;\n`;
}
header += 'default: return vehicle_settings(0); }return s;}\n}\n';
writeFileSync('android/native/generated/vehicle_profiles.hpp', header);
const chunks = [];
const numbers = values => { const b = Buffer.alloc(values.length * 8); values.forEach((v,i) => b.writeDoubleLE(Number(v),i*8)); chunks.push(b); };
const fields = state => [
  ...state.position.toArray(), ...state.quaternion.toArray(), ...state.velocity.toArray(), ...state.angularVelocity.toArray(),
  state.gear,state.rpm,state.throttle,state.braking,state.steer,state.heading,state.distance,state.tcsFactor,
  ...state.wheels.flatMap(w => [w.omega,w.spinAngle,w.compression,w.load,w.slipRatio,w.slipAngle]),
];
const cases = ['launch-brake','partial-pedals','steering','manual','reverse','handbrake','aids-off','idle'];
numbers([Object.keys(VEHICLES).length * cases.length]);
for (const [vehicleIndex,vehicle] of Object.values(VEHICLES).entries()) for (const [caseIndex,name] of cases.entries()) {
  const heading=.37, state=createDynamicsState(heading, vehicle, new THREE.Vector3(0,0,0));
  state.autoTransmission=name!=='manual';
  if(name==='aids-off')state.aids={abs:false,tcs:false,esc:false};
  if(name==='steering')state.aids.esc=true;
  const steps=2400;
  numbers([vehicleIndex,caseIndex,heading,state.autoTransmission,state.aids.abs,state.aids.tcs,state.aids.esc,steps]);
  for(let i=0;i<steps;i++) {
    const time=i/120;
    const input={throttle:time<12?1:0,brake:time>=14?1:0,steer:0,handbrake:false,horn:false,clutch:false,shiftUp:false,shiftDown:false};
    if(name==='partial-pedals'){input.throttle=time<12?.5:.15;input.brake=time>=14?.5:0;}
    if(name==='steering'){input.steer=time<4?0:Math.sin((time-4)*.8)*.35;input.brake=time>=16?.3:0;}
    if(name==='manual'){input.shiftUp=[0,400,700,1000].includes(i);input.shiftDown=i===1700;input.clutch=i>=1850&&i<1900;}
    if(name==='reverse'){input.throttle=time>=10?1:0;input.brake=time<10?1:0;}
    if(name==='handbrake'){input.handbrake=time>8&&time<11;input.steer=time>8&&time<11?.4:0;}
    if(name==='idle'){input.throttle=0;input.brake=0;}
    numbers([input.throttle,input.brake,input.steer,input.handbrake,input.horn,input.clutch,input.shiftUp,input.shiftDown]);
    stepDynamics(state,input,1/120,vehicle);
    if(i%60===59)numbers(fields(state));
  }
}
writeFileSync('artifacts/android/physics-reference.bin',Buffer.concat(chunks));
writeFileSync('artifacts/android/physics-reference.json',JSON.stringify({sourceSha256:hash,cases,vehicles:Object.keys(VEHICLES),stepsPerCase:2400,checkEvery:60},null,2));
mkdirSync('android/game/assets/data',{recursive:true});
writeFileSync('android/game/assets/data/vehicles.json',JSON.stringify(VEHICLES));
writeFileSync('android/game/assets/data/engine_banks.json',JSON.stringify(ENGINE_BANKS));
writeFileSync('android/game/assets/data/third-party-notices.txt',[
  'DriveAtBaku native preview — credits and third-party notices',
  readFileSync('docs/ASSET_CREDITS.md','utf8'),
  'Deterministic mathematics: V8 13.6.233 / Sun fdlibm',
  readFileSync('android/native/third_party/fdlibm/ieee754.cpp','utf8').split('\n').slice(0,15).join('\n'),
  readFileSync('android/native/third_party/fdlibm/LICENSE','utf8'),
  readFileSync('public/assets/fonts/AZ-DIN-OFL.txt','utf8'),
  readFileSync('public/assets/audio/engines/SOURCES.md','utf8'),
].join('\n\n'));
console.log(`Prepared ${Object.keys(VEHICLES).length*cases.length} reference runs; simulation SHA256 ${hash}`);
