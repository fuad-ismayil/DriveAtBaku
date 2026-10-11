import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { SpatialIndex } from '../src/spatialIndex.js';
import { GroundSampler } from '../src/groundSampler.js';
import { createShadowCache } from '../src/shadowCache.js';
import { WorldOptimization, useStaticBatchMatrices } from '../src/worldOptimization.js';
import { createSurfaceDetail } from '../src/surfaceDetail.js';
import { createWeather } from '../src/weather.js';
import { createDynamicsState, stepDynamics } from '../src/vehicleDynamics.js';
import { VEHICLES } from '../src/vehicleCatalog.js';
import { readMapGeometry } from './lib/readMapGeometry.mjs';

let seed = 41;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const entries = Array.from({ length: 2048 }, (_, id) => {
  const min = new THREE.Vector3(random() * 1000 - 500, random() * 1000 - 500, random() * 50);
  return { id, bounds: new THREE.Box3(min, min.clone().add(new THREE.Vector3(random()*200, random()*200, random()*10))) };
});
const index = new SpatialIndex(entries), matches = [];
for (let i = 0; i < 200; i++) {
  const min = new THREE.Vector3(random()*1000-500, random()*1000-500, random()*50);
  const query = new THREE.Box3(min, min.clone().addScalar(40));
  index.query(bounds => bounds.intersectsBox(query), matches);
  assert.deepEqual(matches.map(entry => entry.id).sort((a,b) => a-b),
    entries.filter(entry => entry.bounds.intersectsBox(query)).map(entry => entry.id), 'hierarchy matches exhaustive bounds tests');
}
assert.deepEqual(new SpatialIndex([]).query(() => true, []), []);

const source = readMapGeometry('collision');
for (const mesh of source) { mesh.geometry.boundsTree = new MeshBVH(mesh.geometry); mesh.raycast = acceleratedRaycast; }
const sampler = new GroundSampler(source), raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
function exhaustive(origin, direction, distance) {
  raycaster.set(origin, direction); raycaster.far = distance;
  let best = null;
  for (const mesh of source) {
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  if (!best) return null;
  const normal = best.face.normal.clone().transformDirection(best.object.matrixWorld);
  if (normal.z < 0) normal.negate();
  const name = `${best.object.name} ${best.object.material.name}`;
  const mu = /grass|dirt|sand/i.test(name) ? .65 : /gravel/i.test(name) ? .75 : 1;
  return { distance: best.distance, point: best.point, normal, mu, rr: mu < 1 ? .045 : .013 };
}
const route = JSON.parse(readFileSync(new URL('../public/generated/route.json', import.meta.url)));
let contacts = 0;
for (const checkpoint of route.checkpoints) for (let i = 0; i < 30; i++) {
  const origin = new THREE.Vector3(checkpoint[0]+(random()-.5)*24, checkpoint[1]+(random()-.5)*24, checkpoint[2]+6);
  const direction = new THREE.Vector3((random()-.5)*.15,(random()-.5)*.15,-1).normalize();
  const expected = exhaustive(origin, direction, 16), actual = sampler.sample(origin, direction, 16);
  assert.equal(!!actual, !!expected, 'broad phase retains all real road hits');
  if (actual) {
    contacts++;
    assert.equal(actual.distance, expected.distance);
    assert.deepEqual(actual.point.toArray(), expected.point.toArray());
    assert.deepEqual(actual.normal.toArray(), expected.normal.toArray());
    assert.equal(actual.mu, expected.mu); assert.equal(actual.rr, expected.rr);
  }
}
assert.ok(contacts > 100);
for (const settings of Object.values(VEHICLES)) {
  const position = new THREE.Vector3(...route.spawn);
  const states = [createDynamicsState(route.heading, settings, position), createDynamicsState(route.heading, settings, position)];
  for (let step = 0; step < 960; step++) {
    const input = { throttle: step < 600 ? 1 : 0, brake: step >= 600 ? .6 : 0, steer: step >= 300 ? .2 : 0 };
    stepDynamics(states[0], input, 1/120, settings, exhaustive);
    stepDynamics(states[1], input, 1/120, settings, sampler.sample.bind(sampler));
    assert.deepEqual(states[1].position.toArray(), states[0].position.toArray(), settings.id + ': exact physics trajectory');
    assert.deepEqual(states[1].quaternion.toArray(), states[0].quaternion.toArray());
    assert.deepEqual(states[1].velocity.toArray(), states[0].velocity.toArray());
  }
}

const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), light = new THREE.DirectionalLight();
const material = new THREE.MeshStandardMaterial();
const caster = new THREE.Mesh(new THREE.BoxGeometry(), material); caster.castShadow = true;
scene.add(caster, light, light.target);
const renderer = { shadowMap: { type: THREE.PCFSoftShadowMap, enabled: true } };
const cache = createShadowCache(scene, light, camera);
function checkShadow(expected, message) {
  scene.updateMatrixWorld(); cache.update(renderer);
  assert.equal(light.shadow.needsUpdate, expected, message);
  light.shadow.map = {}; light.shadow.needsUpdate = false;
}
checkShadow(true, 'initial shadow renders'); checkShadow(false, 'identical shadow is reused');
camera.position.x = 4; checkShadow(false, 'camera movement alone preserves the light map');
caster.position.x = 1; checkShadow(true, 'car/wheel movement refreshes immediately'); checkShadow(false);
light.target.position.y = 2; checkShadow(true, 'shadow anchor invalidates'); checkShadow(false);
caster.visible = false; checkShadow(true, 'removed caster invalidates'); checkShadow(false);
caster.visible = true; checkShadow(true, 'restored caster invalidates'); checkShadow(false);
material.alphaTest = .4; checkShadow(true, 'alpha-mask changes invalidate'); checkShadow(false);
material.map = new THREE.Texture(); checkShadow(true); checkShadow(false);
material.map.needsUpdate = true; checkShadow(true, 'texture uploads invalidate'); checkShadow(false);
caster.userData.shadowVersion = 1; checkShadow(true, 'batch selection invalidates'); checkShadow(false);
caster.geometry.attributes.position.needsUpdate = true; checkShadow(true, 'deformed geometry invalidates'); checkShadow(false);
light.shadow.mapSize.set(2048, 2048); checkShadow(true, 'quality resize invalidates'); checkShadow(false);
const otherCamera = new THREE.PerspectiveCamera();
caster.position.x = 2;
scene.onBeforeRender(renderer, scene, otherCamera);
assert.equal(light.shadow.needsUpdate, false, 'reflection camera cannot alter shadow scheduling');
checkShadow(true); cache.dispose();

