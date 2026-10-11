import * as THREE from 'three';
import { SpatialIndex } from './spatialIndex.js';
import { DISTANCE_SETTINGS, normalizeDistance, isDistanceProp, createDistanceUniforms, applyDistanceFade, boundsDistanceSquared } from './renderDistance.js';

const CELL_SIZE = 96;
const OCCLUDER_CELL = 128;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _view = new THREE.Vector3();

export function useStaticBatchMatrices(material) {
  if (material.userData.staticBatchMatrices) return;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    // Every instance in a partitioned world batch is identity. Keep Three's
    // multi-draw path, but let the compiler eliminate its five texture fetches
    // and matrix/normal transformations per vertex. Ordinary meshes are unchanged.
    shader.vertexShader = shader.vertexShader.replace('#include <batching_vertex>',
      '#ifdef USE_BATCHING\nmat4 batchingMatrix = mat4(1.0);\n#endif');
  };
  material.customProgramCacheKey = () => `${key}:static-batch-matrices-v1`;
  material.userData.staticBatchMatrices = true;
  material.needsUpdate = true;
}

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
    result.push({ vertices, center, bounds: new THREE.Box3().setFromPoints(vertices),
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal.clone(), _a), material });
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
  let signedArea = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    signedArea += p.x * q.y - q.x * p.y;
  }
  if (Math.abs(signedArea) < 0.002) return null;
  occluder.orientation = Math.sign(signedArea); occluder.eyeSign = Math.sign(eyeDistance); occluder.area = Math.abs(signedArea);
  occluder.minX = occluder.minY = Infinity; occluder.maxX = occluder.maxY = -Infinity;
  for (const point of points) {
    occluder.minX = Math.min(occluder.minX, point.x); occluder.maxX = Math.max(occluder.maxX, point.x);
    occluder.minY = Math.min(occluder.minY, point.y); occluder.maxY = Math.max(occluder.maxY, point.y);
  }
  if (occluder.maxX < -1 || occluder.minX > 1 || occluder.maxY < -1 || occluder.minY > 1) return null;
  occluder.edgeMargins ??= new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    occluder.edgeMargins[i] = 0.002 * Math.hypot(b.x - a.x, b.y - a.y);
  }
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
      if (cross * occluder.orientation <= occluder.edgeMargins[j]) return false;
    }
  }
  return true;
}

export class WorldOptimization {
  constructor(camera, { occlusion = true } = {}) {
    this.camera = camera;
    this.occlusion = occlusion;
    this.hierarchicalFrustum = true;
    this.entries = [];
    this.occluderCells = new Map();
    this.occluders = [];
    this.occluderIndex = null;
    this.occluderQuery = new THREE.Box3();
    this.occluderCandidates = [];
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.previousViewProjection = new THREE.Matrix4();
    this.cullDirty = true;
    this.previousOcclusion = null;
    this.projectedOccluders = [];
    this.index = null;
    this.candidates = [];
    this.distances = { renderDistance: DISTANCE_SETTINGS.renderDistance.default, propsDistance: DISTANCE_SETTINGS.propsDistance.default };
    this.currentDistances = { ...this.distances };
    this.distanceUniforms = createDistanceUniforms();
    this.intersectsView = bounds => this.frustum.intersectsBox(bounds);
    this.intersectsOccluderQuery = bounds => bounds.intersectsBox(this.occluderQuery) && this.frustum.intersectsBox(bounds);
    this.otherViews = new WeakMap();
    this.stats = { meshes: 0, renderObjects: 0, batches: 0, triangles: 0, frustum: 0, distance: 0, props: 0, occluded: 0, mainTriangles: 0, singleSided: 0, occluders: 0, milliseconds: 0, releasedCPUBytes: 0, skippedSubmissions: 0 };
  }

  setDistances(values) {
    for (const name of Object.keys(DISTANCE_SETTINGS)) {
      if (Object.hasOwn(values, name)) this.distances[name] = normalizeDistance(values[name], name);
    }
    this.cullDirty = true;
    return { ...this.distances };
  }

  installSubmissionFilter(renderer) {
    const original = renderer.renderBufferDirect, world = this;
    // r180 sets up programs/buffers even for a zero-length draw. Reject world
    // submissions after their camera-specific callbacks, before that GPU work.
    // Public renderer hook; no visibility mutation or changes to player meshes.
    const filtered = function(camera, scene, geometry, material, object, group) {
      if (object.userData.worldOptimization === world
        && ((camera === world.camera && object.userData.worldEntry?.skip)
          || (object.isBatchedMesh && object._multiDrawCount === 0))) {
        world.stats.skippedSubmissions++;
        return;
      }
      return original.call(this, camera, scene, geometry, material, object, group);
    };
    renderer.renderBufferDirect = filtered;
    return () => { if (renderer.renderBufferDirect === filtered) renderer.renderBufferDirect = original; };
  }

