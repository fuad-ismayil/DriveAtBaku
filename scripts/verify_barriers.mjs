import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { BarrierCollision } from '../src/barrierCollision.js';
import { createDynamicsState, stepDynamics } from '../src/vehicleDynamics.js';
import { VEHICLES } from '../src/vehicleCatalog.js';
import { isTrackBoundaryMaterial, createShadowCandidate, updateShadowCandidates } from '../src/trackBoundaries.js';
import { readMapGeometry } from './lib/readMapGeometry.mjs';

function wall(x, yMin = -100, yMax = 100, zMin = 0, zMax = 3) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    x, yMin, zMin, x, yMax, zMin, x, yMax, zMax,
    x, yMin, zMin, x, yMax, zMax, x, yMin, zMax,
  ], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ name: 'FENCE_CONCRETE_F_01-material', side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  return mesh;
}
function run(collider, from, to, vehicle = VEHICLES.ferrari, heading = 0, endHeading = heading) {
  const state = createDynamicsState(heading, vehicle, new THREE.Vector3(...from));
  const position = state.position.clone(), quaternion = state.quaternion.clone();
  state.position.copy(new THREE.Vector3(...to)).add(new THREE.Vector3(0, 0, state.comHeight));
  state.velocity.subVectors(state.position, position).multiplyScalar(120);
  state.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), endHeading);
  const hit = collider.resolve(state, position, quaternion, vehicle);
  return { state, hit };
}