const world = new WorldOptimization(camera);
const chunks = [new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(), material)];
chunks.forEach(chunk => chunk.updateMatrixWorld());
const batch = world.addBatchedMesh(chunks);
const matrix = new THREE.Matrix4();
for (let i = 0; i < chunks.length; i++) assert.ok(batch.getMatrixAt(i, matrix).equals(new THREE.Matrix4()), 'static batch instances are identity');
const detail = createSurfaceDetail(), weather = createWeather(new THREE.Scene(), { material: { uniforms: { night: { value: 0 }, cloudCover: { value: 0 } } } });
const roadMaterial = new THREE.MeshStandardMaterial({ name: 'ROAD_AZER-material' });
detail.apply(roadMaterial); weather.apply(roadMaterial); useStaticBatchMatrices(roadMaterial);
const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <batching_vertex>\n#include <project_vertex>',
  fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
roadMaterial.onBeforeCompile(shader, {});
assert.ok(shader.vertexShader.includes('mat4 batchingMatrix = mat4(1.0)'), 'static vertex shader avoids matrix texture fetches');
assert.ok(shader.uniforms.streetDetail && shader.uniforms.weatherWetness, 'existing surface/weather shader patches survive');
detail.dispose(); weather.dispose();
chunks.forEach(chunk => { chunk.castShadow = true; });
world.entries.forEach(entry => { entry.skip = false; });
const shadowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
shadowCamera.position.set(100, 100, 100); shadowCamera.updateMatrixWorld();
batch.onBeforeShadow(null, batch, camera, shadowCamera, batch.geometry, batch.customDepthMaterial);
assert.equal(batch._multiDrawCount, 0, 'shadow view excludes distant chunks');
batch.onBeforeRender(null, scene, camera, batch.geometry, material);
assert.equal(batch._multiDrawCount, 2, 'main list rebuilds even when shadow visibility flags are identical');
const copied = batch.geometry.attributes.position.array.slice();
const triangles = world.stats.triangles;
world.releaseBatchedSources(chunks);
assert.deepEqual(batch.geometry.attributes.position.array, copied, 'releasing staging preserves batch vertices');
assert.ok(chunks.every(chunk => !chunk.geometry.attributes.position && !chunk.geometry.index));
assert.equal(world.stats.triangles, triangles, 'culling inventory survives staging release');
assert.ok(world.stats.releasedCPUBytes > 0);
batch.dispose();
console.log(`Performance invariants: 200 broad-phase queries, ${contacts} actual road contacts, 4 exact vehicle trajectories, shadow invalidation and batch memory ownership passed.`);
