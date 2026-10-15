import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { RoomLightActivity } from '../src/roomLightActivity.js';
import { buildRoomLightGeometry } from '../src/roomLights.js';
import { readMapGeometry } from './lib/readMapGeometry.mjs';

const isolated=new RoomLightActivity(128,{seed:7391});isolated.setNight(true);
const selected=Array.from({length:128},(_,i)=>i).find(i=>isolated.states[i*4+1]===1);
isolated.heap=[];for(let i=0;i<128;i++){isolated.next[i]=i===selected ? .1 : Infinity;isolated.push(i);}
const before=isolated.states.slice(),randomBefore=isolated.randomStates.slice();
assert.deepEqual(isolated.update(.2),[selected]);assert.equal(isolated.states[selected*4+1],0,'one occupied room independently switches off');
for(let i=0;i<128;i++)if(i!==selected){assert.deepEqual(isolated.states.slice(i*4,i*4+4),before.slice(i*4,i*4+4),'switching off a room does not replace or modify another light');assert.equal(isolated.randomStates[i],randomBefore[i]);}
assert.ok(isolated.intensity(selected)>.95,'switching starts a soft fade');isolated.update(2);assert.equal(isolated.intensity(selected),0);

const a=new RoomLightActivity(2,{seed:8003}),b=new RoomLightActivity(300,{seed:8003});a.setNight(true);b.setNight(true);
let firstEvents=0,last=a.next[0];
for(let i=0;i<1440;i++){
 a.update(10);b.update(10);
 assert.deepEqual(a.states.slice(0,4),b.states.slice(0,4),'adding 298 independently active neighbors never changes room zero');
 assert.equal(a.next[0],b.next[0]);
 if(a.next[0]!==last){firstEvents++;last=a.next[0];}
}
assert.ok(firstEvents>7&&firstEvents<60,'room activity is infrequent over four simulated hours');
const city=new RoomLightActivity(20000,{seed:17819});city.setNight(true);
assert.ok(city.initialOn>5800&&city.initialOn<7800,'a varied minority of rooms starts occupied');
assert.equal(new Set(city.next).size,20000,'no synchronized room deadlines');
const next=city.next.slice(),time=city.time;city.setNight(false);assert.deepEqual(city.update(900),[]);
assert.equal(city.time,time);assert.deepEqual(city.next,next,'daytime freezes room activity without a dawn/dusk reset');
city.setNight(true);city.update(1800);
const lit=Array.from({length:city.count},(_,i)=>city.states[i*4+1]).reduce((a,b)=>a+b,0);
assert.ok(lit>5000&&lit<8500,'independent on/off dwell times maintain a naturally mixed city');
assert.ok(city.events>20000&&city.events<90000);

