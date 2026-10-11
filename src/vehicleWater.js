import * as THREE from 'three';

// Water is evaluated inside the existing PBR draw. No droplet meshes, particle
// buffers, extra render targets, or per-drop CPU updates are needed.
const WATER_GLSL = /* glsl */`
varying vec3 vCarWaterPosition;
uniform mat4 carWaterWorldToLocal;
uniform float carWaterWetness, carWaterRain, carWaterTime, carWaterDetail;
uniform vec3 carWaterTravel, carWaterFlow, carWaterGravity;
uniform vec3 carWaterBounds;

vec3 carWaterHash(vec2 p) {
  vec3 h = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  h += dot(h, h.yxz + 33.33);
  return fract((h.xxy + h.yzz) * h.zyx);
}
vec3 carWaterUnion(vec3 a, vec3 b) {
  // Smoothly join beads into larger drops and short rivulets.
  if (min(a.z, b.z) <= 0.0) return a.z > b.z ? a : b;
  float h = clamp(.5 + .5 * (a.z - b.z) / .045, 0.0, 1.0);
  return vec3(mix(b.xy, a.xy, h), mix(b.z, a.z, h) + .045 * h * (1.0 - h));
}
vec3 carWaterCap(vec2 q, float radius, vec2 footprint) {
  // Convolve the dome with the pixel footprint, conserving its covered area.
  // This widens only the pixel reconstruction kernel, never the physical bead.
  vec2 radiusSquared = vec2(radius * radius) + footprint * footprint * .12;
  float area = radius * radius / sqrt(radiusSquared.x * radiusSquared.y);
  float cap = max(1.0 - dot(q * q, 1.0 / radiusSquared), 0.0);
  // Analytic optical slope survives when adjacent pixels miss the same bead.
  // A rounded cap has a contact angle, rather than a fixed shallow height that
  // flattens progressively larger drops. XY = slope, Z = filtered coverage.
  return vec3(-4.0 * cap * q / radiusSquared * radius * .32 * area, cap * cap * area);
}
vec3 carWaterDrops(vec2 p, vec2 footprint, vec2 flow, float stretch, float wet, float mobile) {
  vec2 cell = floor(p), f = fract(p);
  vec3 height = vec3(0.0);
  vec2 along = flow / max(length(flow), .0001);
  vec2 across = vec2(-along.y, along.x);
  if (length(flow) < .0001) { along = vec2(0, 1); across = vec2(1, 0); }
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 offset = vec2(float(x), float(y));
    vec3 seed = carWaterHash(cell + offset);
    vec2 q = f - offset - (.05 + seed.xy * .90);
    float age = fract(carWaterTime * .19 + seed.z * 13.0);
    float arrival = mix(1.0, smoothstep(0.0, .16, age) * (1.0 - smoothstep(.87, 1.0, age)), carWaterRain);
    float coverage = smoothstep(seed.z, seed.z + .16, wet * .88);
    float radius = mix(.08, .32, seed.z) * mix(.45, 1.0, arrival);
    float extension = 1.0 + stretch * mobile * (.5 + seed.y);
    vec2 ellipse = vec2(dot(q, across), dot(q, along) / extension);
    vec2 filteredFootprint = vec2(dot(abs(across), footprint), dot(abs(along), footprint) / extension);
    vec3 dome = carWaterCap(ellipse, radius, filteredFootprint) * coverage;
    // A neighbouring bead grows into the moving head, then drains as a tail.
    vec2 joined = ellipse - vec2(radius * .8, radius * .5);
    vec3 second = carWaterCap(joined, radius * .8062, filteredFootprint);
    dome = carWaterUnion(dome, second * coverage * mobile * wet * .75);
    dome.xy = across * dome.x + along * dome.y / extension;
    height = carWaterUnion(height, dome);
  }
  return height;
}
`;

