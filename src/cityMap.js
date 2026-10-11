import audit from './cityMapAudit.json' with { type: 'json' };
import collisionAudit from './cityCollisionAudit.json' with { type: 'json' };
import * as THREE from 'three';
import { ASPHALT_MATERIALS } from './mapSurfaces.js';

// This allowlist is specific to the supplied map, audited against its Collada
// material bindings, diffuse textures, UVs and placement. Names such as ROAD,
// BUILDING, FENCE or FLAG alone are deliberately not removal rules.
export function isEventMaterial(asset, name) {
  return Object.hasOwn(audit[asset] ?? {}, name);
}

function triangleCount(json, primitive) {
  return json.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
}

function validateEventCollision(json, mesh, node, expected) {
  const primitive = mesh.primitives[0], position = json.accessors[primitive.attributes.POSITION];
  if (mesh.primitives.length !== 1 || position.count !== expected.vertices
    || json.materials[primitive.material]?.name !== 'collision'
    || JSON.stringify(position.min) !== JSON.stringify(expected.min)
    || JSON.stringify(position.max) !== JSON.stringify(expected.max)
    || JSON.stringify(node.matrix) !== JSON.stringify(expected.matrix)) {
    throw new Error('City collision enclosure no longer matches the audited bounds and transform.');
  }
}

export function filterCityMapDocument(json, asset) {
  const expected = audit[asset];
  const report = { asset, removedPrimitives: 0, removedTriangles: 0, materials: [], roadRepairSources: [] };
  if (!expected && asset !== 'collision') return report;
  const excluded = new Set();
  for (const [id, node] of json.nodes.entries()) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh];
    // Collision conversion erases material names. Exact source bindings and
    // bounds identify the race strips and both invisible circuit enclosures.
    const eventCollision = asset === 'collision' ? collisionAudit[node.name] : null;
    if (eventCollision) validateEventCollision(json, mesh, node, eventCollision);
    const kept = [];
    for (const primitive of mesh.primitives) {
      const name = json.materials?.[primitive.material]?.name ?? '';
      if (!eventCollision && !isEventMaterial(asset, name)) { kept.push(primitive); continue; }
      const triangles = triangleCount(json, primitive);
      if (triangles !== (eventCollision ? eventCollision.triangles : expected[name])) {
        throw new Error(`City map audit no longer matches ${asset}/${node.name}/${name}; inspect the new asset before removing geometry.`);
      }
      report.removedPrimitives++;
      report.removedTriangles += triangles;
      report.materials.push(eventCollision ? node.name : name);
      if (asset === 'baku' && ['RMBL-material','POLICE-material','sochi_saussage-material','ROADOR-material','WHITELINE_A-material'].includes(name)) {
        report.roadRepairSources.push({ primitive, matrix: node.matrix, name });
      }
    }
    if (kept.length === mesh.primitives.length) continue;
    if (kept.length) {
      // A shared or mixed mesh keeps its ordinary city primitives and every
      // original accessor/buffer byte. Never edit shared material visibility.
      node.mesh = json.meshes.push({ ...mesh, primitives: kept }) - 1;
    } else {
      delete node.mesh;
      if (!node.children?.length && !json.animations?.length) excluded.add(id);
    }
  }
  for (const scene of json.scenes) scene.nodes = scene.nodes.filter(id => !excluded.has(id));
  for (const node of json.nodes) if (node.children) node.children = node.children.filter(id => !excluded.has(id));
  if (asset === 'baku') {
    // ROAD_AZER is the flag-painted racing runoff, not the driving asphalt.
    // Keep every road vertex, but reuse the existing street asphalt texture.
    const runoff = json.materials.find(material => material.name === 'ROAD_AZER-material');
    const asphalt = json.materials.find(material => material.name === 'ROADA_MAIN-material');
    if (!runoff || !asphalt?.pbrMetallicRoughness?.baseColorTexture) throw new Error('City asphalt binding no longer matches the audited map.');
    for(const material of json.materials) if(ASPHALT_MATERIALS.has(material.name)) {
      material.pbrMetallicRoughness.baseColorTexture = { ...asphalt.pbrMetallicRoughness.baseColorTexture };
    }
    report.neutralRoadPaint = runoff.name;
  }
  return report;
}

// GLTFLoader calls beforeRoot before loading scene dependencies, so excluded
// event meshes and their textures are never decoded/uploaded or registered with
// shadows, reflections, occlusion or physics. The packed assets are unchanged.
export function createCityMapPlugin(parser, asset) {
  let report;
  return {
    name: 'BAKU_city_streets',
    beforeRoot() { report = filterCityMapDocument(parser.json, asset); },
    async afterRoot(result) {
      result.userData.cityMap = report;
      if (asset !== 'baku') return;
      result.userData.roadRepairSources = await Promise.all(report.roadRepairSources.map(async ({primitive,matrix,name}) => {
        // Decode only position/index accessors for gap repair. No race material,
        // texture, draw object or old collision is reintroduced.
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', await parser.getDependency('accessor',primitive.attributes.POSITION));
        geometry.setIndex((await parser.getDependency('accessor',primitive.indices)).clone());
        const mesh = new THREE.Mesh(geometry); mesh.name = name; mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(matrix); mesh.matrixWorld.copy(mesh.matrix);
        return mesh;
      }));
    },
  };
}
