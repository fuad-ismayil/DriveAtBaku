import * as THREE from 'three';

// CMWL/CMWLA and TWALL are the supplied track's concrete-wall material families.
export function isTrackBoundaryMaterial(name = '') {
  return /(?:^|[_\s-])(?:fence|barrier|pitwall|armco|twall|cmwla?|conc_bollard)(?:[_\s-]|$)/i.test(name);
}

export function isTrackBoundary(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some(material => isTrackBoundaryMaterial(material.name));
}

export function createShadowCandidate(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const boundary = isTrackBoundary(mesh);
  if (!boundary && !materials.some(material => /tree|hedge|building|wall|fence/i.test(material.name))) return null;
  if (materials.every(material => material.transparent && material.alphaTest === 0)) return null;
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  // Spatial chunks now give large building batches local bounds. Their source
  // size must not exclude facade shadows near the car.
  return { mesh, bounds };
}

export function updateShadowCandidates(candidates, position, distance = 150) {
  for (const candidate of candidates) candidate.mesh.castShadow = candidate.bounds.distanceToPoint(position) < distance;
}
