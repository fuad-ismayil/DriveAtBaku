import * as THREE from 'three';

const MAP_SIZE = 256;
const COLORS = {
  water: '#0d3042', land: '#172e38', grass: '#20443e',
  pavement: '#30464f', road: '#6c8790',
};
const LAYERS = Object.keys(COLORS);

export function minimapSurface(name = '') {
  // Former circuit asphalt is an ordinary street; numbered ROADA floors are garages.
  if (/^(?:ROADA_MAIN|ROAD_AZER)(?:-|$)/i.test(name)) return 'road';
  if (/^ROAD_OFFTRACK_[AB](?:-|$)/i.test(name)) return 'road';
  if (/^BAK_PAVEMENT_[ABCD](?:-|$)/i.test(name)) return 'pavement';
  if (/^BAK_COBBLES_A(?:-|$)/i.test(name)) return 'land';
  if (/^BAK_GRASS_A(?:-|$)/i.test(name)) return 'grass';
  if (/^BAK_WATER_[ABC](?:-|$)/i.test(name)) return 'water';
  return null;
}

// Read the original meshes before render partitioning/culling changes them.
// World transforms are essential: the GLB's local coordinates are not Z-up.
export async function collectMinimapSurfaces(root, yieldFrame = async () => {}) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse(object => { if (object.isMesh) meshes.push(object); });
  const layers = Object.fromEntries(LAYERS.map(layer => [layer, []]));
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  let visited = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry, positions = geometry.getAttribute('position'), index = geometry.index;
    if (!positions) continue;
    const count = index?.count ?? positions.count;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      const layer = minimapSurface(materials[group.materialIndex]?.name);
      if (!layer) continue;
      const end = Math.min(group.start + group.count, count);
      for (let i = group.start; i + 2 < end; i += 3) {
        a.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        // Drop vertical walls and degenerate faces; retain the old-city slopes.
        if (Math.abs(normal.z) > 1e-7 && Math.abs(normal.z) >= normal.length() * 0.55) {
          // Consistent winding lets adjacent triangles form a solid canvas path.
          if (normal.z < 0) layers[layer].push(a.x, a.y, c.x, c.y, b.x, b.y);
          else layers[layer].push(a.x, a.y, b.x, b.y, c.x, c.y);
          if (layer === 'road') {
            bounds.minX = Math.min(bounds.minX, a.x, b.x, c.x);
            bounds.minY = Math.min(bounds.minY, a.y, b.y, c.y);
            bounds.maxX = Math.max(bounds.maxX, a.x, b.x, c.x);
            bounds.maxY = Math.max(bounds.maxY, a.y, b.y, c.y);
          }
        }
        if (++visited % 8192 === 0) await yieldFrame();
      }
    }
  }
  return { layers, bounds };
}

export async function createMinimap(root, {
  canvasFactory = () => document.createElement('canvas'),
  yieldFrame = () => new Promise(resolve => requestAnimationFrame(resolve)),
  maxSize = 4096,
} = {}) {
  const { layers, bounds } = await collectMinimapSurfaces(root, yieldFrame);
  if (!Number.isFinite(bounds.minX)) return null;
  // Context around the playable streets without wasting resolution on distant sea.
  const padding = 450;
  bounds.minX -= padding; bounds.minY -= padding;
  bounds.maxX += padding; bounds.maxY += padding;
  const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  const pixelsPerMeter = Math.min(1.5, maxSize / Math.max(width, height));
  const canvas = canvasFactory();
  canvas.width = Math.ceil(width * pixelsPerMeter);
  canvas.height = Math.ceil(height * pixelsPerMeter);
  const context = canvas.getContext('2d');
  let triangleCount = 0;
  for (const layer of LAYERS) {
    const triangles = layers[layer];
    context.fillStyle = COLORS[layer];
    for (let start = 0; start < triangles.length; start += 6 * 4096) {
      context.beginPath();
      const end = Math.min(start + 6 * 4096, triangles.length);
      for (let i = start; i < end; i += 6) {
        context.moveTo((triangles[i] - bounds.minX) * pixelsPerMeter, (bounds.maxY - triangles[i + 1]) * pixelsPerMeter);
        context.lineTo((triangles[i + 2] - bounds.minX) * pixelsPerMeter, (bounds.maxY - triangles[i + 3]) * pixelsPerMeter);
        context.lineTo((triangles[i + 4] - bounds.minX) * pixelsPerMeter, (bounds.maxY - triangles[i + 5]) * pixelsPerMeter);
        context.closePath();
      }
      context.fill();
      triangleCount += (end - start) / 6;
      await yieldFrame();
    }
  }
  // Only the baked image survives; no map geometry is redrawn each frame.
  return { canvas, bounds, pixelsPerMeter, triangleCount };
}

export { minimapView, drawMinimap, drawFullMap } from "./mapView.js";
