import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { draco } from './lib/headlessDraco.mjs';
import { createCarModel, setHeadlightBulbs, animateCarModel } from '../src/carModel.js';
import { createImportedVehicle } from '../src/importedVehicleModel.js';
import { createElantraModel } from '../src/elantraModel.js';
import { prepareElantraWheel } from '../src/elantraWheel.js';
import { VEHICLES } from '../src/vehicleCatalog.js';
import { createDynamicsState } from '../src/vehicleDynamics.js';
import { INDICATOR_MODES, createIndicatorState, toggleIndicator, indicatorLevels, indicatorInputMode,
  installVehicleIndicators, updateVehicleIndicators, isNewerSequence, disposeVehicleIndicators } from '../src/vehicleIndicators.js';
import { formatStatePayload } from '../src/net/protocol.js';
import { NetClient } from '../src/net/NetClient.js';
import { RemotePlayer } from '../src/net/RemotePlayer.js';

for (const current of INDICATOR_MODES) for (const requested of ['left', 'right', 'hazard']) {
  const state = createIndicatorState(); state.mode = current; state.serverAt = 999;
  toggleIndicator(state, requested, 1000);
  const expected = current === requested ? 'off' : requested;
  assert.equal(state.mode, expected); assert.equal(state.serverAt, null);
  assert.deepEqual(indicatorLevels(state.mode, state.startedAt, 1000), [Number(['left','hazard'].includes(expected)), Number(['right','hazard'].includes(expected))]);
  for (const elapsed of [399,400,799,800,1199,1200,100000]) {
    const on = elapsed % 800 < 400;
    assert.deepEqual(indicatorLevels(state.mode, 1000, 1000 + elapsed), [Number(on && ['left','hazard'].includes(expected)), Number(on && ['right','hazard'].includes(expected))]);
  }
}
const rapid = createIndicatorState();
for (let i=0;i<10000;i++) toggleIndicator(rapid, ['left','right','hazard'][i%3], i);
assert.equal(rapid.revision,10000); assert.ok(INDICATOR_MODES.includes(rapid.mode));
for (const code of ['Comma','Period','Slash']) {
  assert.ok(indicatorInputMode({code},true));
  for (const event of [{repeat:true},{isComposing:true},{ctrlKey:true},{altKey:true},{metaKey:true},{target:{closest:()=>({})}}]) assert.equal(indicatorInputMode({code,...event},true),null);
  assert.equal(indicatorInputMode({code},false),null);
}
assert.ok(isNewerSequence(0,0xffffffff)); assert.ok(!isNewerSequence(8,9)); assert.ok(!isNewerSequence(9,9));
const client = new NetClient(); client._setServerClock(123456);
assert.ok(Math.abs(client.getServerTime()-123456)<10,'monotonic clock reference ignores wall-clock skew');
const remote = Object.create(RemotePlayer.prototype);
Object.assign(remote,{buffer:[],maxBufferSize:32,carId:'ferrari',disposed:false});
for (const seq of [9,8,9,10]) remote.pushState({seq}, 1000+seq, 7000);
assert.deepEqual(remote.buffer.map(x=>x.state.seq),[9,10],'duplicates and older remote packets are rejected');

