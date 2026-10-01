import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchAssetBytes } from './assetTransfer.js';

// The supplied complete wheel has an X-axis axle and nested export transforms.
// Bake those transforms once, then share the four finished primitives per car.
export function prepareElantraWheel(source) {
  source.updateMatrixWorld(true);
  const wheel = new THREE.Group(); wheel.name = 'Elantra supplied wheel';
  source.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const material = object.material.clone();
    const silver = /C0C0C0/i.test(material.name), inset = /1E1E1E/i.test(material.name);
    material.color.setHex(silver ? 0xbfc5cc : inset ? 0x343942 : 0x171a1d);
    material.metalness = silver ? .84 : inset ? .32 : 0;
    material.roughness = silver ? .28 : inset ? .45 : .94;
    material.envMapIntensity = silver ? .7 : inset ? .35 : .12;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true; wheel.add(mesh);
  });
  const bounds = new THREE.Box3().setFromObject(wheel), size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  // A visual fit adjustment only; the vehicle's rolling radius and handling stay unchanged.
  const scale = (.68 * .95) / Math.max(size.y, size.z);
  for (const mesh of wheel.children) {
    mesh.geometry.translate(-center.x, -center.y, -center.z).scale(scale, scale, scale);
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  }
  return wheel;
}

export async function loadElantraWheel(onProgress) {
  const url = '/assets/vehicles/elantra-wheel.glb';
  const bytes = await fetchAssetBytes(url, event => onProgress?.(url, event));
  const asset = await new GLTFLoader().parseAsync(bytes.buffer, '/assets/vehicles/');
  const wheel = prepareElantraWheel(asset.scene);
  asset.scene.traverse(mesh => { if (mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); } });
  return wheel;
}
