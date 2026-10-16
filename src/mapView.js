import presentation from '../shared/ui-spec.json' with { type: 'json' };
export const MAP_SIZE = presentation.minimap.diameter - presentation.minimap.inset * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const markerAngle = (vehicleHeading, cameraHeading = 0) => cameraHeading - vehicleHeading;
export function minimapView(position, cameraHeading, speedMps = 0, size = MAP_SIZE) {
  const center = size / 2, radius = center - 1;
  const scale = (0.42 + (0.29 - 0.42) * clamp(speedMps / 65, 0, 1)) * size / 240;
  const cosine = Math.cos(cameraHeading), sine = Math.sin(cameraHeading);
  return { center, radius, scale, playerX: center, playerY: center, cosine, sine,
    project(x, y) { const dx = x - position.x, dy = y - position.y;
      return [center + (dx * cosine + dy * sine) * scale, center + (dx * sine - dy * cosine) * scale]; } };
}
function marker(ctx, x, y, angle, color, size = 8, halo = false) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  if (halo) { ctx.fillStyle = '#70ede629'; ctx.beginPath(); ctx.arc(0, 0, size * 1.8, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = color; ctx.strokeStyle = '#071722'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * .69, size * .77); ctx.lineTo(0, size * .38); ctx.lineTo(-size * .69, size * .77); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}
export function drawMinimap(canvas, map, position, heading, speedMps = 0, players = [], cameraHeading = heading) {
  const ctx = canvas.getContext('2d'), dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pixels = Math.round(MAP_SIZE * dpr);
  if (canvas.width !== pixels || canvas.height !== pixels) canvas.width = canvas.height = pixels;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
  const view = minimapView(position, cameraHeading, speedMps), { center, radius, cosine, sine } = view;
  ctx.save(); ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = '#0c202b'; ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  if (map) { const factor = view.scale / map.pixelsPerMeter, [x, y] = view.project(map.bounds.minX, map.bounds.maxY);
    ctx.save(); ctx.transform(cosine * factor, sine * factor, -sine * factor, cosine * factor, x, y); ctx.drawImage(map.canvas, 0, 0); ctx.restore(); }
  for (const peer of players || []) { if (!peer?.position) continue; const [x, y] = view.project(peer.position.x, peer.position.y);
    if (Math.hypot(x - center, y - center) < radius - 6) marker(ctx, x, y, markerAngle(peer.heading || 0, cameraHeading), '#f4c56a', 6.5); }
  marker(ctx, center, center, markerAngle(heading, cameraHeading), '#ffffff', 8.45, true);
  ctx.font = '12px Segoe UI, sans-serif'; ctx.fillStyle = '#c9e2e7'; ctx.textAlign = 'center';
  const northRadius = radius - 13; ctx.fillText('N', center + sine * northRadius, center - cosine * northRadius + 4);
  ctx.restore(); ctx.strokeStyle = '#b9e6eb52'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
}
export class MapNavigation {
  zoom = 1; pan = { x: 0, y: 0 };
  reset() { this.zoom = 1; this.pan = { x: 0, y: 0 }; }
  zoomBy(factor) { const before = this.zoom; this.zoom = clamp(before * factor, 1, 6); this.pan.x *= this.zoom / before; this.pan.y *= this.zoom / before; }
  view(width, height, bounds) {
    const scale = Math.min((width - 48) / (bounds.maxX - bounds.minX), (height - 48) / (bounds.maxY - bounds.minY)) * this.zoom;
    const midX = (bounds.minX + bounds.maxX) / 2, midY = (bounds.minY + bounds.maxY) / 2;
    this.pan.x = clamp(this.pan.x, -(bounds.maxX - bounds.minX) * scale / 2, (bounds.maxX - bounds.minX) * scale / 2);
    this.pan.y = clamp(this.pan.y, -(bounds.maxY - bounds.minY) * scale / 2, (bounds.maxY - bounds.minY) * scale / 2);
    return { scale, project: point => [width / 2 + (point.x - midX) * scale + this.pan.x, height / 2 - (point.y - midY) * scale + this.pan.y] };
  }
  locate(point, width, height, bounds) { if (!point || !bounds) return; this.zoom = Math.max(this.zoom, 3); this.pan = { x: 0, y: 0 }; const [x, y] = this.view(width, height, bounds).project(point); this.pan = { x: width / 2 - x, y: height / 2 - y }; }
}
export function drawFullMap(canvas, map, localPlayer, players = [], navigation = new MapNavigation()) {
  if (!canvas || !map) return;
  const ctx = canvas.getContext('2d'), width = canvas.clientWidth || 760, height = canvas.clientHeight || 560, dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#0c202b'; ctx.fillRect(0, 0, width, height);
  const view = navigation.view(width, height, map.bounds), [x, y] = view.project({ x: map.bounds.minX, y: map.bounds.maxY });
  ctx.drawImage(map.canvas, x, y, (map.bounds.maxX - map.bounds.minX) * view.scale, (map.bounds.maxY - map.bounds.minY) * view.scale);
  for (const peer of [...(players || []), ...(localPlayer ? [{ ...localPlayer, color: '#ffffff', local: true }] : [])]) {
    if (!peer?.position) continue; const [px, py] = view.project(peer.position); if (px < 12 || py < 12 || px > width - 12 || py > height - 12) continue;
    marker(ctx, px, py, markerAngle(peer.heading || 0), peer.color || '#f4c56a', 13, peer.local);
    if (peer.local) { ctx.fillStyle = 'white'; ctx.font = '18px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('YOU', px, py - 23); }
  }
  ctx.fillStyle = '#c9e2e7'; ctx.textAlign = 'left'; ctx.font = '20px Segoe UI, sans-serif'; ctx.fillText('N ↑', 16, 29);
  const metres = navigation.zoom > 2 ? 100 : 500, bar = metres * view.scale;
  ctx.font = '16px Segoe UI, sans-serif'; ctx.fillText(`${metres} m`, 18, height - 32); ctx.strokeStyle = '#c9e2e7'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(18, height - 22); ctx.lineTo(18 + bar, height - 22); for (const bx of [18, 18 + bar]) { ctx.moveTo(bx, height - 26); ctx.lineTo(bx, height - 18); } ctx.stroke();
}
export function installMapGestures(canvas, navigation, redraw) {
  const pointers = new Map();
  canvas.addEventListener('wheel', event => { event.preventDefault(); navigation.zoomBy(event.deltaY < 0 ? 1.25 : .8); redraw(); }, { passive: false });
  canvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); });
  canvas.addEventListener('pointermove', event => { const before = pointers.get(event.pointerId); if (!before) return; const point = { x: event.clientX, y: event.clientY };
    if (pointers.size === 2) { const other = [...pointers].find(([id]) => id !== event.pointerId)[1]; const distance = Math.hypot(before.x - other.x, before.y - other.y); if (distance > 12) navigation.zoomBy(Math.hypot(point.x - other.x, point.y - other.y) / distance); }
    else { navigation.pan.x += point.x - before.x; navigation.pan.y += point.y - before.y; } pointers.set(event.pointerId, point); redraw(); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => pointers.delete(event.pointerId));
}
