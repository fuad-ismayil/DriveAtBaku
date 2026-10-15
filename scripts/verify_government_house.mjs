import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readMapGeometry } from './lib/readMapGeometry.mjs';
import { addGovernmentHouseWindowRelief, createLimestonePixels, isGovernmentHouseMaterial } from '../src/governmentHouse.js';

// Work against the actual building/UV islands, including their negative tiled UVs.
const meshes=readMapGeometry('buildings',isGovernmentHouseMaterial);
assert.equal(meshes.length,5,'only the five audited landmark material groups');
assert.equal(isGovernmentHouseMaterial('bak_building_high_19_a_01-material-other'),false);
assert.equal(isGovernmentHouseMaterial('BAK_BUILDING_HIGH_19_A_01-material'),false,'do not alter the separate street/plaza surface');
const facade=meshes.find(m=>m.material.name==='bak_building_high_19_a_02-material');
const positions=facade.geometry.attributes.position.array.slice(), indices=facade.geometry.index.array.slice();
const details=new THREE.Group(), windows=addGovernmentHouseWindowRelief(facade,details);
assert.equal(windows,360,'relief follows the repeated atlas windows on the actual facades');
assert.equal(details.children.length,1,'merge all 1,440 jambs/sills before spatial batching');
assert.equal(details.children[0].geometry.index.count/3,17280);
assert.deepEqual(facade.geometry.attributes.position.array,positions,'preserve original architecture');
assert.deepEqual(facade.geometry.index.array,indices,'preserve all original openings');
const bounds=new THREE.Box3().setFromObject(details);
assert.ok(bounds.min.x>605&&bounds.max.x<756&&bounds.min.y>567&&bounds.max.y<694);
assert.ok(bounds.min.z>4&&bounds.max.z<45,'no ornaments above the real roofline');
for(const value of details.children[0].geometry.attributes.normal.array)assert.ok(Number.isFinite(value));
const geometry=details.children[0].geometry, point=new THREE.Vector3(), edge=new THREE.Vector3(), winding=new THREE.Vector3();
for(let i=0;i<geometry.index.count;i+=3){
 const ids=[0,1,2].map(j=>geometry.index.getX(i+j));
 const vertices=ids.map(id=>new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,id));
 winding.subVectors(vertices[1],vertices[0]).cross(edge.subVectors(vertices[2],vertices[0])).normalize();
 point.fromBufferAttribute(geometry.attributes.normal,ids[0]);
 assert.ok(winding.dot(point)>.99,'mirrored atlas islands retain outward triangle winding');
}

const pixels=new Uint8Array([190,179,156,255, 85,110,126,255, 55,40,24,255]);
const mask=createLimestonePixels(pixels,3,1);
assert.equal(mask[1],0,'warm limestone stays matte');
assert.equal(mask[5],255,'cool neutral panes receive the glass treatment');
assert.equal(mask[9],0,'deep brown arch interiors never become glass');
assert.equal(mask[4],128,'panes have flat relief instead of embossed reflections');
assert.equal(createLimestonePixels(new Uint8Array([107,108,126,255]),1,1)[1],255,'dim cool-grey panes stay glass');
console.log(`Government House: five original material groups, ${windows} aligned window surrounds, preserved geometry and stone/glass masks passed.`);
