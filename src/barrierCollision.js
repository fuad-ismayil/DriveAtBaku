import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const SKIN = 0.025;

// Continuous separating-axis test: a translating oriented car box against a triangle.
// Intersect the time intervals for the 3 box axes, face normal, and 9 edge cross axes.
function sweepTriangle(triangle, center, half, axes, travel, scratch, margin) {
  const { normal, edges, testAxes, response } = scratch;
  triangle.getNormal(normal);
  if (Math.abs(normal.z) >= 0.65 || normal.lengthSq() < 0.5) return null;
  edges[0].subVectors(triangle.b, triangle.a);
  edges[1].subVectors(triangle.c, triangle.b);
  edges[2].subVectors(triangle.a, triangle.c);
  for (let i = 0; i < 3; i++) testAxes[i].copy(axes[i]);
  testAxes[3].copy(normal);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) testAxes[4 + i * 3 + j].crossVectors(axes[i], edges[j]);
  let enter = -Infinity, exit = Infinity;
  for (const axis of testAxes) {
    if (axis.lengthSq() < 1e-12) continue;
    axis.normalize();
    const a = triangle.a.dot(axis), b = triangle.b.dot(axis), c = triangle.c.dot(axis);
    const low = Math.min(a, b, c), high = Math.max(a, b, c);
    const radius = Math.abs(axis.dot(axes[0])) * half.x + Math.abs(axis.dot(axes[1])) * half.y + Math.abs(axis.dot(axes[2])) * half.z;
    const projection = center.dot(axis), speed = travel.dot(axis);
    if (Math.abs(speed) < 1e-10) {
      if (projection + radius < low || projection - radius > high) return null;
    } else {
      const t1 = (low - projection - radius) / speed;
      const t2 = (high - projection + radius) / speed;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) return null;
    }
  }
  if (exit < 0 || enter > 1) return null;
  const signedDistance = scratch.offset.subVectors(center, triangle.a).dot(normal);
  response.copy(normal);
  if (signedDistance < 0 || (Math.abs(signedDistance) < 1e-8 && response.dot(travel) > 0)) response.negate();
  const radius = Math.abs(normal.dot(axes[0])) * half.x + Math.abs(normal.dot(axes[1])) * half.y + Math.abs(normal.dot(axes[2])) * half.z;
  const planarLength = Math.hypot(response.x, response.y);
  // Sloping rail faces must stop the car sideways, not lift its body over a wall.
  // Road-height and vertical forces remain the suspension system's responsibility.
  response.z = 0;
  response.multiplyScalar(1 / planarLength);
  const depth = Math.max(0, radius - Math.abs(signedDistance)) / planarLength;
  const time = Math.max(0, enter);
  // Resting contact must permit sliding and reversing away from the wall.
  if (time === 0 && response.dot(travel) >= -1e-9 && depth <= SKIN * 2 && margin === 0) return null;
  return { time, depth: time === 0 ? depth : 0, normal: response };
}

export class BarrierCollision {
  constructor() {
    this.colliders = [];
    this.triangle = new THREE.Triangle();
    this.localQuery = new THREE.Box3();
    this.worldQuery = new THREE.Box3();
    this.axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.center = new THREE.Vector3();
    this.worldHalf = new THREE.Vector3();
    this.half = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.scratch = {
      normal: new THREE.Vector3(), response: new THREE.Vector3(), offset: new THREE.Vector3(),
      edges: Array.from({ length: 3 }, () => new THREE.Vector3()),
      testAxes: Array.from({ length: 13 }, () => new THREE.Vector3()),
    };
    this.hitNormal = new THREE.Vector3();
  }

