import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { readMapGeometry, readMapDocument } from './lib/readMapGeometry.mjs';
import { isEventMaterial, filterCityMapDocument } from '../src/cityMap.js';
import { ASPHALT_MATERIALS } from '../src/mapSurfaces.js';
import { collectMinimapSurfaces } from '../src/minimap.js';
import { GroundSampler } from '../src/groundSampler.js';
import { BarrierCollision } from '../src/barrierCollision.js';
import { WorldOptimization, partitionMesh, canCullBackfaces } from '../src/worldOptimization.js';
import { createDynamicsState } from '../src/vehicleDynamics.js';
import { VEHICLES } from '../src/vehicleCatalog.js';

const report = { assets: {}, views: [] };
const originalDocument = readMapDocument('baku'), cityDocument = structuredClone(originalDocument);
filterCityMapDocument(cityDocument,'baku');
for (let i=0;i<cityDocument.materials.length;i++) {
  const material=cityDocument.materials[i], before=originalDocument.materials[i];
  if(ASPHALT_MATERIALS.has(material.name)) {
    const asphalt=originalDocument.materials.find(m=>m.name==='ROADA_MAIN-material');
    assert.deepEqual(material.pbrMetallicRoughness.baseColorTexture,asphalt.pbrMetallicRoughness.baseColorTexture,'only event runoff reuses ordinary asphalt');
    const restored=structuredClone(material);restored.pbrMetallicRoughness.baseColorTexture=before.pbrMetallicRoughness.baseColorTexture;
    assert.deepEqual(restored,before,'all other runoff material properties remain exact');
  } else assert.deepEqual(material,before,'every other material definition stays exact');
}
assert.deepEqual(cityDocument.bufferViews,originalDocument.bufferViews);assert.deepEqual(cityDocument.accessors,originalDocument.accessors);
const changedMap=structuredClone(originalDocument);
const eventPrimitive=changedMap.meshes.find(m=>m.primitives.some(p=>changedMap.materials[p.material]?.name==='SILVER-material')).primitives[0];
changedMap.accessors[eventPrimitive.indices].count-=3;
assert.throws(()=>filterCityMapDocument(changedMap,'baku'),/audit no longer matches/,'changed source fails safely');
const mixedMap=structuredClone(originalDocument);
const street=mixedMap.meshes.find(m=>m.primitives.some(p=>mixedMap.materials[p.material]?.name==='ROADA_MAIN-material')).primitives[0];
const event=mixedMap.meshes.find(m=>m.primitives.some(p=>mixedMap.materials[p.material]?.name==='SILVER-material')).primitives[0];
const mixedNode=mixedMap.nodes.push({name:'mixed city and event fixture',mesh:mixedMap.meshes.push({primitives:[event,street]})-1})-1;
mixedMap.scenes[0].nodes.push(mixedNode);filterCityMapDocument(mixedMap,'baku');
assert.deepEqual(mixedMap.meshes[mixedMap.nodes[mixedNode].mesh].primitives,[street],'mixed meshes retain ordinary street faces');
const changedCollision=readMapDocument('collision');
const changedNode=changedCollision.nodes.find(n=>n.name==='colmesh-1-mesh_6');
changedNode.matrix[12]=1;
assert.throws(()=>filterCityMapDocument(changedCollision,'collision'),/enclosure no longer matches/,'collision identity includes placement, not just its generated name');
function signature(mesh) {
  const hash = createHash('sha256');
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
    hash.update(name); hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
  }
  const index = mesh.geometry.index;
  if (index) hash.update(Buffer.from(index.array.buffer, index.array.byteOffset, index.array.byteLength));
  hash.update(JSON.stringify(mesh.matrixWorld.elements));
  return hash.digest('hex');
}
const original = {}, city = {};
for (const asset of ['baku', 'buildings', 'collision']) {
  original[asset] = readMapGeometry(asset);
  city[asset] = readMapGeometry(asset, () => true, { city: true });
  const before = new Map(original[asset].map(mesh => [mesh.name, signature(mesh)]));
  for (const mesh of city[asset]) {
    assert.equal(signature(mesh), before.get(mesh.name), `${asset}/${mesh.name}: positions, indices, UVs, normals and transform unchanged`);
    assert.equal(isEventMaterial(asset, mesh.material.name), false, 'no audited event material survives');
  }
  report.assets[asset] = { beforeMeshes: original[asset].length, cityMeshes: city[asset].length,
    beforeTriangles: original[asset].reduce((s,m) => s + m.geometry.index.count / 3, 0),
    cityTriangles: city[asset].reduce((s,m) => s + m.geometry.index.count / 3, 0) };
}
assert.equal(city.baku.length, 49); assert.equal(city.buildings.length, 366); assert.equal(city.collision.length, 7);
const ghost = original.baku.find(mesh => mesh.material.name === 'ghost-material');
const ghostCollision = original.collision.find(mesh => mesh.name === 'colmesh-1-mesh_6');
assert.equal(signature(ghost), signature(ghostCollision), 'removed collision is exactly the visual event enclosure');
assert.equal(city.collision.some(mesh => mesh.name === ghostCollision.name), false);

