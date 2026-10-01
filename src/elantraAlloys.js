import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Ten curved spokes in five pairs, with a recessed barrel and separate brakes.
// Dimensions retain the original wheel's tire diameter and contact patch.
export function addElantraAlloys(wheel) {
  const alloy = new THREE.MeshPhysicalMaterial({ name: 'Elantra machined alloy', color: 0xc6ccd1,
    metalness: 0.88, roughness: 0.25, clearcoat: 0.25, clearcoatRoughness: 0.2, envMapIntensity: 0.8 });
  const graphite = new THREE.MeshStandardMaterial({ name: 'Elantra recessed barrel', color: 0x343b42, metalness: 0.75, roughness: 0.38 });
  const brake = new THREE.MeshStandardMaterial({ name: 'Elantra brake rotor', color: 0x72787e, metalness: 0.8, roughness: 0.46 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x192027, roughness: 0.5, metalness: 0.35 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.216, 0.207, 0.19, 64, 1, true), graphite);
  barrel.name = 'alloy barrel'; barrel.rotation.z = Math.PI / 2; wheel.add(barrel);
  const shape = new THREE.Shape();
  shape.moveTo(-0.014, 0.049); shape.lineTo(0.008, 0.052);
  shape.quadraticCurveTo(0.027, 0.13, 0.032, 0.207);
  shape.lineTo(0.010, 0.216); shape.quadraticCurveTo(0.003, 0.13, -0.019, 0.065); shape.closePath();
  const spokeGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: true,
    bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 8, steps: 1 });
  spokeGeometry.rotateY(Math.PI / 2); spokeGeometry.translate(-0.009, 0, 0);
  const mirroredSpoke = spokeGeometry.clone();
  // Mirror by a proper rotation, preserving face winding and normals.
  mirroredSpoke.rotateY(Math.PI);
  for (const side of [-1, 1]) {
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.179, 0.179, 0.009, 64), brake);
    rotor.name = 'recessed brake disc'; rotor.rotation.z = Math.PI / 2; rotor.position.x = side * 0.068; wheel.add(rotor);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.216, 0.007, 10, 80), alloy);
    lip.name = 'machined rim lip'; lip.rotation.y = Math.PI / 2; lip.position.x = side * 0.112; wheel.add(lip);
    const innerLip = new THREE.Mesh(new THREE.TorusGeometry(0.204, 0.004, 8, 64), graphite);
    innerLip.rotation.y = Math.PI / 2; innerLip.position.x = side * 0.108; wheel.add(innerLip);
    for (let pair = 0; pair < 5; pair++) for (const branch of [-1, 1]) {
      const spoke = new THREE.Mesh(branch < 0 ? spokeGeometry : mirroredSpoke, alloy);
      spoke.name = `split spoke ${pair}-${branch}`;
      spoke.position.x = side * 0.109;
      spoke.rotation.x = pair * Math.PI * 2 / 5 + branch * 0.1;
      wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.057, 0.059, 0.021, 40), alloy);
    hub.rotation.z = Math.PI / 2; hub.position.x = side * 0.11; wheel.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.006, 32), graphite);
    cap.name = 'recessed centre cap'; cap.rotation.z = Math.PI / 2; cap.position.x = side * 0.124; wheel.add(cap);
    for (let bolt = 0; bolt < 5; bolt++) {
      const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 6), alloy);
      const angle = bolt * Math.PI * 2 / 5;
      lug.name = 'lug nut'; lug.rotation.z = Math.PI / 2;
      lug.position.set(side * 0.122, Math.cos(angle) * 0.044, Math.sin(angle) * 0.044); wheel.add(lug);
    }
    const capRing = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.0015, 6, 32), alloy);
    capRing.rotation.y = Math.PI / 2; capRing.position.x = side * 0.129; wheel.add(capRing);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.004, 0.014, 8), dark);
    valve.position.set(side * 0.112, -0.196, 0.065); valve.rotation.x = -0.3; wheel.add(valve);
  }
  wheel.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
  // All pieces share one rigid wheel transform. Merge by finish so the added
  // details do not turn each car/shadow/reflection pass into hundreds of draws.
  const finishes = new Map(), originals = new Set();
  for (const mesh of [...wheel.children]) {
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.deleteAttribute('uv'); geometry.clearGroups(); geometry.applyMatrix4(mesh.matrix);
    if (!finishes.has(mesh.material)) finishes.set(mesh.material, []);
    finishes.get(mesh.material).push(geometry); originals.add(mesh.geometry); wheel.remove(mesh);
  }
  for (const [material, pieces] of finishes) {
    const mesh = new THREE.Mesh(mergeGeometries(pieces), material);
    mesh.name = material.name || 'Elantra wheel detail'; mesh.castShadow = mesh.receiveShadow = true;
    wheel.add(mesh); for (const geometry of pieces) geometry.dispose();
  }
  for (const geometry of originals) geometry.dispose();
}

export function createElantraCaliper() {
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.079, 0.043),
    new THREE.MeshStandardMaterial({ color: 0x424a51, metalness: 0.65, roughness: 0.55 }));
  caliper.name = 'stationary brake caliper'; caliper.position.set(0, 0.08, 0.14);
  caliper.castShadow = caliper.receiveShadow = true;
  return caliper;
}