const roots=['baku','buildings'].map(asset=>{const root=new THREE.Group();root.add(...readMapGeometry(asset,undefined,{city:true}));return [asset,root];});
const fingerprint=()=>{const hash=createHash('sha256');for(const [,root]of roots)root.traverse(m=>{if(m.isMesh){hash.update(Buffer.from(m.geometry.attributes.position.array.buffer));if(m.geometry.index)hash.update(Buffer.from(m.geometry.index.array.buffer));}});return hash.digest('hex');};
const original=fingerprint(),result=buildRoomLightGeometry(roots);assert.equal(fingerprint(),original,'all original walls, windows, roads and collision source buffers stay intact');
assert.ok(result.count>40000&&result.count<60000);assert.ok(result.materials>=125);
const ids=result.geometry.attributes.roomId;
assert.equal(new Set(ids.array).size,result.count);
for(let i=0;i<ids.count;i+=3){assert.equal(ids.getX(i),ids.getX(i+1));assert.equal(ids.getX(i),ids.getX(i+2),'clipped triangles have a constant room ID');}
for(const attribute of Object.values(result.geometry.attributes))for(const value of attribute.array)assert.ok(Number.isFinite(value));
const layout=JSON.parse(readFileSync(new URL('../src/windowLightingAtlas.json',import.meta.url)));
const profiles=JSON.parse(readFileSync(new URL('./windowAtlasProfiles.json',import.meta.url)));
assert.ok(Object.values(profiles).every(profile=>!profile.grid),'only regular windows; no synthetic room grids on glass walls');
const curtainWalls=new Set([
 'bak_building_dist_01_a_01-material','bak_building_dist_11_b_01-material','bak_building_dist_12_a_01-material',
 'bak_building_high_03_h_01-material','bak_building_high_03_h_02-material',
 'bak_building_high_18_c_01-material','bak_building_high_18_c_02-material',
 'bak_building_high_18_b_01-material','bak_building_high_18_b_02-material','bak_building_high_16_b_03-material',
]);
const excludedImages=new Set();
const towerLayout=layout.layouts[layout.bindings['buildings/bak_building_high_01_a_01-material']];
assert.deepEqual(towerLayout.sourceVRange,[-4,-3],'restore curved tower sides while excluding the central-panel UV band');
const tower=roots.find(([asset])=>asset==='buildings')[1].children.find(mesh=>mesh.material.name==='bak_building_high_01_a_01-material');
for(const [band,expected]of [[-3,false],[-4,true]]){
 const filtered=tower.clone();filtered.geometry=tower.geometry.clone();const source=tower.geometry,selected=[];
 for(let i=0;i<source.index.count;i+=3){const ids=[0,1,2].map(j=>source.index.getX(i+j));if(ids.every(id=>source.attributes.uv.getY(id)>=band&&source.attributes.uv.getY(id)<=band+1))selected.push(...ids);}
 assert.ok(selected.length>0);filtered.geometry.setIndex(selected);
 const group=new THREE.Group();group.add(filtered);const rooms=buildRoomLightGeometry([['buildings',group]]).count;
 assert.equal(rooms>0,expected,band===-3?'middle glass panel stays unlit':'side window lights are restored');
}
assert.ok(layout.bindings['buildings/bak_building_high_19_a_02-material']!==undefined,'regular Government House windows retain independent room lighting');
const manifest=JSON.parse(readFileSync(new URL('../public/generated/asset-manifest.json',import.meta.url)));
for(const asset of ['baku','buildings']){
 const bytes=gunzipSync(Buffer.concat(manifest.assets[asset].parts.map(part=>readFileSync(new URL(`../public/generated/${part}`,import.meta.url)))));
 const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length)),offset=28+length;
 for(const material of json.materials){
  const entry=layout.layouts[layout.bindings[`${asset}/${material.name}`]],curtain=curtainWalls.has(material.name.toLowerCase());
  if(!entry&&!curtain)continue;
  const image=json.images[json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source],view=json.bufferViews[image.bufferView];
  const imageHash=createHash('sha256').update(bytes.subarray(offset+view.byteOffset,offset+view.byteOffset+view.byteLength)).digest('hex');
  if(curtain){assert.equal(entry,undefined,'continuous glass walls have no random light surfaces');excludedImages.add(imageHash);continue;}
  assert.equal(imageHash,entry.source,'room masks match the exact current source facade atlas');
 }
}
assert.ok(layout.layouts.every(entry=>!excludedImages.has(entry.source)),'shared aliases cannot restore lighting to an excluded glass-wall texture');
assert.ok(Object.keys(layout.bindings).every(name=>!/road|tree|flag|fence|neon|pitgarage|medical|media/i.test(name)),'only audited inhabited facades receive room lights');
assert.ok(readFileSync(new URL('../public/assets/environment/room-windows.png',import.meta.url)).length<500000);
console.log(JSON.stringify({rooms:result.count,facadeMaterials:result.materials,triangles:result.geometry.attributes.position.count/3,independentRoomEvents:firstEvents,halfHourCityEvents:city.events}));
console.log('Room lights: independent stochastic timers, off without replacement, soft fades, sparse activity, day gating, real facade geometry and clipped UV seams passed.');
