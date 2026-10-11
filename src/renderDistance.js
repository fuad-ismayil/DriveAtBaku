export const DISTANCE_SETTINGS = Object.freeze({
  renderDistance: { min: 400, max: 6000, step: 100, default: 6000, key: 'baku-render-distance' },
  propsDistance: { min: 100, max: 3000, step: 50, default: 3000, key: 'baku-props-distance' },
});

export function normalizeDistance(value, setting) {
  const spec = DISTANCE_SETTINGS[setting];
  const number = value === null || value === '' || value === undefined ? NaN : Number(value);
  return Number.isFinite(number)
    ? Math.max(spec.min, Math.min(spec.max, Math.round(number / spec.step) * spec.step)) : spec.default;
}

export function readDistances(storage) {
  const values = {};
  for (const [name, spec] of Object.entries(DISTANCE_SETTINGS)) {
    try { values[name] = normalizeDistance(storage?.getItem(spec.key), name); }
    catch { values[name] = spec.default; }
  }
  return values;
}

export function saveDistance(storage, name, value) {
  const normalized = normalizeDistance(value, name);
  try { storage?.setItem(DISTANCE_SETTINGS[name].key, String(normalized)); } catch { /* optional storage */ }
  return normalized;
}

// An explicit prop vocabulary: unknown and mixed surfaces keep the world range.
// In particular, road markings, barriers and building lights remain structural.
export function isDistanceProp(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.length > 0 && materials.every(material => {
    const name = `${material.name} ${mesh.name}`;
    return !/building|pitgarage|road|pavement|landscape|barrier|fence|wall|grandstand|bridge/i.test(material.name)
      && /tree|hedge|bush|street[_ -]?light|lamp[_ -]?post|utility[_ -]?pole|telegraph|bollard|bench|litter|trash|decoration/i.test(name);
  });
}

export function createDistanceUniforms() {
  return {
    worldDistanceLimit: { value: DISTANCE_SETTINGS.renderDistance.default },
    worldDistanceStrength: { value: 0 },
    propsDistanceLimit: { value: DISTANCE_SETTINGS.propsDistance.default },
    distanceMainView: { value: 1 },
  };
}

// Opaque, depth-writing fades avoid transparent sorting and retain cutout leaves.
// Screen-door coverage is stable in time; the existing MSAA/SMAA smooths it.
export function applyDistanceFade(material, camera, uniforms, props) {
  // Major surfaces already have the engine's efficient fog shader. Only props
  // need a custom coverage fade; full-distance world shaders remain unchanged.
  if (!props || material.userData.distanceFade) return;
  const previousCompile = material.onBeforeCompile, previousRender = material.onBeforeRender;
  const key = material.customProgramCacheKey();
  const distancePosition = material.isMeshStandardMaterial || material.isMeshPhongMaterial
    ? 'vViewPosition' : 'distanceViewPosition';
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    // The map's PBR shaders already interpolate view position. Reuse it instead
    // of adding another three components of bandwidth to every city fragment.
    if (distancePosition === 'distanceViewPosition') {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nvarying vec3 distanceViewPosition;');
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\ndistanceViewPosition = mvPosition.xyz;');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      ${distancePosition === 'distanceViewPosition' ? 'varying vec3 distanceViewPosition;' : ''}
      uniform float propsDistanceLimit, distanceMainView;
      float distanceCoverage(float start, float end, float distanceToEye) {
        return 1.0 - smoothstep(start, end, distanceToEye);
      }`);
    // Reject before expensive PBR lighting, while retaining authored alpha tests.
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
      #include <clipping_planes_fragment>
      if (distanceMainView > 0.5) {
        float propCoverage = distanceCoverage(propsDistanceLimit * 0.72, propsDistanceLimit, length(${distancePosition}));
        if (propCoverage < 1.0) {
          // A fixed 4x4 ordered pattern, with no per-frame random flicker.
          vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
          float threshold = mod(mod(cell.x, 2.0) * 2.0 + mod(cell.y, 2.0) * 3.0, 4.0) * 4.0
            + mod(floor(cell.x / 2.0) * 2.0 + floor(cell.y / 2.0) * 3.0, 4.0);
          if (propCoverage < (threshold + 0.5) / 16.0) discard;
        }
      }`);
  };
  material.onBeforeRender = function(renderer, scene, view, ...args) {
    previousRender.call(this, renderer, scene, view, ...args);
    uniforms.distanceMainView.value = view === camera ? 1 : 0;
  };
  material.customProgramCacheKey = () => `${key}:prop-distance-fade-v3`;
  material.userData.distanceFade = true;
  material.needsUpdate = true;
}

export const boundsDistanceSquared = (bounds, point) => {
  const x = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
  const y = Math.max(bounds.min.y - point.y, 0, point.y - bounds.max.y);
  const z = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
  return x * x + y * y + z * z;
};
