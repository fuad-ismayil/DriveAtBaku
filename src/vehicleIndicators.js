import * as THREE from 'three';
import { INDICATOR_MODES } from './net/indicatorProtocol.js';
export { INDICATOR_MODES, isNewerSequence } from './net/indicatorProtocol.js';

export const INDICATOR_PERIOD_MS = 800;
export const INDICATOR_KEYS = { Comma: 'left', Period: 'right', Slash: 'hazard' };

export function createIndicatorState() {
  return { mode: 'off', startedAt: 0, revision: 0, serverAt: null };
}

export function toggleIndicator(state, requested, now) {
  if (!INDICATOR_MODES.includes(requested)) return;
  state.mode = state.mode === requested ? 'off' : requested;
  state.startedAt = now;
  state.revision = (state.revision + 1) >>> 0;
  state.serverAt = null;
}

export function indicatorLevels(mode, startedAt, now) {
  const elapsed = Math.max(0, now - startedAt);
  const on = elapsed % INDICATOR_PERIOD_MS < INDICATOR_PERIOD_MS / 2;
  return [Number(on && (mode === 'left' || mode === 'hazard')),
    Number(on && (mode === 'right' || mode === 'hazard'))];
}

export function indicatorInputMode(event, driving) {
  if (!driving || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.target?.closest?.('input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]')) return null;
  return INDICATOR_KEYS[event.code] ?? null;
}

const band = (axis, min, max) => `(step(${min.toFixed(5)}, signalPosition.${axis}) * step(signalPosition.${axis}, ${max.toFixed(5)}))`;
const absBand = (min, max) => `(step(${min.toFixed(5)}, abs(signalPosition.x)) * step(abs(signalPosition.x), ${max.toFixed(5)}))`;
const all = '1.0';

