import * as THREE from 'three';

const CELL_SIZE = 96;
const OCCLUDER_CELL = 128;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _view = new THREE.Vector3();

function triangleIndices(geometry, offset) {
  return geometry.index
    ? [geometry.index.getX(offset), geometry.index.getX(offset + 1), geometry.index.getX(offset + 2)]
    : [offset, offset + 1, offset + 2];
}

// Keep each triangle intact, including triangles crossing cell boundaries. Tight
// bounds include those overhangs; partitioning never changes the authored surface.
export function partitionMesh(mesh, cellSize = CELL_SIZE) {
  const source = mesh.geometry;
  if (mesh.isSkinnedMesh || source.morphAttributes.position || Array.isArray(mesh.material)) return [mesh];
  source.computeBoundingBox();
  const worldBounds = source.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  if (Math.max(worldBounds.max.x - worldBounds.min.x, worldBounds.max.y - worldBounds.min.y) <= cellSize) return [mesh];
  const position = source.getAttribute('position');
  const buckets = new Map();
  const end = Math.min(source.index?.count ?? position.count, source.drawRange.start + source.drawRange.count);
  for (let i = source.drawRange.start; i < end; i += 3) {
    const ids = triangleIndices(source, i);
    _a.fromBufferAttribute(position, ids[0]).applyMatrix4(mesh.matrixWorld);
    _b.fromBufferAttribute(position, ids[1]).applyMatrix4(mesh.matrixWorld);
    _c.fromBufferAttribute(position, ids[2]).applyMatrix4(mesh.matrixWorld);
    const key = `${Math.floor((_a.x + _b.x + _c.x) / (3 * cellSize))},${Math.floor((_a.y + _b.y + _c.y) / (3 * cellSize))}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(...ids);
  }
  if (buckets.size <= 1) return [mesh];
  const chunks = [];
  for (const [key, ids] of buckets) {
    const unique = [...new Set(ids)], remap = new Map(unique.map((id, i) => [id, i]));
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const Type = (attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array).constructor;
      const data = new Type(unique.length * attribute.itemSize);
      for (let i = 0; i < unique.length; i++) {
        for (let j = 0; j < attribute.itemSize; j++) {
          // Copy raw components, preserving normalized integer attributes as well.
          const offset = attribute.isInterleavedBufferAttribute
            ? unique[i] * attribute.data.stride + attribute.offset + j : unique[i] * attribute.itemSize + j;
          data[i * attribute.itemSize + j] = (attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array)[offset];
        }
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(data, attribute.itemSize, attribute.normalized));
    }
    geometry.setIndex(ids.map(id => remap.get(id)));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const chunk = new THREE.Mesh(geometry, mesh.material);
    chunk.name = `${mesh.name}:cell:${key}`;
    chunk.position.copy(mesh.position);
    chunk.quaternion.copy(mesh.quaternion);
    chunk.scale.copy(mesh.scale);
    chunk.matrix.copy(mesh.matrix);
    chunk.matrixWorld.copy(mesh.matrixWorld);
    chunk.matrixAutoUpdate = false;
    chunk.receiveShadow = mesh.receiveShadow;
    chunk.castShadow = mesh.castShadow;
    chunk.layers.mask = mesh.layers.mask;
    chunk.renderOrder = mesh.renderOrder;
    chunks.push(chunk);
  }
  return chunks;
}

// Use backface culling only for opaque solid surfaces with consistent authored
// winding. Thin fences, vegetation, flags and cutouts retain both sides.
export function canCullBackfaces(mesh) {
  const material = mesh.material, geometry = mesh.geometry;
  if (Array.isArray(material) || material.transparent || material.alphaTest > 0) return false;
  if (!/building|pitgarage|pavement|^road_(?:azer|offtrack)/i.test(material.name)) return false;
  if (/window|glass|tree|hedge|fence|banner|flag|board/i.test(material.name)) return false;
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  if (!normals) return false;
  const count = geometry.index?.count ?? positions.count;
  const normal = new THREE.Vector3(), average = new THREE.Vector3(), edge = new THREE.Vector3(), vertexNormal = new THREE.Vector3();
  let verified = 0;
  // Validate all triangles, not a sample that could miss a reversed section.
  for (let i = 0; i < count; i += 3) {
    const ids = triangleIndices(geometry, i);
    _a.fromBufferAttribute(positions, ids[0]); _b.fromBufferAttribute(positions, ids[1]); _c.fromBufferAttribute(positions, ids[2]);
    normal.subVectors(_b, _a).cross(edge.subVectors(_c, _a));
    if (normal.lengthSq() < 1e-12) continue;
    average.set(0, 0, 0);
    for (const id of ids) average.add(vertexNormal.fromBufferAttribute(normals, id));
    if (normal.normalize().dot(average.normalize()) < 0.25) return false;
    verified++;
  }
  return verified > 0;
}

// Only actual opaque facade triangles can occlude. Never approximate a building
// by its box: that would hide objects through windows, gates or missing walls.
export function extractOccluders(mesh) {
  const material = mesh.material;
  if (!mesh.visible || Array.isArray(material) || !material.visible || !material.depthWrite || !material.depthTest
    || material.transparent || material.alphaTest > 0 || material.opacity < 1
    || !/building|pitgarage|wall/i.test(material.name) || /window|glass|light|fence/i.test(material.name)) return [];
  const position = mesh.geometry.getAttribute('position');
  const count = mesh.geometry.index?.count ?? position.count;
  const result = [], normal = new THREE.Vector3(), edge = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    const ids = triangleIndices(mesh.geometry, i);
    _a.fromBufferAttribute(position, ids[0]).applyMatrix4(mesh.matrixWorld);
    _b.fromBufferAttribute(position, ids[1]).applyMatrix4(mesh.matrixWorld);
    _c.fromBufferAttribute(position, ids[2]).applyMatrix4(mesh.matrixWorld);
    normal.subVectors(_b, _a).cross(edge.subVectors(_c, _a));
    const area = normal.length() / 2;
    if (area < 18) continue;
    normal.normalize();
    if (Math.abs(normal.z) > 0.2) continue;
    // WebGL reverses front-face winding for mirrored objects. Match its effective
    // front side rather than treating the raw transformed cross product as front.
    if (mesh.matrixWorld.determinant() < 0) normal.negate();
    const vertices = [_a.clone(), _b.clone(), _c.clone()];
    const center = new THREE.Vector3().add(_a).add(_b).add(_c).multiplyScalar(1 / 3);
    result.push({ vertices, center, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal.clone(), _a), material });
  }
  return result;
}

function boxCorners(box) {
  return Array.from({ length: 8 }, (_, i) => new THREE.Vector3(
    i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
}

// Project only points entirely in front of the near plane. Uncertain cases stay
// visible. Exported for regression checks involving holes and quick camera turns.
export function projectOccluder(occluder, camera, viewProjection) {
  const eyeDistance = occluder.plane.distanceToPoint(camera.position);
  if (Math.abs(eyeDistance) < 0.05 || (occluder.material.side === THREE.FrontSide && eyeDistance <= 0)
    || (occluder.material.side === THREE.BackSide && eyeDistance >= 0)) return null;
  const points = occluder.points ??= occluder.vertices.map(() => new THREE.Vector3());
  for (let i = 0; i < points.length; i++) {
    if (_view.copy(occluder.vertices[i]).applyMatrix4(camera.matrixWorldInverse).z >= -camera.near - 0.02) return null;
    points[i].copy(occluder.vertices[i]).applyMatrix4(viewProjection);
  }
  const signedArea = points.reduce((area, p, i) => {
    const q = points[(i + 1) % points.length]; return area + p.x * q.y - q.x * p.y;
  }, 0);
  if (Math.abs(signedArea) < 0.002) return null;
  occluder.orientation = Math.sign(signedArea); occluder.eyeSign = Math.sign(eyeDistance); occluder.area = Math.abs(signedArea);
  occluder.minX = occluder.minY = Infinity; occluder.maxX = occluder.maxY = -Infinity;
  for (const point of points) {
    occluder.minX = Math.min(occluder.minX, point.x); occluder.maxX = Math.max(occluder.maxX, point.x);
    occluder.minY = Math.min(occluder.minY, point.y); occluder.maxY = Math.max(occluder.maxY, point.y);
  }
  if (occluder.maxX < -1 || occluder.minX > 1 || occluder.maxY < -1 || occluder.minY > 1) return null;
  return occluder;
}

export function boxIsOccluded(corners, projectedCorners, occluder) {
  for (let i = 0; i < corners.length; i++) {
    // All of the box must be behind the facade, with a numerical safety margin.
    if (occluder.plane.distanceToPoint(corners[i]) * occluder.eyeSign >= -0.08) return false;
    const point = projectedCorners[i];
    for (let j = 0; j < occluder.points.length; j++) {
      const a = occluder.points[j], b = occluder.points[(j + 1) % occluder.points.length];
      const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
      // Two NDC thousandths inside each edge prevents grazing-edge false hides.
      if (cross * occluder.orientation <= 0.002 * Math.hypot(b.x - a.x, b.y - a.y)) return false;
    }
  }
  return true;
}

export class WorldOptimization {
  constructor(camera, { occlusion = true } = {}) {
    this.camera = camera;
    this.occlusion = occlusion;
    this.entries = [];
    this.occluderCells = new Map();
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.projectedOccluders = [];
    this.stats = { meshes: 0, renderObjects: 0, batches: 0, triangles: 0, frustum: 0, occluded: 0, mainTriangles: 0, singleSided: 0, occluders: 0, milliseconds: 0 };
  }

  addOccluders(mesh) {
    for (const occluder of extractOccluders(mesh)) {
      const key = `${Math.floor(occluder.center.x / OCCLUDER_CELL)},${Math.floor(occluder.center.y / OCCLUDER_CELL)}`;
      if (!this.occluderCells.has(key)) this.occluderCells.set(key, []);
      this.occluderCells.get(key).push(occluder);
      this.stats.occluders++;
    }
  }

  addMesh(mesh, installCallbacks = true) {
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
    const entry = { mesh, bounds, corners: boxCorners(bounds), projected: boxCorners(bounds), skip: false, triangles };
    if (installCallbacks) {
      this.stats.renderObjects++;
      const range = { ...mesh.geometry.drawRange };
      const before = mesh.onBeforeRender, shadow = mesh.onBeforeShadow;
      mesh.onBeforeRender = (renderer, scene, camera, geometry, ...args) => {
        before.call(mesh, renderer, scene, camera, geometry, ...args);
        // Camera-specific rejection: hidden objects still exist for sun shadows
        // and reflection captures. Global visible=false would break both.
        geometry.setDrawRange(range.start, camera === this.camera && entry.skip ? 0 : range.count);
      };
      mesh.onBeforeShadow = (renderer, object, camera, shadowCamera, geometry, ...args) => {
        geometry.setDrawRange(range.start, range.count);
        shadow.call(mesh, renderer, object, camera, shadowCamera, geometry, ...args);
      };
    }
    this.entries.push(entry);
    this.stats.meshes++;
    this.stats.triangles += triangles;
    return entry;
  }

  addBatchedMesh(chunks) {
    const first = chunks[0];
    const vertices = chunks.reduce((sum, chunk) => sum + chunk.geometry.getAttribute('position').count, 0);
    const indices = chunks.reduce((sum, chunk) => sum + chunk.geometry.index.count, 0);
    const batch = new THREE.BatchedMesh(chunks.length, vertices, indices, first.material);
    batch.name = `${first.name}:batch`;
    batch.position.copy(first.position); batch.quaternion.copy(first.quaternion); batch.scale.copy(first.scale);
    batch.matrix.copy(first.matrix); batch.matrixWorld.copy(first.matrixWorld); batch.matrixAutoUpdate = false;
    batch.receiveShadow = first.receiveShadow; batch.castShadow = true;
    batch.layers.mask = first.layers.mask; batch.renderOrder = first.renderOrder;
    batch.sortObjects = false; // Opaque chunks need no per-view sorting allocation.
    const entries = chunks.map(chunk => {
      const id = batch.addInstance(batch.addGeometry(chunk.geometry));
      return { id, entry: this.addMesh(chunk, false) };
    });
    batch.computeBoundingBox(); batch.computeBoundingSphere();
    batch.onBeforeRender = (renderer, scene, camera, geometry, material) => {
      for (const { id, entry } of entries) batch.setVisibleAt(id, camera !== this.camera || !entry.skip);
      THREE.BatchedMesh.prototype.onBeforeRender.call(batch, renderer, scene, camera, geometry, material);
    };
    batch.onBeforeShadow = (renderer, object, camera, shadowCamera, geometry, depthMaterial) => {
      for (const { id, entry } of entries) batch.setVisibleAt(id, entry.mesh.castShadow);
      THREE.BatchedMesh.prototype.onBeforeRender.call(batch, renderer, null, shadowCamera, geometry, depthMaterial);
    };
    this.stats.renderObjects++; this.stats.batches++;
    return batch;
  }

  update() {
    const started = performance.now(), camera = this.camera;
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    const projected = this.projectedOccluders;
    projected.length = 0;
    if (this.occlusion) {
      const cx = Math.floor(camera.position.x / OCCLUDER_CELL), cy = Math.floor(camera.position.y / OCCLUDER_CELL);
      for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) {
        for (const occluder of this.occluderCells.get(`${x},${y}`) ?? []) {
          if (occluder.center.distanceToSquared(camera.position) > 260 ** 2) continue;
          const face = projectOccluder(occluder, camera, this.viewProjection);
          if (face) projected.push(face);
        }
      }
      projected.sort((a, b) => b.area - a.area);
      projected.length = Math.min(projected.length, 48);
    }
    this.stats.frustum = this.stats.occluded = this.stats.mainTriangles = 0;
    for (const entry of this.entries) {
      entry.skip = !this.frustum.intersectsBox(entry.bounds);
      if (entry.skip) { this.stats.frustum++; continue; }
      if (projected.length && !entry.bounds.containsPoint(camera.position)) {
        let safe = true;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const view = camera.matrixWorldInverse.elements;
        for (let i = 0; i < 8; i++) {
          const corner = entry.corners[i];
          if (view[2] * corner.x + view[6] * corner.y + view[10] * corner.z + view[14] >= -camera.near - 0.02) { safe = false; break; }
          const point = entry.projected[i].copy(corner).applyMatrix4(this.viewProjection);
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        }
        if (safe) for (const face of projected) {
          if (minX > face.minX && maxX < face.maxX && minY > face.minY && maxY < face.maxY
            && boxIsOccluded(entry.corners, entry.projected, face)) { entry.skip = true; break; }
        }
        if (entry.skip) this.stats.occluded++;
      }
      if (!entry.skip) this.stats.mainTriangles += entry.triangles;
    }
    this.stats.milliseconds = performance.now() - started;
  }
}

export function freezeStaticWorld(root) {
  root.updateMatrixWorld(true);
  root.traverse(object => { object.matrixAutoUpdate = false; object.matrixWorldAutoUpdate = false; });
}