const loader = new GLTFLoader().setDRACOLoader(draco).register(()=>({name:'headless',loadTexture:()=>Promise.resolve(null)}));
async function load(path) { const b=readFileSync(new URL(`../public${path}`,import.meta.url));return (await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene; }
const step=(a,b)=>b>=a?1:0;
const smoothstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
const reports=[];
for(const id of Object.keys(VEHICLES)) {
  const s=VEHICLES[id];const car=id==='ferrari'?createCarModel({scene:await load(s.asset)}):id==='elantra'?createElantraModel(JSON.parse(gunzipSync(readFileSync(new URL(`../public${s.asset}`,import.meta.url)))),prepareElantraWheel(await load('/assets/vehicles/elantra-wheel.glb'))):createImportedVehicle(await load(s.asset),await load(s.wheelAsset),s);
  const rig=car.userData.indicators; assert.ok(rig.records.length>=2);
  const geometry=new Map(); car.traverse(o=>{if(o.isMesh)geometry.set(o,o.geometry);});
  installVehicleIndicators(car,id);assert.equal(car.userData.indicators,rig,'installation is idempotent');
  car.traverse(o=>{if(o.isMesh)assert.equal(o.geometry,geometry.get(o),'authored geometry and draw calls are preserved');});
  const pockets=new Set();
  for(const record of rig.records) {
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <emissivemap_fragment>\n#include <lights_fragment_begin>\n#include <opaque_fragment>'};
    record.material.onBeforeCompile(shader); assert.equal(shader.uniforms.signalLevels,rig.levels);
    assert.ok(shader.fragmentShader.includes('outgoingLight = mix'));
    const evaluate = new Function('signalPosition','step','smoothstep','abs','length','vec2','max',`return ${record.mask};`);
    const geometry=record.mesh.geometry,p=geometry.attributes.position,index=geometry.index;
    const groups=geometry.groups.length?geometry.groups.filter(g=>g.materialIndex===record.materialIndex):[{start:0,count:index?.count??p.count}];
    for(const group of groups)for(let i=group.start;i<group.start+group.count;i++) {
      const point=new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(shader.uniforms.signalToVehicle.value);
      const mask=evaluate(point,step,smoothstep,Math.abs,v=>Math.hypot(...v),(a,b)=>[a,b],Math.max);
      if(mask>.5) {assert.ok(Math.abs(point.x)>.3,'centre stop lamps and cabin never signal');pockets.add(`${point.x<0?'left':'right'}-${point.y>1?'front':point.y< -1?'rear':'side'}`);}
    }
  }
  for(const side of ['left','right'])for(const pocket of ['front','rear','side'])assert.ok(pockets.has(`${side}-${pocket}`),`${id}: actual ${side} ${pocket} lens vertices are inside the mask`);
  if(id==='elantra') {
    const cover=car.getObjectByName('taillight_'),reflector=car.getObjectByName('Elantra part 18');
    assert.ok(rig.records.some(r=>r.mesh===cover&&r.materialIndex===0),'clear rear cover receives the signal');
    assert.ok(rig.records.some(r=>r.mesh===reflector&&r.materialIndex===0),'clear reflector receives the signal');
    assert.ok(!rig.records.some(r=>r.mesh===reflector&&r.materialIndex===3),'red brake/stop LEDs remain independent');
  }
  const dynamics=createDynamicsState(0,s);
  for(const mode of INDICATOR_MODES)for(const head of [0,1,2]) {
    updateVehicleIndicators(car,mode,0,100);setHeadlightBulbs(car,head);
    dynamics.gear=0;dynamics.brakeForceInput=1;animateCarModel(car,dynamics,1);
    assert.deepEqual(rig.levels.value.toArray(),indicatorLevels(mode,0,100),'head/brake/reverse controls do not overwrite indicators');
    updateVehicleIndicators(car,mode,0,500);assert.deepEqual(rig.levels.value.toArray(),[0,0]);
  }
  const payload=formatStatePayload(1,0,{p:[0,0,0],q:[0,0,0,1],v:[0,0,0],av:[0,0,0],spd:0,in:{},li:{sig:'hazard',sigAt:123456,sigRev:8}});
  assert.equal(payload.li.sig,'hazard');assert.equal(payload.li.sigAt,123456);assert.equal(payload.li.sigRev,8);
  const materialSet=new Set(rig.records.map(r=>r.material));let disposed=0;
  for(const material of materialSet)material.addEventListener('dispose',()=>disposed++);
  disposeVehicleIndicators(car);assert.equal(disposed,materialSet.size,'owned shader materials are cleaned up');
  reports.push(`${id}: six lamp locations, ${rig.records.length} material regions, zero added meshes/lights`);
}
console.log('Indicators: all mode transitions, rapid/repeat/typing guards, blink boundaries, ordering/wrap, clock reference, actual lens masks, lighting independence and cleanup passed.');
console.log(reports.join('\n'));
