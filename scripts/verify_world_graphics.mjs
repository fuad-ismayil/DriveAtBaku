import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { partitionMesh, canCullBackfaces, extractOccluders, WorldOptimization, freezeStaticWorld } from '../src/worldOptimization.js';
import { surfaceKind, createSurfaceDetail } from '../src/surfaceDetail.js';
import { createLocalReflections } from '../src/localReflections.js';
import { createShadowCandidate, updateShadowCandidates, isTrackBoundary } from '../src/trackBoundaries.js';
import { BarrierCollision } from '../src/barrierCollision.js';
import { createDynamicsState } from '../src/vehicleDynamics.js';
import { VEHICLES } from '../src/vehicleCatalog.js';
import { readMapGeometry } from './lib/readMapGeometry.mjs';

function mesh(vertices, name = 'BAK_BUILDING_TEST-material') {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const result = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name, side: THREE.DoubleSide }));
  result.updateMatrixWorld(true);
  return result;
}
function cameraAt(position, target) {
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.15, 6000);
  camera.up.set(0, 0, 1); camera.position.fromArray(position); camera.lookAt(...target); camera.updateMatrixWorld();
  return camera;
}
// Full wall and disconnected halves: a real opening must never become a blocker.
const wall = mesh([-10, 5, 0, 10, 5, 0, 10, 5, 20, -10, 5, 0, 10, 5, 20, -10, 5, 20]);
const target = mesh([-0.3, 9, 3, 0.3, 9, 3, 0, 9, 4]);
const camera = cameraAt([-6, 0, 3], [-6, 10, 3]);
target.position.x = -6; target.updateMatrixWorld(true);
const world = new WorldOptimization(camera);
world.addOccluders(wall); world.addMesh(wall); world.addMesh(target); world.update();
assert.equal(world.entries[1].skip, true, 'fully covered geometry is occluded');
target.onBeforeRender(null, null, camera, target.geometry);
assert.equal(target.geometry.drawRange.count, 0, 'main view actually skips its draw');
target.onBeforeShadow(null, target, camera, new THREE.OrthographicCamera(), target.geometry);
assert.equal(target.geometry.drawRange.count, Infinity, 'off-camera geometry still casts shadows');
target.onBeforeRender(null, null, new THREE.PerspectiveCamera(), target.geometry);
assert.equal(target.geometry.drawRange.count, Infinity, 'reflection cameras retain geometry');
const batchWorld = new WorldOptimization(camera);
const batchedA = mesh([-0.3, 9, 3, 0.3, 9, 3, 0, 9, 4]);
const batchedB = mesh([-0.3, 10, 3, 0.3, 10, 3, 0, 10, 4]);
batchedA.geometry.setIndex([0, 1, 2]); batchedB.geometry.setIndex([0, 1, 2]);
batchedB.material = batchedA.material;
const testBatch = batchWorld.addBatchedMesh([batchedA, batchedB]);
batchWorld.entries[0].skip = true;
testBatch.onBeforeRender(null, null, camera, testBatch.geometry, testBatch.material);
assert.equal(testBatch.getVisibleAt(0), false); assert.equal(testBatch.getVisibleAt(1), true);
testBatch.onBeforeRender(null, null, new THREE.PerspectiveCamera(), testBatch.geometry, testBatch.material);
assert.equal(testBatch.getVisibleAt(0), true, 'batched reflection restores hidden instance');
batchedA.castShadow = true; batchedB.castShadow = false;
testBatch.onBeforeShadow(null, testBatch, camera, camera, testBatch.geometry, testBatch.material);
assert.equal(testBatch.getVisibleAt(0), true); assert.equal(testBatch.getVisibleAt(1), false, 'batch shadows use independent caster selection');
testBatch.dispose();
camera.lookAt(-6, -10, 3); world.update();
assert.ok(world.stats.frustum > 0, 'current camera turn updates frustum immediately');
camera.position.set(-6, 7, 3); camera.lookAt(-6, 10, 3); world.update();
assert.equal(world.entries[1].skip, false, 'passing the occluder restores visibility immediately');

