import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { repairMissingNormals } from '../src/elantraModel.js';

const data = JSON.parse(gunzipSync(readFileSync(new URL('../public/assets/vehicles/elantra-showroom.bin', import.meta.url))));
const decode = (encoded, Type) => {
  const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
  return new Type(bytes.buffer);
};
let repaired = 0, checked = 0;
for (const part of data.meshes) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(decode(part.v, Float32Array), 3));
  const normals = new THREE.BufferAttribute(decode(part.n, Int16Array), 3, true);
  const original = normals.array.slice();
  geometry.setAttribute('normal', normals);
  geometry.setIndex(new THREE.BufferAttribute(decode(part.ix, Uint32Array), 1));
  repaired += repairMissingNormals(geometry);
  for (let i = 0; i < normals.count; i++) {
    const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
    assert.ok(Number.isFinite(normal.length()) && normal.length() > 0.95, `${part.id}: normal ${i} must be finite and nonzero`);
    if (original[i * 3] || original[i * 3 + 1] || original[i * 3 + 2]) {
      for (let axis = 0; axis < 3; axis++) assert.equal(normals.array[i * 3 + axis], original[i * 3 + axis], 'preserve valid source normals');
    }
    checked++;
  }
  assert.equal(repairMissingNormals(geometry), 0, 'repair is stable when run again');
  geometry.dispose();
}
assert.ok(repaired > 0, 'the real showroom asset exercises missing-normal repair');
console.log(`Graphics: ${repaired} missing normals repaired; ${checked} normals verified; authored shading preserved.`);
