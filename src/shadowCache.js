// Reuse only an identical shadow map. Moving cars, wheels, lights, alpha masks,
// caster membership and batch shadow selection invalidate it in the same frame.
export function createShadowCache(scene, light, camera) {
  const records = new WeakMap(), materials = new WeakMap();
  const lightMatrix = new Float64Array(16), targetMatrix = new Float64Array(16);
  const lightState = new Array(12);
  let generation = 0, previousCount = -1, dirty = true;
  const stats = { updates: 0, reused: 0 };
  const changedMatrix = (snapshot, matrix) => {
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (snapshot[i] !== matrix.elements[i]) { snapshot[i] = matrix.elements[i]; changed = true; }
    }
    return changed;
  };
  const checkMaterial = material => {
    let record = materials.get(material);
    if (!record) { record = {}; materials.set(material, record); dirty = true; }
    for (const key of ['version', 'visible', 'opacity', 'alphaTest', 'side', 'shadowSide', 'displacementScale', 'displacementBias']) {
      if (record[key] !== material[key]) { record[key] = material[key]; dirty = true; }
    }
    for (const key of ['map', 'alphaMap', 'displacementMap']) {
      const texture = material[key];
      if (record[key] !== texture || record[`${key}Version`] !== texture?.version) {
        record[key] = texture; record[`${key}Version`] = texture?.version; dirty = true;
      }
    }
  };
  let count = 0;
  const visit = object => {
    if (!object.castShadow || !object.layers.test(camera.layers) || !object.geometry) return;
    count++;
    let record = records.get(object);
    if (!record) { record = { matrix: new Float64Array(16) }; records.set(object, record); }
    if (record.generation !== generation - 1) dirty = true;
    record.generation = generation;
    if (changedMatrix(record.matrix, object.matrixWorld)) dirty = true;
    const geometry = object.geometry;
    if (record.geometry !== geometry || record.positionVersion !== geometry.attributes.position?.version
      || record.uvVersion !== geometry.attributes.uv?.version || record.indexVersion !== geometry.index?.version
      || record.shadowVersion !== object.userData.shadowVersion) dirty = true;
    record.geometry = geometry; record.positionVersion = geometry.attributes.position?.version;
    record.uvVersion = geometry.attributes.uv?.version; record.indexVersion = geometry.index?.version;
    record.shadowVersion = object.userData.shadowVersion;
    // Animated vertex deformation needs a fresh map even with a stable transform.
    if (object.isSkinnedMesh || object.morphTargetInfluences?.some(value => value !== 0)) dirty = true;
    if (Array.isArray(object.material)) for (const material of object.material) checkMaterial(material);
    else if (object.material) checkMaterial(object.material);
  };
  const update = renderer => {
    generation++; count = 0;
    const shadow = light.shadow, view = shadow.camera;
    const movedLight = changedMatrix(lightMatrix, light.matrixWorld);
    const movedTarget = changedMatrix(targetMatrix, light.target.matrixWorld);
    if (movedLight || movedTarget) dirty = true;
    const values = [shadow.mapSize.x, shadow.mapSize.y, view.near, view.far, view.left, view.right,
      view.top, view.bottom, camera.layers.mask, renderer.shadowMap.type, renderer.shadowMap.enabled, light.castShadow];
    for (let i = 0; i < values.length; i++) if (lightState[i] !== values[i]) { lightState[i] = values[i]; dirty = true; }
    scene.traverseVisible(visit);
    if (count !== previousCount) dirty = true;
    previousCount = count;
    shadow.autoUpdate = false;
    shadow.needsUpdate ||= dirty || !shadow.map;
    if (shadow.needsUpdate) stats.updates++; else stats.reused++;
    dirty = false;
  };
  const previous = scene.onBeforeRender, autoUpdate = light.shadow.autoUpdate;
  scene.onBeforeRender = function(renderer, renderedScene, view, ...args) {
    previous.call(this, renderer, renderedScene, view, ...args);
    if (view === camera) update(renderer);
  };
  return { update, stats, invalidate() { dirty = true; },
    dispose() { scene.onBeforeRender = previous; light.shadow.autoUpdate = autoUpdate; } };
}