const openingCamera = cameraAt([0, 0, 3], [0, 10, 3]);
const openingWorld = new WorldOptimization(openingCamera);
openingWorld.addOccluders(mesh([-10, 5, 0, -2, 5, 0, -2, 5, 20, -10, 5, 0, -2, 5, 20, -10, 5, 20]));
openingWorld.addOccluders(mesh([2, 5, 0, 10, 5, 0, 10, 5, 20, 2, 5, 0, 10, 5, 20, 2, 5, 20]));
const throughOpening = mesh([-0.3, 9, 3, 0.3, 9, 3, 0, 9, 4]);
openingWorld.addMesh(throughOpening); openingWorld.update();
assert.equal(openingWorld.entries[0].skip, false, 'opening between opaque facades stays visible');
wall.material.alphaTest = 0.04;
assert.equal(extractOccluders(wall).length, 0, 'cutout walls cannot occlude');
wall.material.alphaTest = 0; wall.material.transparent = true;
assert.equal(extractOccluders(wall).length, 0, 'transparent facades cannot occlude');
wall.material.transparent = false;
const nearWorld = new WorldOptimization(cameraAt([-6, 4.95, 3], [-6, 10, 3]));
nearWorld.addOccluders(wall); nearWorld.addMesh(target); nearWorld.update();
assert.equal(nearWorld.entries[0].skip, false, 'near-plane intersections fail open');
const grazingWorld = new WorldOptimization(cameraAt([-9.99, 0, 3], [-9.99, 10, 3]));
const grazing = mesh([-10.2, 5.1, 3, -9.8, 5.1, 3, -10, 5.1, 4]);
grazingWorld.addOccluders(wall); grazingWorld.addMesh(grazing); grazingWorld.update();
assert.equal(grazingWorld.entries[0].skip, false, 'box crossing a facade edge stays visible');
wall.material.side = THREE.FrontSide;
wall.scale.x = -1; wall.updateMatrixWorld(true);
const mirroredCamera = cameraAt([-6, 0, 3], [-6, 10, 3]);
const mirroredWorld = new WorldOptimization(mirroredCamera);
mirroredWorld.addOccluders(wall); mirroredWorld.addMesh(target); mirroredWorld.update();
assert.equal(mirroredWorld.entries[0].skip, true, 'mirrored facade matches WebGL front-face reversal');
wall.material.side = THREE.BackSide;
const culledFacadeWorld = new WorldOptimization(mirroredCamera);
culledFacadeWorld.addOccluders(wall); culledFacadeWorld.addMesh(target); culledFacadeWorld.update();
assert.equal(culledFacadeWorld.entries[0].skip, false, 'a culled facade side cannot hide geometry');
wall.material.depthWrite = false;
assert.equal(extractOccluders(wall).length, 0, 'depth-disabled surfaces cannot occlude');

const road = mesh([0, 0, 0, 10, 0, 0, 0, 10, 0], 'ROAD_AZER-material');
assert.equal(canCullBackfaces(road), true, 'correct opaque road winding allows backface culling');
road.geometry.getAttribute('normal').array.fill(-1);
assert.equal(canCullBackfaces(road), false, 'incorrect or reversed normals keep both faces');
assert.equal(canCullBackfaces(mesh([0, 0, 0, 10, 0, 0, 0, 10, 0], 'FENCE_TEST-material')), false);
assert.equal(surfaceKind('ROAD_AZER-material'), 'asphalt');
for (const name of ['PITROAD_ALLIANZ-material', 'ROAD_WHITELINE_A-material', 'BAK_ROAD_MARKINGS_A-material', 'ROADA_1-material']) {
  assert.equal(surfaceKind(name), null, `${name}: advertising and markings are untouched`);
}
const surfaces = createSurfaceDetail();
const surface = new THREE.MeshStandardMaterial({ name: 'ROAD_AZER-material' });
let previousPatchCalled = false;
surface.onBeforeCompile = shader => { previousPatchCalled = true; shader.uniforms.existingPatch = { value: 1 }; };
surfaces.apply(surface);
const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
surface.onBeforeCompile(shader, null);
assert.ok(previousPatchCalled && shader.uniforms.existingPatch, 'road detail composes existing shader patches');
assert.ok(shader.fragmentShader.indexOf('vec4 streetGrain') < shader.fragmentShader.indexOf('streetGrain.b'), 'grain is declared before material calculations');
assert.equal(surfaces.apply(surface), false, 'shared materials receive only one shader patch');
assert.equal(surfaces.texture.colorSpace, THREE.NoColorSpace, 'data texture avoids color transforms');
surfaces.dispose();

