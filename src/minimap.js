import * as THREE from 'three';

const MAP_SIZE = 256;
const COLORS = {
  water: '#0d3042', land: '#172e38', grass: '#20443e',
  pavement: '#30464f', road: '#536b74', circuit: '#98e0e3',
};
const LAYERS = Object.keys(COLORS);

export function minimapSurface(name = '') {
  // Numbered ROADA materials belong to pit garages, not the circuit surface.
  if (/^(?:ROADA_MAIN|ROAD_AZER)(?:-|$)/i.test(name)) return 'circuit';
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
          if (layer === 'circuit' || layer === 'road') {
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

export function minimapView(position, heading, speedMps = 0, size = MAP_SIZE) {
  const center = size / 2, radius = center - 9 * size / MAP_SIZE;
  const scale = THREE.MathUtils.lerp(0.52, 0.32, THREE.MathUtils.clamp(speedMps / 65, 0, 1)) * size / MAP_SIZE;
  const playerX = center, playerY = center + radius * 0.28;
  const cosine = Math.cos(heading), sine = Math.sin(heading);
  return {
    center, radius, scale, playerX, playerY, cosine, sine,
    project(x, y) {
      const dx = x - position.x, dy = y - position.y;
      return [playerX + (dx * cosine + dy * sine) * scale, playerY + (dx * sine - dy * cosine) * scale];
    },
  };
}

function drawRemoteMarkers(context, view, players, radius, label = false) {
  if (!players?.length) return;
  for (const player of players) {
    if (!player?.position) continue;
    const [x, y] = view.project(player.position.x, player.position.y);
    if (Math.hypot(x - view.center, y - view.center) > radius - 8) continue;
    context.save();
    context.translate(x, y);
    context.rotate(player.heading ?? 0);
    context.fillStyle = player.color || '#f4c56a';
    context.strokeStyle = '#071722';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, -6); context.lineTo(-4.5, 5); context.lineTo(4.5, 5);
    context.closePath(); context.fill(); context.stroke();
    context.restore();
    if (label) {
      context.fillStyle = '#f5fbfc'; context.font = '700 11px sans-serif'; context.textAlign = 'center';
      context.fillText(player.nick || 'PLAYER', x, y - 10);
    }
  }
}

export function drawMinimap(canvas, map, route, position, heading, speedMps = 0, players = []) {
  const context = canvas.getContext('2d');
  const pixelRatio = Math.min(globalThis.devicePixelRatio ?? 1, 2);
  const resolution = Math.round(MAP_SIZE * pixelRatio);
  if (canvas.width !== resolution || canvas.height !== resolution) canvas.width = canvas.height = resolution;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
  const view = minimapView(position, heading, speedMps);
  const { center, radius, scale, playerX, playerY, cosine, sine } = view;
  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = '#0c202b';
  context.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

  if (map) {
    const factor = scale / map.pixelsPerMeter;
    const [originX, originY] = view.project(map.bounds.minX, map.bounds.maxY);
    context.save();
    // Atlas Y is downward; this is the same projection used for every marker.
    context.transform(cosine * factor, sine * factor, -sine * factor, cosine * factor, originX, originY);
    context.drawImage(map.canvas, 0, 0);
    context.restore();
  }

  const start = route?.checkpoints?.[0];
  if (start) {
    const [x, y] = view.project(start[0], start[1]);
    if (Math.hypot(x - center, y - center) < radius - 12 && Math.hypot(x - playerX, y - playerY) > 24) {
      context.fillStyle = '#0a1b24';
      context.fillRect(x - 7, y - 7, 14, 14);
      context.fillStyle = '#fff2d4';
      for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
        if ((row + col) % 2 === 0) context.fillRect(x - 5 + col * 5, y - 5 + row * 5, 5, 5);
      }
    }
  }

  drawRemoteMarkers(context, view, players, radius);

  context.save();
  context.translate(playerX, playerY);
  context.fillStyle = 'rgba(142, 231, 234, 0.12)';
  context.beginPath();
  context.moveTo(0, -5); context.lineTo(-19, -38); context.lineTo(19, -38);
  context.closePath(); context.fill();
  context.shadowColor = '#06131d'; context.shadowBlur = 5;
  context.fillStyle = '#ffffff'; context.strokeStyle = '#0a2834'; context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(0, -10); context.lineTo(-7, 8); context.lineTo(0, 4); context.lineTo(7, 8);
  context.closePath(); context.stroke(); context.fill();
  context.restore();

  const barWidth = 100 * scale, barY = center + radius - 25;
  context.fillStyle = 'rgba(6, 19, 29, 0.85)';
  context.fillRect(center - barWidth / 2 - 8, barY - 17, barWidth + 16, 29);
  context.strokeStyle = '#c9e2e7'; context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(center - barWidth / 2, barY - 3); context.lineTo(center - barWidth / 2, barY + 3);
  context.moveTo(center - barWidth / 2, barY); context.lineTo(center + barWidth / 2, barY);
  context.moveTo(center + barWidth / 2, barY - 3); context.lineTo(center + barWidth / 2, barY + 3);
  context.stroke();
  context.fillStyle = '#c9e2e7'; context.font = '600 9px sans-serif'; context.textAlign = 'center';
  context.fillText('100 m', center, barY - 7);
  context.restore();
  context.strokeStyle = 'rgba(172, 224, 229, 0.35)'; context.lineWidth = 1;
  context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2); context.stroke();
}

// The full map deliberately uses the cached map atlas rather than rebuilding
// world geometry, so it remains responsive with a room full of drivers.
export function drawFullMap(canvas, map, localPlayer, players = []) {
  if (!canvas || !map) return;
  const context = canvas.getContext('2d');
  const cssWidth = canvas.clientWidth || 760, cssHeight = canvas.clientHeight || 560;
  const pixelRatio = Math.min(globalThis.devicePixelRatio ?? 1, 2);
  const width = Math.round(cssWidth * pixelRatio), height = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = '#071923'; context.fillRect(0, 0, cssWidth, cssHeight);
  const pad = 26, mapWidth = map.bounds.maxX - map.bounds.minX, mapHeight = map.bounds.maxY - map.bounds.minY;
  const scale = Math.min((cssWidth - pad * 2) / mapWidth, (cssHeight - pad * 2) / mapHeight);
  const drawWidth = mapWidth * scale, drawHeight = mapHeight * scale;
  const originX = (cssWidth - drawWidth) / 2, originY = (cssHeight - drawHeight) / 2;
  context.drawImage(map.canvas, originX, originY, drawWidth, drawHeight);
  const project = point => [originX + (point.x - map.bounds.minX) * scale, originY + (map.bounds.maxY - point.y) * scale];
  const all = [...players, { ...localPlayer, color: '#ffffff', nick: 'YOU' }];
  for (const player of all) {
    if (!player?.position) continue;
    const [x, y] = project(player.position);
    context.save(); context.translate(x, y); context.rotate(player.heading ?? 0);
    context.fillStyle = player.color || '#f4c56a'; context.strokeStyle = '#071722'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(0, -8); context.lineTo(-5.5, 6); context.lineTo(5.5, 6); context.closePath(); context.fill(); context.stroke();
    context.restore();
    context.fillStyle = '#ffffff'; context.font = '700 11px sans-serif'; context.textAlign = 'center';
    context.fillText(player.nick || 'PLAYER', x, y - 12);
  }
}