export function createVehicleWater() {
  const states = new WeakMap(), owners = new WeakMap();
  const inverseRotation = new THREE.Quaternion(), worldRotation = new THREE.Quaternion();
  const localVelocity = new THREE.Vector3(), localGravity = new THREE.Vector3();
  const bounds = new THREE.Box3(), meshBounds = new THREE.Box3(), meshToCar = new THREE.Matrix4();
  const wind = new THREE.Vector3(2.2, .55, 0);
  let detail = 1, time = 0;

  function install(material, state, glass) {
    const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
    // Standard glass and Physical materials with clearcoat=0 previously missed
    // the neutral water reflection layer altogether. Enable the same PBR lobe
    // with its original dry weight (zero), without changing the material type,
    // pigment, opacity, textures, or its authored clearcoat settings.
    const addWaterCoat = !(material.clearcoat > 0);
    if (addWaterCoat) material.defines = { ...material.defines, USE_CLEARCOAT: '' };
    owners.set(material, { state, previous, key });
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, state.uniforms);
      if (addWaterCoat) {
        shader.uniforms.clearcoat ??= { value: material.clearcoat ?? 0 };
        shader.uniforms.clearcoatRoughness ??= { value: material.clearcoatRoughness ?? 0 };
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCarWaterPosition; uniform mat4 carWaterWorldToLocal;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vCarWaterPosition = (carWaterWorldToLocal * modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WATER_GLSL}`)
        .replace('#include <lights_physical_fragment>', `
          float carWaterFilm = 0.0, carWaterBeads = 0.0;
          if (carWaterWetness > 0.0) {
            vec3 carWaterExteriorNormal = nonPerturbedNormal;
            #ifdef DOUBLE_SIDED
              carWaterExteriorNormal *= faceDirection;
            #endif
            vec3 carWaterN = normalize(mat3(carWaterWorldToLocal) * inverseTransformDirection(carWaterExteriorNormal, viewMatrix));
            float facingSky = max(dot(carWaterN, -carWaterGravity), 0.0);
            // Suppress undersides and interior surfaces; doors/mirrors receive
            // wind-driven rain, while roof/bonnet collect the largest film.
            vec2 shell = abs(vCarWaterPosition.xy) / max(carWaterBounds.xy, vec2(.01));
            float outerShell = smoothstep(.35, .67, max(shell.x, shell.y));
            float outward = smoothstep(.0, .35, dot(carWaterN.xy, vCarWaterPosition.xy / max(carWaterBounds.xy, vec2(.01))));
            float aboveFloor = smoothstep(.12, .35, vCarWaterPosition.z / max(carWaterBounds.z, .1));
            float exposure = max(facingSky, outerShell * outward * .88) * aboveFloor;
            exposure *= smoothstep(-.42, -.06, carWaterN.z);
            vec3 axes = abs(carWaterN);
            vec2 p, travel, flow;
            vec3 tangentTravel = carWaterTravel - carWaterN * dot(carWaterTravel, carWaterN);
            vec3 tangentFlow = carWaterFlow - carWaterN * dot(carWaterFlow, carWaterN);
            if (axes.z >= axes.x && axes.z >= axes.y) {
              p = vCarWaterPosition.xy; travel = tangentTravel.xy; flow = tangentFlow.xy;
            } else if (axes.x >= axes.y) {
              p = vCarWaterPosition.yz; travel = tangentTravel.yz; flow = tangentFlow.yz;
            } else {
              p = vCarWaterPosition.xz; travel = tangentTravel.xz; flow = tangentFlow.xz;
            }
            // Filter each projection axis separately: the grazing axis of a
            // window must not erase detail that is resolved along the other.
            vec2 footprint = sqrt(dFdx(p) * dFdx(p) + dFdy(p) * dFdy(p));
            float pixelMetres = max(footprint.x, footprint.y);
            float coarseFade = 1.0 - smoothstep(.025, .065, pixelMetres);
            float fineFade = (1.0 - smoothstep(.002, .010, pixelMetres)) * carWaterDetail;
            float stretch = clamp(length(flow) * 9.0, 0.0, 2.5);
            float mobile = smoothstep(.18, .85, carWaterWetness) * (1.0 - facingSky * .65);
            vec3 drops = vec3(0.0), smallDrops = vec3(0.0);
            if (coarseFade > .001) drops = carWaterDrops((p - travel) * 48.0, footprint * 48.0, flow, stretch, carWaterWetness, mobile) * coarseFade;
            if (fineFade > .001) smallDrops = carWaterDrops((p - travel * .08) * 135.0, footprint * 135.0, flow, .15, carWaterWetness, .0) * fineFade;
            vec2 slope = (drops.xy + smallDrops.xy) * carWaterWetness * exposure;
            vec3 localSlope;
            if (axes.z >= axes.x && axes.z >= axes.y) localSlope = vec3(slope, 0.0);
            else if (axes.x >= axes.y) localSlope = vec3(0.0, slope);
            else localSlope = vec3(slope.x, 0.0, slope.y);
            localSlope -= carWaterN * dot(carWaterN, localSlope);
            vec3 viewSlope = mat3(viewMatrix) * transpose(mat3(carWaterWorldToLocal)) * localSlope;
            #ifdef DOUBLE_SIDED
              viewSlope *= faceDirection;
            #endif
            carWaterBeads = clamp(max(drops.z, smallDrops.z) * exposure, 0.0, 1.0);
            carWaterFilm = carWaterWetness * exposure;
            normal = normalize(normal - viewSlope);
            roughnessFactor = mix(roughnessFactor, min(roughnessFactor, ${glass ? '.075' : '.19'}), carWaterFilm * .55);
            roughnessFactor = mix(roughnessFactor, .055, carWaterBeads * carWaterWetness * .8);
            #ifdef USE_CLEARCOAT
              clearcoatNormal = normalize(clearcoatNormal - viewSlope);
            #endif
          }
          #include <lights_physical_fragment>
          #ifdef USE_CLEARCOAT
            material.clearcoat = mix(material.clearcoat, 1.0, carWaterFilm * .55);
            material.clearcoatRoughness = mix(material.clearcoatRoughness, .065, max(carWaterFilm * .45, carWaterBeads * carWaterWetness));
            material.clearcoatF0 = mix(material.clearcoatF0, vec3(.02037), carWaterFilm);
          #endif
        `);
      // Paint pigment, textures, metalness, glass tint and transparency stay
      // authored. Only the surface normal and PBR water layer change.
    };
    material.customProgramCacheKey = () => `${key}:vehicle-water-v2:${glass ? 'glass' : 'body'}:${addWaterCoat}`;
    material.needsUpdate = true;
  }

  function register(vehicle) {
    if (states.has(vehicle)) return states.get(vehicle);
    const state = { wetness: 0, uniforms: {
      carWaterWorldToLocal: { value: new THREE.Matrix4() },
      carWaterWetness: { value: 0 }, carWaterRain: { value: 0 },
      carWaterTime: { value: time }, carWaterDetail: { value: detail },
      carWaterTravel: { value: new THREE.Vector3() }, carWaterFlow: { value: new THREE.Vector3() },
      carWaterGravity: { value: new THREE.Vector3(0, 0, -1) },
      carWaterBounds: { value: new THREE.Vector3(1, 2, 1.5) },
    } };
    vehicle.updateWorldMatrix(true, true);
    state.uniforms.carWaterWorldToLocal.value.copy(vehicle.matrixWorld).invert();
    const wheels = new Set((vehicle.userData.wheels ?? []).map(w => w.steerPivot));
    const plates = new Set(vehicle.userData.licensePlates?.rigs ?? []);
    const paints = new Set(vehicle.userData.paintMaterials ?? []);
    bounds.makeEmpty();
    const replacements = new Map();
    vehicle.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (let parent = mesh; parent && parent !== vehicle; parent = parent.parent) {
        if (wheels.has(parent) || plates.has(parent)) return;
      }
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      meshToCar.multiplyMatrices(state.uniforms.carWaterWorldToLocal.value, mesh.matrixWorld);
      meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(meshToCar);
      bounds.union(meshBounds);
      const patch = material => {
        if (!material.isMeshStandardMaterial || material.userData.vehicleWaterExcluded) return material;
        const glass = material.userData.vehicleWaterGlass ?? (material.transparent && material.opacity >= .1 && material.roughness < .35);
        if (!paints.has(material) && !glass && !material.userData.vehicleWaterExterior) return material;
        let selected = replacements.get(material) ?? material;
        const owner = owners.get(selected);
        if (owner && owner.state !== state) {
          selected = material.clone();
          selected.userData = { ...material.userData };
          selected.onBeforeCompile = owner.previous;
          selected.customProgramCacheKey = () => owner.key;
          replacements.set(material, selected);
        }
        if (!owners.has(selected)) install(selected, state, glass);
        return selected;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(patch) : patch(mesh.material);
    });
    if (!bounds.isEmpty()) state.uniforms.carWaterBounds.value.set(
      Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
      Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y)), bounds.max.z,
    );
    // Keep paint controls and lamps pointing at any private material instances.
    for (const name of ['paintMaterials', 'headlightMaterials', 'reverseLightMaterials', 'brakeLights']) {
      const value = vehicle.userData[name];
      if (Array.isArray(value)) vehicle.userData[name] = value.map(m => replacements.get(m) ?? m);
      else if (value) vehicle.userData[name] = replacements.get(value) ?? value;
    }
    states.set(vehicle, state);
    return state;
  }

  return {
    setQuality(quality) { detail = quality === 'performance' ? 0 : quality === 'balanced' ? .65 : 1; },
    update(dt) { time += Math.max(0, dt); },
    updateVehicle(vehicle, dt, { rain = 0, outside = true, sunny = true, velocity } = {}) {
      if (!vehicle) return;
      const state = register(vehicle), u = state.uniforms;
      const step = Math.max(0, Math.min(dt, .25));
      vehicle.updateWorldMatrix(true, false);
      u.carWaterWorldToLocal.value.copy(vehicle.matrixWorld).invert();
      vehicle.getWorldQuaternion(worldRotation); inverseRotation.copy(worldRotation).invert();
      localVelocity.copy(velocity ?? wind).multiplyScalar(velocity ? -1 : 0).add(wind).applyQuaternion(inverseRotation);
      localGravity.set(0, 0, -1).applyQuaternion(inverseRotation);
      u.carWaterGravity.value.copy(localGravity);
      const speed = velocity?.length() ?? 0;
      const fallingRain = outside ? THREE.MathUtils.clamp(rain, 0, 2) : 0;
      if (fallingRain > 0) state.wetness = THREE.MathUtils.damp(state.wetness, 1, .20 * fallingRain, step);
      else state.wetness = Math.max(0, state.wetness - step * ((sunny ? .018 : .008) + Math.min(speed, 70) * .00022));
      if (state.wetness < .0001) { state.wetness = 0; u.carWaterTravel.value.set(0, 0, 0); }
      u.carWaterWetness.value = outside ? state.wetness : 0;
      u.carWaterRain.value = THREE.MathUtils.damp(u.carWaterRain.value, Math.min(fallingRain, 1), 1.2, step);
      u.carWaterTime.value = time; u.carWaterDetail.value = detail;
      const runoff = .022 + state.wetness * .055;
      u.carWaterFlow.value.copy(localGravity).multiplyScalar(runoff).addScaledVector(localVelocity, .0024);
      u.carWaterTravel.value.addScaledVector(u.carWaterFlow.value, step * state.wetness);
      return state.wetness;
    },
    getWetness(vehicle) { return states.get(vehicle)?.wetness ?? 0; },
  };
}