// Check reflection scheduling and renderer-state restoration without a browser.
const captureLog = [];
const mockRenderer = {
  compile() {},
  coordinateSystem: THREE.WebGLCoordinateSystem, extensions: { has: () => true },
  xr: { enabled: true }, shadowMap: { autoUpdate: true },
  getRenderTarget: () => null, getActiveCubeFace: () => 3, getActiveMipmapLevel: () => 0,
  setRenderTarget: (target, face) => captureLog.push({ target, face }),
  render() { throw new Error('intentional capture failure'); },
};
const captureScene = new THREE.Scene(), captureSky = new THREE.Object3D(), captureCar = new THREE.Group();
captureSky.position.set(1, 2, 3); captureCar.visible = true;
const reflections = createLocalReflections(mockRenderer, captureScene, captureSky);
assert.throws(() => reflections.update(0.016, captureCar, [captureCar], false), /intentional/);
assert.equal(captureCar.visible, true, 'vehicle visibility restored on capture failure');
assert.deepEqual(captureSky.position.toArray(), [1, 2, 3], 'sky position restored on failure');
assert.equal(mockRenderer.xr.enabled, true); assert.equal(mockRenderer.shadowMap.autoUpdate, true);
assert.equal(captureLog.at(-1).target, null); assert.equal(captureLog.at(-1).face, 3);
reflections.setQuality('performance');
assert.equal(reflections.stats.size, 0, 'performance preset releases the local capture target');
reflections.dispose();

let mockTarget = null, mockFace = 0, mockMip = 0, capturedDirections = [], failCapture = false;
const schedulingRenderer = {
  coordinateSystem: THREE.WebGLCoordinateSystem, extensions: { has: () => true }, compile() {},
  xr: { enabled: false }, shadowMap: { autoUpdate: true }, autoClear: true,
  getRenderTarget: () => mockTarget, getActiveCubeFace: () => mockFace, getActiveMipmapLevel: () => mockMip,
  setRenderTarget(target, face = 0, mip = 0) { mockTarget = target; mockFace = face; mockMip = mip; },
  render(scene, camera) {
    if (scene !== captureScene) return; // PMREM filter passes are checked as scheduling, not rasterized here.
    if (failCapture) throw new Error('capture interrupted');
    assert.equal(captureCar.visible, false, 'the probe excludes the captured car');
    assert.equal(this.shadowMap.autoUpdate, false, 'the probe reuses existing shadows');
    capturedDirections.push(mockFace);
  },
};
const reflectivePaint = new THREE.MeshPhysicalMaterial();
captureCar.userData.paintMaterials = [reflectivePaint];
const scheduledReflections = createLocalReflections(schedulingRenderer, captureScene, captureSky);
for (let i = 0; i < 5; i++) {
  scheduledReflections.update(0.016, captureCar, [captureCar], false);
  assert.equal(reflectivePaint.envMap, null, 'partial cubemap never reaches car materials');
}
scheduledReflections.update(0.016, captureCar, [captureCar], false);
assert.deepEqual(capturedDirections, [0, 1, 2, 3, 4, 5], 'exactly one cube direction per frame');
assert.equal(scheduledReflections.stats.captures, 1);
const published = reflectivePaint.envMap;
assert.ok(published?.isTexture && published.mapping === THREE.CubeUVReflectionMapping, 'complete cubemap is filtered for PBR');
assert.equal(mockTarget, null, 'PMREM also restores the main render target');
for (let i = 0; i < 10; i++) scheduledReflections.update(0.1, captureCar, [captureCar], false);
assert.equal(capturedDirections.length, 6, 'stationary car reuses completed reflections');
captureCar.position.x = 100;
scheduledReflections.update(0.016, captureCar, [captureCar], false);
assert.equal(capturedDirections.length, 7, 'teleport starts a fresh capture immediately');
assert.equal(reflectivePaint.envMap, null, 'teleport clears the old local reflection');
for (let i = 0; i < 5; i++) scheduledReflections.update(0.016, captureCar, [captureCar], false);
assert.equal(reflectivePaint.envMap, published, 'filtered target reused across captures');
scheduledReflections.invalidate();
assert.equal(reflectivePaint.envMap, null, 'day/night invalidation immediately restores the sky fallback');
for (let i = 0; i < 6; i++) scheduledReflections.update(0.016, captureCar, [captureCar], false);
scheduledReflections.update(0.016, captureCar, [captureCar], true);
assert.equal(reflectivePaint.envMap, null, 'garage keeps its dedicated studio environment');
scheduledReflections.setQuality('cinematic');
assert.equal(scheduledReflections.stats.size, 256);
scheduledReflections.setQuality('performance');
assert.equal(scheduledReflections.stats.size, 0);
scheduledReflections.dispose();

