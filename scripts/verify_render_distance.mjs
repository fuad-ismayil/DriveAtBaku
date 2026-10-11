import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { DISTANCE_SETTINGS, normalizeDistance, readDistances, saveDistance, isDistanceProp } from '../src/renderDistance.js';
import { WorldOptimization, partitionMesh } from '../src/worldOptimization.js';
import { readMapGeometry } from './lib/readMapGeometry.mjs';

const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
assert.deepEqual(readDistances(storage), { renderDistance: 6000, propsDistance: 3000 });
assert.equal(saveDistance(storage, 'renderDistance', 1268), 1300);
assert.equal(saveDistance(storage, 'propsDistance', 249), 250);
assert.deepEqual(readDistances(storage), { renderDistance: 1300, propsDistance: 250 });
const unavailable = { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); } };
assert.deepEqual(readDistances(unavailable), readDistances(null));
assert.equal(saveDistance(unavailable, 'propsDistance', 200), 200);
for (const [name, spec] of Object.entries(DISTANCE_SETTINGS)) {
  for (const value of ['bad', Infinity, undefined, null, '']) assert.equal(normalizeDistance(value, name), spec.default);
  assert.equal(normalizeDistance(-100, name), spec.min);
  assert.equal(normalizeDistance(1e6, name), spec.max);
}

function mesh(name, y, width = 10) {
  const result = new THREE.Mesh(new THREE.BoxGeometry(width, 10, 10), new THREE.MeshStandardMaterial({ name }));
  result.position.set(0, y, 0); result.updateMatrixWorld(); return result;
}
const camera = new THREE.PerspectiveCamera(65, 16 / 9, .15, 6000);
camera.up.set(0, 0, 1); camera.lookAt(0, 100, 0); camera.updateMatrixWorld();
const world = new WorldOptimization(camera, { occlusion: false });
const nearTree = mesh('TREEC-material', 50), farTree = mesh('TREEC-material', 800);
const road = mesh('ROAD_AZER-material', 800), wall = mesh('BAK_BUILDING_HIGH-material', 1500);
const crossing = mesh('utility_pole-material', 140, 100);
for (const item of [nearTree, farTree, road, wall, crossing]) world.addMesh(item);
world.setDistances({ renderDistance: 2000, propsDistance: 100 }); world.update();
assert.deepEqual(world.entries.map(entry => entry.skip), [false, true, false, false, true], 'prop limit leaves distant road/building visible');
world.setDistances({ propsDistance: 3000 }); world.update();
assert.ok(world.entries.every(entry => !entry.skip), 'live change invalidates a stationary view');
world.setDistances({ renderDistance: 400 }); world.update();
assert.equal(world.entries[2].skip, true, 'world limit removes distant road');
assert.equal(world.entries[1].skip, true, 'props cannot draw outside the world limit');
const overhang = mesh('ROAD_AZER-material', 410, 10);
overhang.geometry = new THREE.BoxGeometry(10, 60, 10); overhang.updateMatrixWorld();
world.addMesh(overhang); world.update();
assert.equal(world.entries.at(-1).skip, false, 'bounds crossing the range remain visible until their last surface fades');
camera.lookAt(0, -100, 0); world.update();
assert.ok(world.entries.every(entry => entry.skip), 'fast camera turn updates immediately');
camera.lookAt(0, 100, 0); world.update();
assert.equal(world.entries[0].skip, false, 'turning back restores visible props immediately');

const originalSide = farTree.material.side, alpha = farTree.material.alphaTest;
const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
farTree.material.onBeforeCompile(shader, {});
assert.ok(shader.fragmentShader.includes('distanceCoverage(propsDistanceLimit'));
assert.ok(shader.fragmentShader.indexOf('if (propCoverage <') < shader.fragmentShader.indexOf('#include <lights_fragment_begin>'), 'fade rejection precedes lighting');
assert.equal(farTree.material.side, originalSide); assert.equal(farTree.material.alphaTest, alpha);
const reflection = new THREE.PerspectiveCamera();
farTree.material.onBeforeRender(null, null, reflection);
assert.equal(shader.uniforms.distanceMainView.value, 0, 'reflection has independent visibility');
farTree.material.onBeforeRender(null, null, camera);
assert.equal(shader.uniforms.distanceMainView.value, 1);
farTree.onBeforeRender(null, null, camera, farTree.geometry);
assert.equal(farTree.geometry.drawRange.count, 0);
farTree.onBeforeShadow(null, farTree, camera, reflection, farTree.geometry);
assert.equal(farTree.geometry.drawRange.count, Infinity, 'hidden prop remains a shadow caster');

