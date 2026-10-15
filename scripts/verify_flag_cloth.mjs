import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFlagCloth } from '../src/flagCloth.js';
import { WorldOptimization, freezeStaticWorld } from '../src/worldOptimization.js';

const cloth = createFlagCloth(), geometry = cloth.geometry;
const positions = geometry.getAttribute('position'), original = positions.array.slice();
const uv = geometry.getAttribute('uv').array.slice(), index = geometry.index.array.slice();
const columns = geometry.parameters.widthSegments, rows = geometry.parameters.heightSegments, stride = columns + 1;
assert.equal(geometry.parameters.width / geometry.parameters.height, 2, 'retain the original 2:1 cut');
const root = new THREE.Group(), flag = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
flag.userData.deformationBounds = cloth.bounds; root.add(flag); freezeStaticWorld(root);
const world = new WorldOptimization(new THREE.PerspectiveCamera()), entry = world.addMesh(flag);
const point = new THREE.Vector3();
let movement = 0, normalVariation = 0, largestStrain = 0;
for (let frame = 0; frame < 1200; frame++) {
  cloth.update(1 / 60);
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    assert.ok(Number.isFinite(point.x + point.y + point.z), 'no unstable particles');
    assert.ok(entry.bounds.containsPoint(point), 'static-world culling includes every animated position');
    if (i % stride === 0) {
      assert.deepEqual(point.toArray(), [...original.slice(i * 3, i * 3 + 3)], 'the full hoist remains exactly attached');
    } else movement = Math.max(movement, point.distanceTo(new THREE.Vector3(...original.slice(i * 3, i * 3 + 3))));
    const normals = geometry.getAttribute('normal');
    const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
    assert.ok(Number.isFinite(length) && Math.abs(length - 1) < .001, 'folds have current normalized lighting normals');
    normalVariation = Math.max(normalVariation, Math.abs(normals.getX(i)) + Math.abs(normals.getZ(i)));
    const neighbors = [];
    if (i % stride < columns) neighbors.push([i + 1, 7.2 / columns]);
    if (Math.floor(i / stride) < rows) neighbors.push([i + stride, 3.6 / rows]);
    for (const [neighbor, length] of neighbors) {
      const next = new THREE.Vector3().fromBufferAttribute(positions, neighbor);
      largestStrain = Math.max(largestStrain, Math.abs(point.distanceTo(next) / length - 1));
    }
  }
}
assert.ok(movement > .25 && movement < 5, 'gentle wind moves the fly without violent excursions');
assert.ok(normalVariation > .15, 'cloth forms actual three-dimensional folds');
assert.ok(largestStrain < .05, 'tension constraints preserve the flag proportions under gusts');
assert.deepEqual(geometry.getAttribute('uv').array, uv, 'colors and emblem retain the original UV layout');
assert.deepEqual(geometry.index.array, index, 'cloth never tears');
const version = positions.version;
for (const dt of [0, -1, NaN, Infinity]) cloth.update(dt);
assert.equal(positions.version, version, 'invalid or paused steps do not change the cloth');
cloth.update(30);
for (const n of positions.array) assert.ok(Number.isFinite(n), 'a stalled tab resumes without an explosive step');

const simulations = [30, 60, 144].map(fps => {
  const candidate = createFlagCloth();
  for (let frame = 0; frame < fps * 2; frame++) candidate.update(1 / fps);
  return candidate.geometry.attributes.position.array;
});
for (const positions of simulations.slice(1)) assert.deepEqual(positions, simulations[0], 'fixed-step cloth is frame-rate independent');
console.log(`Flag cloth: pinned hoist, 2:1 cut, preserved UVs, moving folds/normals, culling, 20-second stability and 30/60/144 Hz equivalence passed (maximum local strain ${(largestStrain * 100).toFixed(1)}%).`);
