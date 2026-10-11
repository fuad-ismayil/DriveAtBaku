// These are the leaf/canopy materials in the supplied map. Tree bases and
// decorative tree lights have their own surface normals and are left alone.
export function foliageKind(name = '') {
  if (/^TREEC(?:-material)?$/i.test(name)) return 'canopy';
  if (/^BAK_FEATURE_P_HEDGES_A_01(?:-material)?$/i.test(name)) return 'hedge';
  return null;
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
      // TREEC has authored upward canopy normals, perpendicular to its crossed
      // cards. Adjacent triangles sometimes have opposite winding. Undo Three's
      // face flip only for this material: winding must not invert canopy lighting.
      // Keep the imported normal variation and its model/view transformations.
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
        #include <normal_fragment_begin>
        #if defined(DOUBLE_SIDED) && !defined(FLAT_SHADED)
          normal *= faceDirection;
          nonPerturbedNormal = normal;
        #endif
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
  material.customProgramCacheKey = () => `${key}:foliage-lighting-v1:${kind}`;
  material.needsUpdate = true;
  return true;
}