for (const name of ['ROAD_AZER-material', 'ROADA_MAIN-material', 'ROAD_OFFTRACK_A-material', 'ROAD_OFFTRACK_B-material',
  'BAK_KERB_A-material', 'BAK_PAVEMENT_A-material', 'BAK_ROAD_MARKINGS_A-material', 'BAK_YELLOWLINE-material',
  'BAK_FEATURE_P_HEDGES_A_01-material', 'BAK_TREE_BASE_A-material']) {
  assert.ok(city.baku.some(mesh => mesh.material.name === name), `preserve ${name}`);
}
assert.ok(city.buildings.some(mesh => mesh.material.name === 'bak_buntin_a_01-material'), 'ordinary decorative bunting stays');
assert.equal(isEventMaterial('buildings', 'BAK_BARRIER_PITWALL_A_01-material'), false, 'allowlist is scoped to audited asset');
assert.equal(isEventMaterial('baku', 'CITY_FENCE-material'), false, 'generic city fence is never a removal rule');

function root(meshes) { const group = new THREE.Group(); for (const mesh of meshes) group.add(mesh); return group; }
const beforeMap = await collectMinimapSurfaces(root(original.baku));
const cityMap = await collectMinimapSurfaces(root(city.baku));
assert.deepEqual(cityMap, beforeMap, 'every minimap surface and coordinate stays identical');
report.minimapIdentical = true;

for (const meshes of [original.collision, city.collision]) for (const mesh of meshes) {
  mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { indirect: true }); mesh.raycast = acceleratedRaycast;
}
const oldGround = new GroundSampler(original.collision), cityGround = new GroundSampler(city.collision);
const route = JSON.parse(readFileSync(new URL('../public/generated/route.json', import.meta.url)));
const down = new THREE.Vector3(0, 0, -1);
for (const point of [route.spawn, ...route.checkpoints]) {
  const from = new THREE.Vector3(...point).add(new THREE.Vector3(0, 0, 6));
  const a = oldGround.sample(from, down, 16), b = cityGround.sample(from, down, 16);
  assert.ok(a && b, 'road contact exists at spawn and each checkpoint');
  assert.deepEqual(b.point.toArray(), a.point.toArray()); assert.deepEqual(b.normal.toArray(), a.normal.toArray());
  assert.equal(b.mu, a.mu); assert.equal(b.rr, a.rr);
}
report.roadContacts = route.checkpoints.length + 1;

