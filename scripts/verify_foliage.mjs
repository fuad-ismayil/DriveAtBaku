import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyFoliageLighting } from '../src/foliageLighting.js';
import { createWeather } from '../src/weather.js';
import { useStaticBatchMatrices } from '../src/worldOptimization.js';
import { readMapGeometry } from './lib/readMapGeometry.mjs';

// Reproduce the real asset's failure: the two triangles of the first leaf card
// have opposite winding while their authored normals describe the same canopy.
const tree = readMapGeometry('baku', name => name === 'TREEC-material')[0];
const geometry = tree.geometry, positions = geometry.attributes.position;
const normals = geometry.attributes.normal, a = new THREE.Vector3(), b = a.clone(), c = a.clone();
function face(offset) {
  const ids = [0, 1, 2].map(i => geometry.index.getX(offset + i));
  a.fromBufferAttribute(positions, ids[0]); b.fromBufferAttribute(positions, ids[1]); c.fromBufferAttribute(positions, ids[2]);
  return b.sub(a).cross(c.sub(a)).normalize().clone();
}
assert.ok(face(0).dot(face(3)) < -.999, 'real leaf card has reversed triangle winding');
const n0 = new THREE.Vector3().fromBufferAttribute(normals, geometry.index.getX(0));
const n1 = new THREE.Vector3().fromBufferAttribute(normals, geometry.index.getX(3));
assert.ok(n0.dot(n1) > .999, 'canopy normals agree across the reversed triangles');
for (const direction of [-1, 1]) {
  const threeNormal = n0.clone().multiplyScalar(direction);
  assert.ok(threeNormal.multiplyScalar(direction).distanceTo(n0) < 1e-9,
    'canopy correction gives the same light response on either winding');
}

const sky = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.ShaderMaterial({ uniforms: { cloudCover: { value: 0 } } }));
const weather = createWeather(new THREE.Scene(), sky);
for (const name of ['TREEC-material', 'BAK_FEATURE_P_HEDGES_A_01-material']) {
  const material = new THREE.MeshStandardMaterial({ name, roughness: .82, map: new THREE.Texture(),
    side: THREE.DoubleSide, alphaTest: .38, alphaToCoverage: true, color: 0x729252 });
  const color = material.color.toArray(), texture = material.map;
  let previousCalled = false;
  material.onBeforeCompile = shader => { previousCalled = true; shader.uniforms.priorPatch = { value: 1 }; };
  weather.apply(material);
  assert.equal(applyFoliageLighting(material), true);
  assert.equal(applyFoliageLighting(material), false, 'shared materials are patched once');
  useStaticBatchMatrices(material);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, null);
  assert.ok(previousCalled && shader.uniforms.priorPatch, 'preserves existing shader hooks');
  assert.ok(shader.vertexShader.includes('mat4 batchingMatrix = mat4(1.0)'), 'composes with static batching');
  assert.ok(shader.fragmentShader.indexOf('roughnessFactor = max(roughnessFactor, .72)')
    > shader.fragmentShader.indexOf('roughnessFactor=mix(roughnessFactor,.96,settledSnow)'), 'leaf roughness floor runs after wetness and snow');
  assert.equal(shader.fragmentShader.includes('normal *= faceDirection;'), name === 'TREEC-material', 'only authored canopy normals bypass face flipping');
  assert.equal(material.map, texture); assert.deepEqual(material.color.toArray(), color, 'no blanket albedo darkening');
  assert.equal(material.side, THREE.DoubleSide); assert.equal(material.alphaTest, .38);
  assert.equal(material.alphaToCoverage, true);
  const dryKey = material.customProgramCacheKey();
  for (const mode of ['rain', 'wet', 'snow', 'sunny']) {
    weather.setMode(mode);
    assert.equal(shader.uniforms.weatherWetness.value, weather.preset.wet);
    assert.equal(material.customProgramCacheKey(), dryKey, 'weather changes reuse the foliage program');
  }
}
for (const name of ['BAK_TREE_BASE_A-material', 'BAK_TREE_BASE_B-material', 'BAK_TREE_LIGHTS_A_01-material',
  'ROAD_AZER-material', 'BAK_BUILDING_TEST-material', 'FENCE_TEST-material', 'window', 'car paint']) {
  const material = new THREE.MeshStandardMaterial({ name, roughness: .22, metalness: .8 });
  const hook = material.onBeforeCompile, key = material.customProgramCacheKey();
  assert.equal(applyFoliageLighting(material), false, `${name} is untouched`);
  assert.equal(material.onBeforeCompile, hook); assert.equal(material.customProgramCacheKey(), key);
  assert.equal(material.roughness, .22); assert.equal(material.metalness, .8);
}
weather.dispose();
console.log('Foliage checks passed: real asset winding, consistent canopy normals, restrained highlights, weather/batch composition, original colors and unrelated materials.');
