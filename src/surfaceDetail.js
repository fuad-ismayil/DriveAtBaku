import * as THREE from 'three';

export function surfaceKind(name = '') {
  if (/^ROAD_(?:AZER|OFFTRACK_[AB])(?:-|$)/i.test(name)) return 'asphalt';
  if (/^BAK_PAVEMENT_[ABCD](?:-|$)/i.test(name)) return 'pavement';
  return null;
}

// A small shared, seamless texture supplies millimetre-scale grain. Original
// color maps and UVs stay intact; detail is sampled in world metres across chunks.
export function createSurfaceDetail() {
  const size = 256, heights = new Float32Array(size * size), bytes = new Uint8Array(size * size * 4);
  let seed = 0x5ba9d3;
  for (let i = 0; i < heights.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    heights[i] = (seed >>> 0) / 0xffffffff;
  }
  const sample = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4, height = sample(x, y);
    bytes[offset] = Math.round(128 + (sample(x - 1, y) - sample(x + 1, y)) * 100);
    bytes[offset + 1] = Math.round(128 + (sample(x, y - 1) - sample(x, y + 1)) * 100);
    bytes[offset + 2] = Math.round(195 + height * 58);
    bytes[offset + 3] = Math.round(height * 255);
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  texture.name = 'shared-asphalt-grain';
  let materialCount = 0;

  function apply(material) {
    const kind = surfaceKind(material.name);
    if (!kind || material.userData.surfaceDetail) return false;
    material.userData.surfaceDetail = kind;
    material.roughness = kind === 'asphalt' ? 0.89 : 0.82;
    material.metalness = 0;
    const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey.bind(material);
    // Capture the old key before installing a new callback (the default key uses
    // onBeforeCompile.toString()). Compose callbacks rather than erasing patches.
    const key = previousKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.streetDetail = { value: texture };
      shader.uniforms.streetNormalStrength = { value: kind === 'asphalt' ? 0.11 : 0.035 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vStreetPosition;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 streetWorld = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            streetWorld = batchingMatrix * streetWorld;
          #endif
          #ifdef USE_INSTANCING
            streetWorld = instanceMatrix * streetWorld;
          #endif
          vStreetPosition = (modelMatrix * streetWorld).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vStreetPosition;\nuniform sampler2D streetDetail;\nuniform float streetNormalStrength;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec4 streetGrain = texture2D(streetDetail, vStreetPosition.xy / 0.65);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 streetUp = mat3(viewMatrix) * vec3(0.0, 0.0, 1.0);
          float streetTop = smoothstep(0.65, 0.95, abs(dot(normal, streetUp)));
          vec3 streetSlope = mat3(viewMatrix) * vec3(streetGrain.rg * 2.0 - 1.0, 0.0);
          diffuseColor.rgb *= mix(1.0, 0.97 + streetGrain.a * 0.06, streetTop);
          roughnessFactor = clamp(roughnessFactor + (streetGrain.b - 0.88) * 0.30 * streetTop, 0.65, 1.0);
          normal = normalize(normal + streetSlope * streetNormalStrength * streetTop);`);
    };
    material.customProgramCacheKey = () => `${key}:street-detail-v1:${kind}`;
    material.needsUpdate = true;
    materialCount++;
    return true;
  }
  return { apply, texture, get materialCount() { return materialCount; }, dispose() { texture.dispose(); } };
}