let calls = 0;
const renderer = { renderBufferDirect() { calls++; } };
const removeFilter = world.installSubmissionFilter(renderer);
renderer.renderBufferDirect(camera, null, farTree.geometry, farTree.material, farTree, null);
assert.equal(calls, 0, 'hidden world bypasses expensive submission');
renderer.renderBufferDirect(reflection, null, farTree.geometry, farTree.material, farTree, null);
assert.equal(calls, 1, 'other views still submit');
renderer.renderBufferDirect(camera, null, nearTree.geometry, nearTree.material, nearTree, null);
assert.equal(calls, 2, 'visible world submits');
const player = mesh('vehicle', 800);
renderer.renderBufferDirect(camera, null, player.geometry, player.material, player, null);
assert.equal(calls, 3, 'player is unaffected');
removeFilter();
renderer.renderBufferDirect(camera, null, farTree.geometry, farTree.material, farTree, null);
assert.equal(calls, 4, 'filter can be cleanly removed');
world.setDistances({ renderDistance: 6000, propsDistance: 3000 }); world.update();
world.setDistances({ renderDistance: 400, propsDistance: 100 }); world.update(1 / 60);
assert.ok(world.currentDistances.renderDistance > 400 && world.currentDistances.renderDistance < 6000, 'slider edits ease over time');
for (let i = 0; i < 90; i++) world.update(1 / 60);
assert.equal(world.currentDistances.renderDistance, 400);
const fogScene = new THREE.Scene(); fogScene.fog = new THREE.FogExp2(0xa8c4cc, .00018);
const removeFog = world.installDistanceFog(fogScene);
fogScene.onBeforeRender(null, fogScene, camera);
assert.equal(fogScene.fog.density, 2.8 / 400, 'native fog conceals the world cutoff');
fogScene.onBeforeRender(null, fogScene, reflection);
assert.equal(fogScene.fog.density, .00018, 'even a nested reflection retains weather fog');
fogScene.onAfterRender(null, fogScene, reflection);
assert.equal(fogScene.fog.density, 2.8 / 400, 'nested view restores the main-view haze');
fogScene.onAfterRender(null, fogScene, camera);
assert.equal(fogScene.fog.density, .00018, 'main-view fog does not alter weather preferences');
fogScene.onBeforeRender(null, fogScene, reflection);
assert.equal(fogScene.fog.density, .00018, 'reflection retains weather fog');
fogScene.onAfterRender(null, fogScene, reflection);
fogScene.fog.density = .02;
fogScene.onBeforeRender(null, fogScene, camera);
assert.equal(fogScene.fog.density, .02, 'stronger weather fog is never reduced');
fogScene.onAfterRender(null, fogScene, camera); fogScene.fog.density = .00018;
world.setDistances({ renderDistance: 6000 }); world.update();
fogScene.onBeforeRender(null, fogScene, camera);
assert.equal(fogScene.fog.density, .00018, 'maximum world range retains original atmosphere');
fogScene.onAfterRender(null, fogScene, camera); removeFog();

for (const name of ['street_light-material', 'utility_pole-material', 'TREEC-material', 'BAK_FEATURE_P_HEDGES_A_01-material']) assert.ok(isDistanceProp(mesh(name, 0)), name);
for (const name of ['ROAD_WHITELINE_A-material', 'BAK_BUILDING_DIST_LIGHTS-material', 'BAK_BARRIER_PITWALL_A_01-material', 'unknown']) assert.equal(isDistanceProp(mesh(name, 0)), false, name);

// Real map workload, including the larger chunks used on older graphics drivers.
const route = JSON.parse(readFileSync(new URL('../public/generated/route.json', import.meta.url)));
const source = [...readMapGeometry('baku'), ...readMapGeometry('buildings')];
const rows = [];
for (const cell of [96, 256]) {
  const live = new WorldOptimization(camera, { occlusion: false });
  for (const original of source) for (const chunk of partitionMesh(original, cell)) live.addMesh(chunk, false);
  assert.equal(live.stats.triangles, 2385404, 'all authored triangles are retained');
  assert.ok(live.entries.filter(entry => entry.props).length > 10, 'real prop names are recognized');
  let reducedViews = 0;
  for (let index = 0; index < route.checkpoints.length; index++) {
    const from = route.checkpoints[index], to = route.checkpoints[(index + 1) % route.checkpoints.length];
    camera.position.fromArray(from).add(new THREE.Vector3(0, 0, 3));
    camera.lookAt(new THREE.Vector3(...to));
    const counts = [];
    for (const [renderDistance, propsDistance] of [[6000, 3000], [6000, 250], [1200, 250], [400, 100]]) {
      live.setDistances({ renderDistance, propsDistance }); live.update();
      counts.push(live.stats.mainTriangles);
      for (const entry of live.entries) if (!entry.props) {
        if (renderDistance === 6000) assert.equal(entry.skip, !live.frustum.intersectsBox(entry.bounds), 'props slider preserves every visible structural chunk');
      }
    }
    assert.ok(counts.every((count, i) => i === 0 || count <= counts[i - 1]), 'workload decreases predictably at every checkpoint');
    if (counts.at(-1) < counts[0]) reducedViews++;
    rows.push({ cell, checkpoint: index, triangles: counts });
  }
  assert.ok(reducedViews > 10, 'distance settings save work around the circuit');
}
mkdirSync(new URL('../artifacts/distance-settings/', import.meta.url), { recursive: true });
writeFileSync(new URL('../artifacts/distance-settings/geometry.json', import.meta.url), JSON.stringify(rows, null, 2));
console.log('Render distance: persistence, invalid storage, independent props/roads, bounds overhangs, turns, fades, other views, submission filtering and both real-map chunk sizes passed.');
