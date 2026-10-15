import { BufferAttribute } from 'three';

// These are the leaf/canopy materials in the supplied map. Tree bases and
// decorative tree lights have their own surface normals and are left alone.
export function foliageKind(name = '') {
  if (/^TREEC(?:-material)?$/i.test(name)) return 'canopy';
  if (/^BAK_FEATURE_P_HEDGES_A_01(?:-material)?$/i.test(name)) return 'hedge';
  return null;
}

// TREEC combines every tree into one mesh. Recover each connected card before
// spatial partitioning, rather than shading relative to a city-wide/chunk box.
// The supplied cards are Y-up in model space, with their crown in the top 68%.
export function prepareFoliageGeometry(mesh) {
  const geometry = mesh.geometry;
  if (Array.isArray(mesh.material) || foliageKind(mesh.material?.name) !== 'canopy'
    || !geometry?.index || geometry.hasAttribute('foliageVolume')) return false;
  const position = geometry.getAttribute('position'), index = geometry.index;
  const parents = Int32Array.from({ length: position.count }, (_, i) => i);
  function find(i) {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  }
  for (let i = 0; i < index.count; i += 3) {
    const root = find(index.getX(i));
    parents[find(index.getX(i + 1))] = root;
    parents[find(index.getX(i + 2))] = root;
  }
  const cards = new Map();
  for (let i = 0; i < position.count; i++) {
    const root = find(i), x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (!cards.has(root)) cards.set(root, [x, y, z, x, y, z]);
    const bounds = cards.get(root);
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.min(bounds[2], z);
    bounds[3] = Math.max(bounds[3], x); bounds[4] = Math.max(bounds[4], y); bounds[5] = Math.max(bounds[5], z);
  }
  const volume = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const [x0, y0, z0, x1, y1, z1] = cards.get(find(i));
    const radius = Math.max(Math.hypot(x1 - x0, z1 - z0) * .5, .001);
    const height = Math.max(y1 - y0, .001), elevation = (position.getY(i) - y0) / height;
    volume.set([(position.getX(i) - (x0 + x1) * .5) / radius,
      (elevation - .66) / .34, (position.getZ(i) - (z0 + z1) * .5) / radius, elevation], i * 4);
  }
  geometry.setAttribute('foliageVolume', new BufferAttribute(volume, 4));
  return true;
}

export function applyFoliageLighting(material) {
  const kind = foliageKind(material.name);
  if (!kind || !material.isMeshStandardMaterial || material.userData.foliageLighting) return false;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.userData.foliageLighting = kind;
  material.metalness = 0;
  material.roughness = Math.max(material.roughness, .85);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (kind === 'canopy') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 foliageVolume;
          varying vec4 vFoliageVolume;
          varying vec3 vFoliageUp;
          varying vec3 vFoliageRadial;`)
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
          vFoliageVolume = foliageVolume;
          vFoliageUp = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
          vFoliageRadial = normalMatrix * foliageVolume.xyz;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec4 vFoliageVolume;
        varying vec3 vFoliageUp;
        varying vec3 vFoliageRadial;`);
      // A nearly edge-on crossed card otherwise reads as a sharp sheet through
      // the crown. Let the other card carry the silhouette at grazing views.
      // Match the prop fade's fixed coverage pattern, retaining opaque leaf
      // colour. Scaling alpha creates a translucent strip; scaling it before
      // the alpha test makes whole opaque leaf clusters pop at its cutoff.
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
        #include <alphatest_fragment>
        vec3 foliageFace = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        float foliageFacing = abs(dot(foliageFace, normalize(vViewPosition)));
        float foliageCoverage = smoothstep(.18, .55, foliageFacing);
        if (foliageCoverage < 1.0) {
          vec2 foliageCell = mod(floor(gl_FragCoord.xy), 4.0);
          float foliageThreshold = mod(mod(foliageCell.x, 2.0) * 2.0 + mod(foliageCell.y, 2.0) * 3.0, 4.0) * 4.0
            + mod(floor(foliageCell.x / 2.0) * 2.0 + floor(foliageCell.y / 2.0) * 3.0, 4.0);
          if (foliageCoverage < (foliageThreshold + .5) / 16.0) discard;
        }
      `);
      // Leaves scatter some incoming light. A normalized wrapped diffuse term
      // softens the crown's terminator without raising its sun-facing peak or
      // bypassing shadows (directLight.color already contains shadow visibility).
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `
        #include <lights_physical_pars_fragment>
        void RE_Direct_Foliage(const in IncidentLight directLight, const in vec3 geometryPosition,
          const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
          const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir,
            geometryClearcoatNormal, material, reflectedLight);
          float leafDot = dot(geometryNormal, directLight.direction);
          float leafWrap = max((leafDot + .35) / 1.35, 0.0);
          float leafScatter = (leafWrap - max(leafDot, 0.0)) * smoothstep(.28, .42, vFoliageVolume.w);
          reflectedLight.directDiffuse += leafScatter * directLight.color * BRDF_Lambert(material.diffuseColor);
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Foliage
      `);
      // Preserve the winding correction, then reconstruct a rounded crown in
      // the fragment shader. Vertex normals alone interpolate through a flat
      // card's centre and cannot describe its front hemisphere. Work in view
      // space so both the map transform and reflection cameras are respected.
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
        #include <normal_fragment_begin>
        #if defined(DOUBLE_SIDED) && !defined(FLAT_SHADED)
          normal *= faceDirection;
        #endif
        vec3 foliageUp = normalize(vFoliageUp);
        vec3 foliageView = normalize(vViewPosition);
        vec3 foliageHorizontal = foliageView - foliageUp * dot(foliageView, foliageUp);
        foliageHorizontal = length(foliageHorizontal) > .001 ? normalize(foliageHorizontal) : foliageUp;
        // Project out card depth first: both crossed cards must reconstruct
        // the same visible shell instead of introducing a bright centre seam.
        vec3 foliageProjected = vFoliageRadial - foliageHorizontal * dot(vFoliageRadial, foliageHorizontal);
        float foliageShell = sqrt(max(1.0 - dot(foliageProjected, foliageProjected), .04));
        vec3 foliageRadial = foliageProjected + foliageUp * dot(foliageProjected, foliageUp) * .35;
        vec3 foliageNormal = normalize(foliageRadial + foliageHorizontal * foliageShell);
        float foliageCrown = smoothstep(.28, .42, vFoliageVolume.w);
        normal = normalize(mix(normal, foliageNormal, foliageCrown));
        nonPerturbedNormal = normal;
      `);
      // Occlude sky fill in the lower/interior crown, retaining directional
      // shadows and the original texture's fine leaf/branch shading. Never
      // add emission or a constant light term: night stays naturally dark.
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        float foliageSkyVisibility = mix(.85, 1.0, smoothstep(-.65, .85, vFoliageVolume.y));
        reflectedLight.indirectDiffuse *= mix(1.0, foliageSkyVisibility, foliageCrown);
        reflectedLight.indirectSpecular *= mix(1.0, foliageSkyVisibility, foliageCrown);
      `);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
      // Run after weather's wetness/snow adjustments. A leaf card represents
      // many small leaves, not one smooth sheet of water. Keep broad highlights
      // in rain as well, without changing diffuse color or illumination.
      roughnessFactor = max(roughnessFactor, .72);
      #include <lights_physical_fragment>
      material.specularColor *= .3;
      material.specularF90 *= .3;
    `);
  };
  material.customProgramCacheKey = () => `${key}:foliage-lighting-v2:${kind}`;
  material.needsUpdate = true;
  return true;
}