for (const vehicle of Object.values(VEHICLES)) {
  const collider = new BarrierCollision();
  collider.addMesh(wall(3));
  const side = run(collider, [0, 0, 0], [10, 0, 0], vehicle);
  assert.ok(side.hit && side.state.position.x <= 3 - vehicle.dims.width / 2, `${vehicle.id}: stop full side before wall`);
  const fast = run(collider, [0, 0, 0], [250, 0, 0], vehicle);
  assert.ok(fast.hit && fast.state.position.x < 3, `${vehicle.id}: cannot tunnel through thin wall`);
  const diagonal = run(collider, [0, 0, 0], [8, 7, 0], vehicle, Math.PI / 4);
  const halfX = (vehicle.dims.width + vehicle.dims.length) / (2 * Math.sqrt(2));
  assert.ok(diagonal.hit && diagonal.state.position.x <= 3 - halfX, 'rotated corners stay outside');
  assert.ok(diagonal.state.position.y > 6.5 && diagonal.state.velocity.y > 100, 'retain motion along wall');
  const away = run(collider, [3 - vehicle.dims.width / 2 - 0.027, 0, 0], [0, 5, 0], vehicle);
  assert.equal(away.hit, false, 'can reverse away from contact');
  const embedded = run(collider, [2.5, 0, 0], [2.5, 0, 0], vehicle);
  assert.ok(embedded.hit && embedded.state.position.x <= 3 - vehicle.dims.width / 2, 'recover stationary penetration');
  const spin = run(collider, [1.8, 0, 0], [1.8, 0, 0], vehicle, 0, Math.PI / 2);
  const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(spin.state.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(spin.state.quaternion);
  const rotatedExtent = Math.abs(right.x) * vehicle.dims.width / 2 + Math.abs(forward.x) * vehicle.dims.length / 2;
  assert.ok(spin.hit && spin.state.position.x + rotatedExtent <= 3, 'rotation cannot swing a corner through wall');
}

const reverseWorld = new BarrierCollision();
const transformed = wall(0);
transformed.rotation.z = Math.PI / 2;
transformed.position.y = -3;
transformed.scale.set(1.2, 0.8, 1.1);
transformed.updateMatrixWorld(true);
reverseWorld.addMesh(transformed);
const reverse = run(reverseWorld, [0, 0, 0], [0, -10, 0]);
assert.ok(reverse.hit && reverse.state.position.y > -1, 'transformed wall stops rear bumper');

const openingWorld = new BarrierCollision();
openingWorld.addMesh(wall(3, -100, -3));
openingWorld.addMesh(wall(3, 3, 100));
assert.equal(run(openingWorld, [0, 0, 0], [10, 0, 0]).hit, false, 'actual opening remains passable');
assert.equal(run(openingWorld, [0, 10, 0], [10, 10, 0]).hit, true, 'wall beside opening remains solid');
const lowWorld = new BarrierCollision();
lowWorld.addMesh(wall(3, -100, 100, 0, 0.1));
assert.equal(run(lowWorld, [0, 0, 0], [10, 0, 0]).hit, false, 'low curb is handled by wheel/road contact');

const barriers = readMapGeometry('baku', isTrackBoundaryMaterial);
const source = readMapGeometry('collision');
const mapCollider = new BarrierCollision();
for (const mesh of [...barriers, ...source]) { mapCollider.addMesh(mesh); mesh.raycast = acceleratedRaycast; }
const candidates = barriers.map(createShadowCandidate);
assert.ok(candidates.every(Boolean), 'all real fence/barrier batches are eligible for shadows');
const route = JSON.parse(readFileSync(new URL('../public/generated/route.json', import.meta.url)));
updateShadowCandidates(candidates, new THREE.Vector3(...route.spawn));
assert.ok(candidates.some(({ mesh }) => /fence/i.test(mesh.material.name) && mesh.castShadow), 'real safety fences cast shadows near spawn');
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const triangle = new THREE.Triangle(a, b, c), normal = new THREE.Vector3(), point = new THREE.Vector3();
let missingSections = 0, verifiedSections = 0;
for (const mesh of barriers) {
  if (!/concrete|barrier|twall|cmwla?_rolex(?:-|$)/i.test(mesh.material.name)) continue;
  const geometry = mesh.geometry, positions = geometry.getAttribute('position'), index = geometry.index;
  const count = index?.count ?? positions.count;
  for (let i = 0; i < count; i += 3 * Math.max(1, Math.floor(count / 900))) {
    a.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
    triangle.getNormal(normal);
    if (Math.abs(normal.z) > 0.05 || normal.lengthSq() < 0.5) continue;
    triangle.getMidpoint(point);
    ray.set(point.clone().add(new THREE.Vector3(0, 0, 3)), new THREE.Vector3(0, 0, -1));
    ray.far = 8;
    const groundHits = ray.intersectObjects(source, false).filter(hit => Math.abs(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).z) > 0.8);
    const roadZ = groundHits[0]?.point.z;
    if (roadZ === undefined || point.z - roadZ < 0.2 || point.z - roadZ > 1.3) continue;
    ray.set(point.clone().addScaledVector(normal, 0.45), normal.clone().negate());
    ray.far = 0.9;
    const covered = ray.intersectObjects(source, false).some(hit => Math.abs(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).z) < 0.65);
    if (covered) continue;
    missingSections++;
    if (verifiedSections >= 12) continue;
    const position = point.clone().addScaledVector(normal, 4); position.z = roadZ;
    const target = point.clone().addScaledVector(normal, -4); target.z = roadZ;
    const heading = Math.atan2(-normal.x, normal.y);
    const initialState = createDynamicsState(heading, VEHICLES.ferrari, position);
    const initialOverlap = mapCollider.sweep(initialState.position, initialState.quaternion, new THREE.Vector3(), VEHICLES.ferrari, initialState.comHeight);
    if (initialOverlap && initialOverlap.depth > 0.05) continue; // Only approach from a clear, car-sized starting space.
    const result = run(mapCollider, position.toArray(), target.toArray(), VEHICLES.ferrari, heading);
    assert.ok(result.hit, `${mesh.material.name}: supplemental collider fills source gap`);
    assert.ok(result.state.position.clone().sub(point).dot(normal) > 0, 'car remains on starting side of missing barrier');
    verifiedSections++;
  }
}
assert.ok(verifiedSections >= 3, 'exercise actual missing source collision sections');
function sampleGround(origin, direction, distance) {
  ray.set(origin, direction); ray.far = distance;
  const hit = ray.intersectObjects(source, false)[0];
  return hit ? { distance: hit.distance, point: hit.point,
    normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld), mu: 1, rr: 0.013 } : null;
}
for (const vehicle of Object.values(VEHICLES)) {
  const spawn = new THREE.Vector3(...route.spawn);
  const ground = sampleGround(spawn.clone().add(new THREE.Vector3(0, 0, 6)), new THREE.Vector3(0, 0, -1), 16);
  spawn.z = ground.point.z;
  const state = createDynamicsState(route.heading, vehicle, spawn);
  let contacts = 0;
  for (let step = 0; step < 120 * 8; step++) {
    const previous = state.position.clone(), orientation = state.quaternion.clone();
    stepDynamics(state, { throttle: 1, brake: 0, steer: step < 240 ? 0 : 0.8 }, 1 / 120, vehicle, sampleGround);
    if (mapCollider.resolve(state, previous, orientation, vehicle)) contacts++;
    assert.ok(Number.isFinite(state.position.length()) && Number.isFinite(state.velocity.length()), 'physics remains finite at wall contact');
    if (step === 239) assert.ok(state.position.distanceTo(spawn) > 2, `${vehicle.id}: car can drive away from spawn`);
  }
  assert.ok(contacts > 0, `${vehicle.id}: actual driving reaches and collides with trackside wall`);
}
console.log(`Barriers: side/corner/reverse/speed/sliding/spin/opening/transform and real driving checks passed for both cars. ${barriers.length} real boundary batches; ${missingSections} uncovered samples found, ${verifiedSections} verified; nearby safety fences cast shadows.`);