  installDistanceFog(scene) {
    const before = scene.onBeforeRender, after = scene.onAfterRender, snapshots = [];
    const world = this;
    scene.onBeforeRender = function(renderer, renderedScene, camera, ...args) {
      before.call(this, renderer, renderedScene, camera, ...args);
      const fog = scene.fog;
      let weatherDensity = fog?.density;
      for (const snapshot of snapshots) if (snapshot?.fog === fog) { weatherDensity = snapshot.density; break; }
      snapshots.push(fog?.isFogExp2 ? { fog, density: fog.density } : null);
      if (camera === world.camera && fog?.isFogExp2) {
        // Near-invisible at the cutoff, using Three's existing exponential fog.
        // Preserve stronger weather fog and the original full-distance view.
        const density = Math.max(weatherDensity, 2.8 / world.currentDistances.renderDistance);
        fog.density = THREE.MathUtils.lerp(weatherDensity, density, world.distanceUniforms.worldDistanceStrength.value);
      } else if (fog?.isFogExp2) fog.density = weatherDensity;
    };
    scene.onAfterRender = function(renderer, renderedScene, camera, ...args) {
      const snapshot = snapshots.pop();
      if (snapshot) snapshot.fog.density = snapshot.density;
      after.call(this, renderer, renderedScene, camera, ...args);
    };
    return () => { scene.onBeforeRender = before; scene.onAfterRender = after; };
  }

  addOccluders(mesh) {
    for (const occluder of extractOccluders(mesh)) {
      const key = `${Math.floor(occluder.center.x / OCCLUDER_CELL)},${Math.floor(occluder.center.y / OCCLUDER_CELL)}`;
      if (!this.occluderCells.has(key)) this.occluderCells.set(key, []);
      this.occluderCells.get(key).push(occluder);
      this.occluders.push(occluder);
      this.occluderIndex = null;
      this.cullDirty = true;
      this.stats.occluders++;
    }
  }

  addMesh(mesh, installCallbacks = true) {
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
    const props = isDistanceProp(mesh);
    const entry = { mesh, bounds, corners: boxCorners(bounds), projected: boxCorners(bounds), skip: false, triangles, props };
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) applyDistanceFade(material, this.camera, this.distanceUniforms, props);
    if (installCallbacks) {
      mesh.userData.worldOptimization = this;
      mesh.userData.worldEntry = entry;
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
    this.index = null;
    this.cullDirty = true;
    this.stats.meshes++;
    this.stats.triangles += triangles;
    return entry;
  }

  addBatchedMesh(chunks) {
    const first = chunks[0];
    const vertices = chunks.reduce((sum, chunk) => sum + chunk.geometry.getAttribute('position').count, 0);
    const indices = chunks.reduce((sum, chunk) => sum + chunk.geometry.index.count, 0);
    const batch = new THREE.BatchedMesh(chunks.length, vertices, indices, first.material);
    batch.userData.worldOptimization = this;
    batch.name = `${first.name}:batch`;
    batch.position.copy(first.position); batch.quaternion.copy(first.quaternion); batch.scale.copy(first.scale);
    batch.matrix.copy(first.matrix); batch.matrixWorld.copy(first.matrixWorld); batch.matrixAutoUpdate = false;
    batch.receiveShadow = first.receiveShadow; batch.castShadow = true;
    // Three otherwise shares one depth material between ordinary and batched
    // meshes, repeatedly rebuilding program parameters as batching toggles.
    batch.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    useStaticBatchMatrices(batch.material);
    useStaticBatchMatrices(batch.customDepthMaterial);
    batch.geometry.addEventListener('dispose', () => batch.customDepthMaterial.dispose());
    batch.layers.mask = first.layers.mask; batch.renderOrder = first.renderOrder;
    batch.sortObjects = false; // Opaque chunks need no per-view sorting allocation.
    const entries = chunks.map(chunk => {
      chunk.userData.shadowBatch = batch;
      const id = batch.addInstance(batch.addGeometry(chunk.geometry));
      return { id, entry: this.addMesh(chunk, false) };
    });
    batch.computeBoundingBox(); batch.computeBoundingSphere();
    let drawCamera = null;
    batch.onBeforeRender = (renderer, scene, camera, geometry, material) => {
      const frustum = camera === this.camera ? null : this.getViewFrustum(camera, renderer);
      for (const { id, entry } of entries) batch.setVisibleAt(id,
        frustum ? frustum.intersectsBox(entry.bounds) : !entry.skip);
      // Exact world-space boxes replace Three's repeated matrix/sphere work.
      batch.perObjectFrustumCulled = false;
      // Matching visibility flags do not imply matching draw lists: a preceding
      // shadow/probe view may have frustum-culled additional instances.
      if (drawCamera !== camera) batch._visibilityChanged = true;
      THREE.BatchedMesh.prototype.onBeforeRender.call(batch, renderer, scene, camera, geometry, material);
      drawCamera = camera;
    };
    batch.onBeforeShadow = (renderer, object, camera, shadowCamera, geometry, depthMaterial) => {
      const frustum = this.getViewFrustum(shadowCamera, renderer);
      for (const { id, entry } of entries) batch.setVisibleAt(id, entry.mesh.castShadow && frustum.intersectsBox(entry.bounds));
      batch.perObjectFrustumCulled = false;
      THREE.BatchedMesh.prototype.onBeforeRender.call(batch, renderer, null, shadowCamera, geometry, depthMaterial);
      drawCamera = shadowCamera;
    };
    this.stats.renderObjects++; this.stats.batches++;
    return batch;
  }