  addMesh(mesh) {
    if (!mesh.geometry.boundsTree) mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { targetLeafSize: 20, indirect: true });
    mesh.geometry.computeBoundingBox();
    this.colliders.push({
      mesh,
      matrix: mesh.matrixWorld.clone(),
      inverse: mesh.matrixWorld.clone().invert(),
      bounds: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld),
    });
  }

  sweep(position, quaternion, travel, settings, comHeight, angularMargin = 0) {
    const { width, length, height } = settings.dims;
    const bottom = 0.16, top = height;
    this.half.set(width / 2 + SKIN + angularMargin, length / 2 + SKIN + angularMargin, (top - bottom) / 2 + angularMargin);
    this.offset.set(0, 0, (top + bottom) / 2 - comHeight).applyQuaternion(quaternion);
    this.center.copy(position).add(this.offset);
    this.axes[0].set(1, 0, 0).applyQuaternion(quaternion);
    this.axes[1].set(0, 1, 0).applyQuaternion(quaternion);
    this.axes[2].set(0, 0, 1).applyQuaternion(quaternion);
    for (const component of ['x', 'y', 'z']) this.worldHalf[component] =
      Math.abs(this.axes[0][component]) * this.half.x + Math.abs(this.axes[1][component]) * this.half.y + Math.abs(this.axes[2][component]) * this.half.z;
    this.worldQuery.min.copy(this.center).sub(this.worldHalf);
    this.worldQuery.max.copy(this.center).add(this.worldHalf);
    for (const component of ['x', 'y', 'z']) {
      this.worldQuery.min[component] += Math.min(0, travel[component]);
      this.worldQuery.max[component] += Math.max(0, travel[component]);
    }
    let bestTime = Infinity, bestDepth = 0;
    for (const collider of this.colliders) {
      if (!collider.bounds.intersectsBox(this.worldQuery)) continue;
      this.localQuery.copy(this.worldQuery).applyMatrix4(collider.inverse);
      collider.mesh.geometry.boundsTree.shapecast({
        intersectsBounds: bounds => bounds.intersectsBox(this.localQuery),
        intersectsTriangle: triangle => {
          this.triangle.copy(triangle);
          this.triangle.a.applyMatrix4(collider.matrix);
          this.triangle.b.applyMatrix4(collider.matrix);
          this.triangle.c.applyMatrix4(collider.matrix);
          const hit = sweepTriangle(this.triangle, this.center, this.half, this.axes, travel, this.scratch, angularMargin);
          if (hit && (hit.time < bestTime || (hit.time === bestTime && hit.depth > bestDepth))) {
            bestTime = hit.time;
            bestDepth = hit.depth;
            this.hitNormal.copy(hit.normal);
          }
          return false;
        },
      });
    }
    return bestTime === Infinity ? null : { time: bestTime, depth: bestDepth, normal: this.hitNormal.clone() };
  }

  resolve(state, previousPosition, previousQuaternion, settings) {
    const start = previousPosition.clone(), target = state.position.clone();
    const rotation = state.quaternion.clone(), orientation = previousQuaternion.clone();
    const radius = Math.hypot(settings.dims.width, settings.dims.length, settings.dims.height) / 2;
    // Bound rotational motion by expanding the swept box; subdivisions keep the
    // extra clearance below 4 cm even when the car spins beside a fence.
    const angle = orientation.angleTo(rotation);
    const steps = Math.max(1, Math.ceil(angle * radius / 0.04));
    const totalTravel = target.clone().sub(start);
    const stepTravel = totalTravel.clone().multiplyScalar(1 / steps);
    const nextOrientation = new THREE.Quaternion();
    let collided = false, rotationBlocked = false;
    for (let step = 0; step < steps; step++) {
      nextOrientation.slerpQuaternions(previousQuaternion, rotation, (step + 1) / steps);
      const margin = rotationBlocked ? 0 : orientation.angleTo(nextOrientation) * radius;
      const remaining = stepTravel.clone();
      for (let iteration = 0; iteration < 4; iteration++) {
        const hit = this.sweep(start, orientation, remaining, settings, state.comHeight, iteration === 0 ? margin : 0);
        if (!hit) { start.add(remaining); break; }
        collided = true;
        rotationBlocked = true;
        const advance = Math.max(0, hit.time - 0.002 / Math.max(remaining.length(), 0.002));
        start.addScaledVector(remaining, advance);
        if (hit.depth > margin + SKIN) start.addScaledVector(hit.normal, hit.depth + 0.002);
        remaining.multiplyScalar(1 - advance);
        const inwardTravel = remaining.dot(hit.normal);
        if (inwardTravel < 0) remaining.addScaledVector(hit.normal, -inwardTravel);
        const inwardVelocity = state.velocity.dot(hit.normal);
        if (inwardVelocity < 0) state.velocity.addScaledVector(hit.normal, -inwardVelocity * (Math.abs(inwardVelocity) > 2 ? 1.08 : 1));
        // Don't keep rotating the body through a wall after a side/corner hit.
        state.angularVelocity.multiplyScalar(0.3);
        if (remaining.lengthSq() < 1e-10 && hit.depth <= margin + SKIN) break;
      }
      if (!rotationBlocked) orientation.copy(nextOrientation);
    }
    state.position.copy(start);
    state.quaternion.copy(orientation);
    if (collided) {
      const forward = this.axes[1].set(0, 1, 0).applyQuaternion(orientation);
      const right = this.axes[0].set(1, 0, 0).applyQuaternion(orientation);
      state.heading = Math.atan2(-forward.x, forward.y);
      state.yawRate = state.angularVelocity.z;
      state.longitudinalSpeed = state.velocity.dot(forward);
      state.lateralSpeed = state.velocity.dot(right);
    }
    return collided;
  }
}