// Find genuine fence gaps in the original ground collider, then drive each
// vehicle across the removed wall. This tests the absence of invisible barriers.
const collider = new BarrierCollision(); for (const mesh of city.collision) collider.addMesh(mesh);
const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3(), point = new THREE.Vector3();
const triangle = new THREE.Triangle(a,b,c);
let passages = 0;
for (const mesh of original.baku.filter(m => /FENCE_CONCRETE_F_01/.test(m.material.name))) {
  const g = mesh.geometry, positions = g.attributes.position, index = g.index;
  for (let i = 0; i + 2 < index.count && passages < 8; i += 3 * 97) {
    a.fromBufferAttribute(positions,index.getX(i)).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(positions,index.getX(i+1)).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(positions,index.getX(i+2)).applyMatrix4(mesh.matrixWorld);
    triangle.getNormal(normal); if (Math.abs(normal.z) > .05 || normal.lengthSq() < .5) continue;
    triangle.getMidpoint(point);
    const ground = cityGround.sample(point.clone().add(new THREE.Vector3(0,0,3)), down, 8);
    if (!ground || point.z - ground.point.z < .2 || point.z - ground.point.z > 1.3) continue;
    const from = point.clone().addScaledVector(normal, 4).setZ(ground.point.z);
    const to = point.clone().addScaledVector(normal, -4).setZ(ground.point.z);
    let clear = true;
    for (const vehicle of Object.values(VEHICLES)) {
      const state = createDynamicsState(Math.atan2(-normal.x,normal.y), vehicle, from);
      const start = state.position.clone(), rotation = state.quaternion.clone();
      state.position.copy(to).z += state.comHeight; state.velocity.subVectors(state.position,start).multiplyScalar(120);
      if (collider.resolve(state,start,rotation,vehicle)) { clear = false; break; }
      assert.ok(state.position.distanceTo(to.clone().add(new THREE.Vector3(0,0,state.comHeight))) < 1e-8);
    }
    if (clear) passages++;
  }
}
assert.ok(passages >= 3, 'all four cars can cross several removed real-map barriers'); report.clearPassages = passages;

const camera = new THREE.PerspectiveCamera(62,16/9,.15,6000); camera.up.set(0,0,1);
const worlds = [96,256].map(size => {
  const world = new WorldOptimization(camera);
  for (const mesh of [...city.baku,...city.buildings]) {
    if (canCullBackfaces(mesh)) mesh.material.side = THREE.FrontSide;
    world.addOccluders(mesh);
    for (const chunk of partitionMesh(mesh,size)) world.addMesh(chunk);
  }
  assert.equal(world.stats.triangles,1522685,'partitioning preserves every surviving city triangle');
  return { size, world };
});
for (let i=0; i<route.checkpoints.length; i++) {
  const p=route.checkpoints[i], q=route.checkpoints[(i+1)%route.checkpoints.length];
  camera.position.set(p[0],p[1],p[2]+3); camera.lookAt(q[0],q[1],q[2]+1);
  for (const {size,world} of worlds) {
    world.occlusion=false;world.update();const frustumTriangles=world.stats.mainTriangles;
    world.occlusion=true;world.update();
    assert.ok(world.stats.mainTriangles <= frustumTriangles);
    assert.ok(world.entries.every(e => !e.skip || !e.bounds.containsPoint(camera.position)));
    report.views.push({checkpoint:i,cellSize:size,chunks:world.stats.meshes,frustumTriangles,visibleTriangles:world.stats.mainTriangles,occluded:world.stats.occluded});
  }
}
assert.ok(report.views.some(v=>v.occluded>0),'actual city facades occlude chunks');
assert.ok(report.views.every(v=>v.visibleTriangles<1522685),'every sampled camera rejects off-screen geometry');
for(const name of ['RMBL-material','POLICE-material','sochi_saussage-material','ROADOR-material','ROAD_WHITELINE_A-material','WHITELINE_A-material']) {
  assert.ok(!city.baku.some(mesh=>mesh.material.name===name),'no race bump or pit overlay survives');
}
assert.ok(city.buildings.some(mesh=>mesh.material.name==='bak_building_high_18_c_02-material'),'real city building using the event structure texture stays');
mkdirSync('artifacts/city-map',{recursive:true});writeFileSync('artifacts/city-map/verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({assets:report.assets,minimapIdentical:true,roadContacts:report.roadContacts,clearPassages:passages,cullingViews:report.views.length}));