  getViewFrustum(camera, renderer) {
    let view = this.otherViews.get(camera);
    if (!view) {
      view = { matrix: new THREE.Matrix4(), frustum: new THREE.Frustum(), frame: -1 };
      this.otherViews.set(camera, view);
    }
    const frame = renderer?.info?.render.frame;
    if (frame === undefined || view.frame !== frame) {
      view.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      view.frustum.setFromProjectionMatrix(view.matrix, camera.coordinateSystem, camera.reversedDepth);
      view.frame = frame;
    }
    return view.frustum;
  }

  releaseBatchedSources(chunks) {
    // BatchedMesh owns copies of the attributes and indices. Detached source
    // chunks survive only as culling/shadow metadata; their staging arrays do not.
    for (const chunk of chunks) {
      if (!chunk.userData.shadowBatch) continue;
      const geometry = chunk.geometry, arrays = new Set();
      for (const attribute of Object.values(geometry.attributes)) arrays.add(attribute.data?.array ?? attribute.array);
      if (geometry.index) arrays.add(geometry.index.array);
      for (const array of arrays) this.stats.releasedCPUBytes += array.byteLength;
      geometry.dispose();
      for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
      geometry.setIndex(null);
    }
  }

  update(dt = 0) {
    const started = performance.now(), camera = this.camera;
    this.stats.skippedSubmissions = 0;
    // Ease live slider edits. A no-dt update (loading/tests) applies immediately.
    for (const name of Object.keys(DISTANCE_SETTINGS)) {
      const previous = this.currentDistances[name], target = this.distances[name];
      const next = dt > 0 && Math.abs(previous - target) > 0.25
        ? THREE.MathUtils.lerp(previous, target, 1 - Math.exp(-dt * 14)) : target;
      if (next !== previous) this.cullDirty = true;
      this.currentDistances[name] = next;
    }
    this.distanceUniforms.worldDistanceLimit.value = this.currentDistances.renderDistance;
    this.distanceUniforms.worldDistanceStrength.value = THREE.MathUtils.clamp(
      (DISTANCE_SETTINGS.renderDistance.max - this.currentDistances.renderDistance) / DISTANCE_SETTINGS.renderDistance.step, 0, 1);
    this.distanceUniforms.propsDistanceLimit.value = this.currentDistances.propsDistance;
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.cullDirty && this.previousOcclusion === this.occlusion && this.previousViewProjection.equals(this.viewProjection)) {
      this.stats.milliseconds = performance.now() - started;
      return;
    }
    this.previousViewProjection.copy(this.viewProjection);
    this.previousOcclusion = this.occlusion; this.cullDirty = false;
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    const projected = this.projectedOccluders;
    projected.length = 0;
    if (this.occlusion) {
      const cx = Math.floor(camera.position.x / OCCLUDER_CELL), cy = Math.floor(camera.position.y / OCCLUDER_CELL);
      this.occluderQuery.min.copy(camera.position).addScalar(-260);
      this.occluderQuery.max.copy(camera.position).addScalar(260);
      this.occluderIndex ??= new SpatialIndex(this.occluders);
      this.occluderIndex.query(this.intersectsOccluderQuery, this.occluderCandidates);
      for (const occluder of this.occluderCandidates) {
        const x = Math.floor(occluder.center.x / OCCLUDER_CELL), y = Math.floor(occluder.center.y / OCCLUDER_CELL);
        if (Math.abs(x - cx) > 2 || Math.abs(y - cy) > 2 || occluder.center.distanceToSquared(camera.position) > 260 ** 2) continue;
        const face = projectOccluder(occluder, camera, this.viewProjection);
        if (face) projected.push(face);
      }
      projected.sort((a, b) => b.area - a.area);
      projected.length = Math.min(projected.length, 48);
    }
    this.index ??= new SpatialIndex(this.entries);
    if (this.hierarchicalFrustum) this.index.queryFrustum(this.frustum, this.candidates);
    else this.index.query(this.intersectsView, this.candidates);
    this.stats.frustum = this.entries.length - this.candidates.length;
    this.stats.occluded = this.stats.mainTriangles = this.stats.distance = this.stats.props = 0;
    for (const entry of this.entries) {
      entry.skip = true;
    }
    // The maximum retains the engine's original far plane (including screen
    // corners). Ease its haze in completely before enabling radial rejection.
    const worldLimit = this.distanceUniforms.worldDistanceStrength.value < 1 ? Infinity : this.currentDistances.renderDistance;
    for (const entry of this.candidates) {
      const limit = entry.props ? Math.min(worldLimit, this.currentDistances.propsDistance) : worldLimit;
      // Tight bounds, not center distance: keep every chunk containing nearby
      // geometry. The fragment fade finishes before a chunk is omitted.
      if (limit !== Infinity && boundsDistanceSquared(entry.bounds, camera.position) > limit * limit) {
        this.stats.distance++;
        if (entry.props) this.stats.props++;
        continue;
      }
      entry.skip = false;
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