// Hash each ordered triangle including its position, normal and UV components.
// Per-mesh multisets permit reordering, but detect lost/duplicated triangles,
// reversed winding, changed UVs or normals during partitioning.
const bits = new Float32Array(1), integer = new Uint32Array(bits.buffer);
function triangleHashes(geometry, counts = new Map(), direction = 1) {
  const attributes = Object.values(geometry.attributes), index = geometry.index;
  const count = index?.count ?? geometry.getAttribute('position').count;
  for (let i = 0; i < count; i += 3) {
    let hash = 2166136261;
    for (let j = 0; j < 3; j++) {
      const id = index ? index.getX(i + j) : i + j;
      for (const attribute of attributes) for (let k = 0; k < attribute.itemSize; k++) {
        bits[0] = attribute.array[id * attribute.itemSize + k];
        hash = Math.imul(hash ^ integer[0], 16777619) >>> 0;
      }
    }
    const next = (counts.get(hash) ?? 0) + direction;
    if (next === 0) counts.delete(hash); else counts.set(hash, next);
  }
  return counts;
}

const route = JSON.parse(readFileSync(new URL('../public/generated/route.json', import.meta.url)));
const meshes = [...readMapGeometry('baku'), ...readMapGeometry('buildings')];
const root = new THREE.Group();
const liveCamera = cameraAt([route.spawn[0], route.spawn[1] - 10, route.spawn[2] + 4], [route.spawn[0], route.spawn[1], route.spawn[2] + 1]);
const liveWorld = new WorldOptimization(liveCamera), candidates = [];
const batches = [];
const materialVotes = new Map();
let sourceTriangles = 0, splitMeshes = 0;
const started = performance.now();
for (const original of meshes) {
  root.add(original);
  sourceTriangles += (original.geometry.index?.count ?? original.geometry.getAttribute('position').count) / 3;
  const eligible = canCullBackfaces(original);
  materialVotes.set(original.material, eligible);
  if (eligible) original.material.side = THREE.FrontSide;
  liveWorld.addOccluders(original);
  const chunks = partitionMesh(original);
  if (chunks[0] !== original) {
    splitMeshes++;
    const hashes = triangleHashes(original.geometry);
    for (const chunk of chunks) triangleHashes(chunk.geometry, hashes, -1);
    assert.equal(hashes.size, 0, `${original.name}: preserve every triangle with its normals, UVs and winding`);
    for (const chunk of chunks) assert.ok(chunk.matrixWorld.equals(original.matrixWorld), 'partition retains authored world transform');
    const batch = liveWorld.addBatchedMesh(chunks);
    batches.push(batch); root.add(batch);
    original.visible = false;
  } else liveWorld.addMesh(original);
  for (const chunk of chunks) {
    const candidate = createShadowCandidate(chunk);
    if (candidate) candidates.push(candidate);
  }
}
freezeStaticWorld(root);
assert.ok(root.children.every(child => !child.matrixAutoUpdate && !child.matrixWorldAutoUpdate), 'static transforms are frozen');
assert.equal(liveWorld.stats.triangles, sourceTriangles, 'real map triangle inventory stays intact');
assert.equal(sourceTriangles, 2385404);
assert.ok(splitMeshes > 50 && liveWorld.entries.length > meshes.length, 'real city batches gain local culling bounds');
updateShadowCandidates(candidates, new THREE.Vector3(...route.spawn));
assert.ok(candidates.some(candidate => /building/i.test(candidate.mesh.material.name) && candidate.mesh.castShadow), 'real nearby buildings cast shadows');