// Fitted vehicle coordinates: X right, Y forward, Z up. Masks stay on authored
// lamp surfaces; neither body geometry nor the renderer's light list changes.
export function installVehicleIndicators(vehicle, id) {
  if (vehicle.userData.indicators) return;
  const levels = { value: new THREE.Vector2() }, records = [];
  vehicle.updateMatrixWorld(true);
  const inverse = vehicle.matrixWorld.clone().invert();
  const patch = (name, mask, materialIndex = 0, restMask = mask) => {
    const meshes = [];
    vehicle.traverse(mesh => { if (mesh.isMesh && mesh.name === name) meshes.push(mesh); });
    for (const mesh of meshes) {
      const source = Array.isArray(mesh.material) ? mesh.material[materialIndex] : mesh.material;
      if (!source) continue;
      const material = source.clone(), previous = source.onBeforeCompile;
      const previousKey = source.customProgramCacheKey();
      // Three's clone omits compile callbacks. Preserve reverse/headlight masks.
      material.userData = { ...source.userData };
      const toVehicle = { value: inverse.clone().multiply(mesh.matrixWorld) };
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.uniforms.signalLevels = levels;
        shader.uniforms.signalToVehicle = toVehicle;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 signalPosition; uniform mat4 signalToVehicle;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nsignalPosition = (signalToVehicle * vec4(position, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 signalPosition; uniform vec2 signalLevels;')
          .replace('#include <lights_fragment_begin>', `
            float signalRegion = ${mask};
            float signalLevel = signalRegion * (signalPosition.x < 0.0 ? signalLevels.x : signalLevels.y);
            float signalTexture = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
            totalEmissiveRadiance *= 1.0 - (${restMask});
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.23, 0.008), signalLevel * 0.85);
            diffuseColor.a = max(diffuseColor.a, signalLevel * 0.98);
            totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(4.0, 0.48, 0.008), signalLevel);
            #include <lights_fragment_begin>`)
          .replace('#include <opaque_fragment>', `
            outgoingLight = mix(outgoingLight, vec3(3.0, 0.38, 0.004)
              * (0.72 + 0.28 * signalTexture)
              * (0.65 + 0.35 * sqrt(abs(dot(normal, geometryViewDir)))) + totalSpecular * 0.05, signalLevel);
            #include <opaque_fragment>`);
      };
      material.customProgramCacheKey = () => `${previousKey}:indicator-v1:${mask}:${restMask}`;
      if (Array.isArray(mesh.material)) { mesh.material = [...mesh.material]; mesh.material[materialIndex] = material; }
      else mesh.material = material;
      for (const key of ['headlightMaterials', 'brakeLights', 'reverseLightMaterials']) {
        const entry = vehicle.userData[key];
        if (Array.isArray(entry)) vehicle.userData[key] = entry.map(m => m === source ? material : m);
        else if (entry === source) vehicle.userData[key] = material;
      }
      records.push({ mesh, material, materialIndex, mask });
    }
  };
  if (id === 'prado') {
    for (const name of ['Object_102', 'Object_104', 'Object_106', 'Object_68']) patch(name, all);
    // Clear lens bands over the authored amber bulbs, above the reverse band.
    patch('Object_74', `${absBand(.75, 1.0)} * ${band('z', 1.165, 1.26)}`);
    patch('Object_72', `${absBand(.81, .91)} * ${band('z', 1.055, 1.15)}`);
  } else if (id === 'elantra') {
    patch('mirror_si0', all);
    // Upper, outer bulb/reflector pocket; fogs and low/high projectors excluded.
    const front = `${absBand(.70, .80)} * ${band('z', .745, .845)}`;
    patch('Elantra part 20', front, 4);
    patch('Elantra part 20', front, 6);
    patch('headlight0', front);
    const rear = `${absBand(.65, .73)} * ${band('z', .84, .905)}`;
    // The clear outer pocket has its own reflector and cover material group.
    // Group 3 / cover group 1 belong to the red stop/tail lenses, not signals.
    patch('Elantra part 18', rear, 0);
    patch('taillight_', rear, 0);
  } else if (id === 'amg') {
    patch('body_Material_0', absBand(.84, .92));
    const mirror = `${absBand(.95, 1.09)} * ${band('y', -.18, .02)} * ${band('z', 1.0, 1.04)}`;
    const rear = `${absBand(.37, .90)} * ${band('y', -2.36, -1.86)} * ${band('z', .785, .807)}`;
    const front = `${absBand(.84, .92)} * ${band('y', 1.70, 1.89)} * ${band('z', .59, .73)}`;
    patch('body_glass_0', `max(${mirror}, max(${rear}, ${front}))`);
  } else if (id === 'ferrari') {
    // LEDs include the two small fender repeaters behind the front wheel arches.
    patch('leds', all, 0, absBand(.90, 1.0));
    const diodeCentres = [[.800,1.516],[.776,1.533],[.790,1.568],[.767,1.584],
      [.780,1.622],[.756,1.638],[.771,1.672],[.747,1.689],
      [.762,1.720],[.737,1.736],[.753,1.766],[.729,1.781]];
    const spots = diodeCentres.map(([x,y]) => `(1.0 - smoothstep(0.008, 0.013, length(vec2(abs(signalPosition.x) - ${x}, signalPosition.y - ${y}))))`);
    const front = `${spots.reduce((a,b)=>`max(${a}, ${b})`)} * ${band('z', .65, .80)}`;
    patch('headlight_covers', front, 0, '0.0');
    // Central amber disc inside each red tail/stop ring; high stop light excluded.
    const disc = `(1.0 - smoothstep(0.039, 0.043, length(vec2(abs(signalPosition.x) - 0.772, signalPosition.z - 0.875)))) * ${band('y', -2.06, -2.02)}`;
    patch('brakes', disc);
    patch('lights_red', disc);
    patch('chrome', disc);
    patch('glass', disc);
  }
  vehicle.userData.indicators = { levels, records };
}

export function updateVehicleIndicators(vehicle, mode, startedAt, now) {
  const rig = vehicle?.userData.indicators;
  if (!rig) return;
  const [left, right] = indicatorLevels(mode, startedAt, now);
  rig.levels.value.set(left, right);
}

export function disposeVehicleIndicators(vehicle) {
  const rig = vehicle?.userData.indicators;
  if (!rig || rig.disposed) return;
  rig.disposed = true;
  for (const { material } of rig.records) material.dispose();
}
