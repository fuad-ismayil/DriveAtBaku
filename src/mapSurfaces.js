// Exact map families: a pale material is not automatically a road. Paving,
// architecture, faded traffic paint and green-area artwork stay unchanged.
export const ASPHALT_MATERIALS = new Set([
  'ROADA_MAIN-material','ROAD_OFFTRACK_A-material','ROAD_OFFTRACK_B-material',
  'BAK_OFFTRACK_B-material','ROAD_AZER-material',
]);

// These visible ground families have no counterpart in the original seven
// surviving collision meshes. Existing road/cobble/pavement-A data stays primary.
const TERRAIN = new Set([
  'BAK_LANDSCAPE_A-material','BAK_LANDSCAPE_B-material','BAK_GRASS_A-material',
  'BAK_TREE_BASE_A-material','BAK_TREE_BASE_B-material',
  'BAK_GRASS_BRICK-material','BAK_GRASS_BRIDGE-material',
]);
const PAVING = new Set([
  'BAK_KERB_A-material','BAK_PAVEMENT_B-material','BAK_PAVEMENT_C-material',
  'BAK_PAVEMENT_D-material','BAK_CONCRETE_A-material','BAK_BUILDINGS_A-material',
  'BAK_BUILDING_HIGH_19_A_01-material',
]);
// The source collision export omits these legitimate road-paint/inlay groups.
// Some fill small cutouts in the road mesh rather than simply overlaying it.
const ROAD_INLAYS = new Set([
  'MARKINGS_A-material','MARKINGS_B-material','MARKINGS_C-material',
  'BAK_ROAD_MARKINGS_A-material','BAK_ROAD_MARKINGS_B-material',
  'ROAD_MARKINGS_C-material','BAK_YELLOWLINE-material','BAK_MANHOLES_A-material',
]);
export function additionalGroundKind(name) {
  return TERRAIN.has(name)?'terrain':PAVING.has(name)?'pavement':ROAD_INLAYS.has(name)?'roadpaint':null;
}