const views = [];
// Route views exercise culling against actual city geometry, including turns.
const points = route.checkpoints;
assert.ok(points?.length > 4, 'route exposes sampled points');
for (let i = 0; i < points.length; i += Math.max(1, Math.floor(points.length / 24))) {
  const p = points[i], q = points[(i + 1) % points.length];
  liveCamera.position.set(p[0], p[1], p[2] + 3);
  liveCamera.lookAt(q[0], q[1], q[2] + 1);
  liveWorld.update();
  assert.ok(liveWorld.entries.every(entry => !entry.skip || !entry.bounds.containsPoint(liveCamera.position)), 'camera-containing bounds are never hidden');
  let baselineTriangles = 0, baselineObjects = 0;
  for (const original of meshes) {
    if (liveWorld.frustum.intersectsObject(original)) {
      baselineTriangles += (original.geometry.index?.count ?? original.geometry.getAttribute('position').count) / 3;
      baselineObjects++;
    }
  }
  for (const batch of batches) {
    batch.onBeforeRender(null, null, liveCamera, batch.geometry, batch.material);
    assert.ok(batch._multiDrawCount <= batch.maxInstanceCount, 'batch render list stays within allocation');
  }
  const triangles = liveWorld.stats.mainTriangles, frustum = liveWorld.stats.frustum, occluded = liveWorld.stats.occluded, cullingMs = liveWorld.stats.milliseconds;
  liveWorld.occlusion = false; liveWorld.update();
  const frustumOnlyTriangles = liveWorld.stats.mainTriangles;
  liveWorld.occlusion = true;
  assert.ok(triangles <= frustumOnlyTriangles, 'occlusion never adds triangles');
  views.push({ routeIndex: i, originalFrustumTriangles: baselineTriangles, originalFrustumObjects: baselineObjects,
    frustumOnlyTriangles, mainTriangles: triangles, frustum, occluded, cullingMs });
}
assert.ok(views.some(view => view.occluded > 0), 'real opaque facades actually occlude city chunks');
liveWorld.update();
const enabled = liveWorld.stats.mainTriangles;
liveWorld.occlusion = false; liveWorld.update();
assert.ok(liveWorld.stats.mainTriangles >= enabled && liveWorld.stats.occluded === 0, 'diagnostic bypass disables only occlusion');

const fallbackWorld = new WorldOptimization(liveCamera);
for (const original of meshes) {
  const visible = original.visible; original.visible = true;
  fallbackWorld.addOccluders(original); original.visible = visible;
  const chunks = partitionMesh(original, 256);
  const hashes = triangleHashes(original.geometry);
  for (const chunk of chunks) {
    triangleHashes(chunk.geometry, hashes, -1);
    fallbackWorld.addMesh(chunk);
  }
  assert.equal(hashes.size, 0, 'fallback partition preserves all authored triangle data');
}
fallbackWorld.update();
assert.equal(fallbackWorld.stats.triangles, sourceTriangles, 'fallback preserves complete map geometry');
assert.ok(fallbackWorld.entries.length < liveWorld.entries.length, 'non-multidraw fallback uses fewer, larger chunks');

// Rendering visibility never changes the original barrier's collision response.
const originalBarrier = meshes.find(candidate => isTrackBoundary(candidate));
assert.ok(originalBarrier);
const collider = new BarrierCollision(); collider.addMesh(originalBarrier);
const boundary = mesh([3, -10, 0, 3, 10, 0, 3, 10, 3, 3, -10, 0, 3, 10, 3, 3, -10, 3], 'FENCE_CONCRETE_TEST-material');
const boundaryCollider = new BarrierCollision(); boundaryCollider.addMesh(boundary);
const state = createDynamicsState(0, VEHICLES.ferrari, new THREE.Vector3());
const previousPosition = state.position.clone(), previousQuaternion = state.quaternion.clone();
state.position.x = 10; boundary.visible = false; boundary.geometry.setDrawRange(0, 0);
assert.ok(boundaryCollider.resolve(state, previousPosition, previousQuaternion, VEHICLES.ferrari), 'hidden render geometry does not remove barrier collision');

const report = { sourceTriangles, sourceMeshes: meshes.length, renderChunks: liveWorld.entries.length, renderObjects: liveWorld.stats.renderObjects,
  materialBatches: liveWorld.stats.batches, splitMeshes,
  opaqueBackfaceMaterials: [...materialVotes.values()].filter(Boolean).length, occluderTriangles: liveWorld.stats.occluders,
  activeShadowChunksAtSpawn: candidates.filter(candidate => candidate.mesh.castShadow).length,
  fallbackRenderChunks: fallbackWorld.entries.length,
  preparationMs: performance.now() - started, views,
  limitation: 'CPU geometry and visibility tests; no browser/GPU benchmark or visual verification.' };
mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
writeFileSync(new URL('../artifacts/world-graphics-verification.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sourceTriangles, sourceMeshes: meshes.length, renderChunks: liveWorld.entries.length,
  renderObjects: liveWorld.stats.renderObjects, materialBatches: liveWorld.stats.batches,
  opaqueBackfaceMaterials: report.opaqueBackfaceMaterials, fallbackRenderChunks: report.fallbackRenderChunks,
  sampledViews: views.length, maximumOccludedChunks: Math.max(...views.map(view => view.occluded)),
  report: 'artifacts/world-graphics-verification.json' }, null, 2));
console.log('World graphics checks passed: geometry preservation, conservative culling, shadow/reflection visibility, collision independence, road shader composition and reflection cleanup.');
