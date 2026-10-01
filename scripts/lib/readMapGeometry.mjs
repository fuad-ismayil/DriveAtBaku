import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';

// Read geometry directly for real-asset checks without a browser or image decoder.
export function readMapGeometry(asset, include = () => true) {
  const root = new URL('../../public/generated/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('asset-manifest.json', root)));
  const packed = manifest.assets[asset];
  const bytes = packed
    ? gunzipSync(Buffer.concat(packed.parts.map(part => readFileSync(new URL(part, root)))))
    : readFileSync(new URL(`${asset}.glb`, root));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryOffset = 20 + jsonLength + 8;
  const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function attribute(id) {
    const accessor = gltf.accessors[id], view = gltf.bufferViews[accessor.bufferView];
    const Type = types[accessor.componentType], size = sizes[accessor.type];
    if (!Type || view.byteStride) throw new Error('Unsupported accessor in map fixture');
    const start = binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const data = Uint8Array.from(bytes.subarray(start, start + accessor.count * size * Type.BYTES_PER_ELEMENT));
    return new THREE.BufferAttribute(new Type(data.buffer), size, Boolean(accessor.normalized));
  }
  const meshes = [];
  function visit(id, parentMatrix) {
    const node = gltf.nodes[id];
    const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
    );
    const world = new THREE.Matrix4().multiplyMatrices(parentMatrix, local);
    for (const primitive of gltf.meshes?.[node.mesh]?.primitives ?? []) {
      const sourceMaterial = gltf.materials?.[primitive.material] ?? {};
      if (!include(sourceMaterial.name ?? '', node.name ?? '')) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', attribute(primitive.attributes.POSITION));
      if (primitive.attributes.NORMAL !== undefined) geometry.setAttribute('normal', attribute(primitive.attributes.NORMAL));
      if (primitive.attributes.TEXCOORD_0 !== undefined) geometry.setAttribute('uv', attribute(primitive.attributes.TEXCOORD_0));
      if (primitive.indices !== undefined) geometry.setIndex(attribute(primitive.indices));
      const material = new THREE.MeshBasicMaterial({ name: sourceMaterial.name, side: THREE.DoubleSide,
        alphaTest: sourceMaterial.alphaMode === 'MASK' ? sourceMaterial.alphaCutoff ?? 0.5 : 0,
        transparent: sourceMaterial.alphaMode === 'BLEND' });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = node.name ?? '';
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(world);
      mesh.matrixWorld.copy(world);
      meshes.push(mesh);
    }
    for (const child of node.children ?? []) visit(child, world);
  }
  for (const node of gltf.scenes[gltf.scene ?? 0].nodes) visit(node, new THREE.Matrix4());
  return meshes;
}
