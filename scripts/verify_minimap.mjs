import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { collectMinimapSurfaces, createMinimap, drawMinimap, minimapSurface, minimapView } from '../src/minimap.js';
import { readMapGeometry } from './lib/readMapGeometry.mjs';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, message);
const position = { x: 25, y: -10 };
for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, -1.1289]) {
  for (const speed of [0, 30, 65, 120]) {
    const view = minimapView(position, heading, speed);
    const car = view.project(position.x, position.y);
    near(car[0], view.playerX, 'car X stays anchored');
    near(car[1], view.playerY, 'car Y stays anchored');
    const ahead = view.project(position.x - Math.sin(heading) * 100, position.y + Math.cos(heading) * 100);
    near(ahead[0], view.playerX, 'forward stays above the arrow at every heading');
    near(ahead[1], view.playerY - 100 * view.scale, '100 metre scale matches projection');
    const right = view.project(position.x + Math.cos(heading) * 100, position.y + Math.sin(heading) * 100);
    near(right[0], view.playerX + 100 * view.scale, 'right never mirrors on turns');
    near(right[1], view.playerY, 'right stays perpendicular to forward');
  }
}
assert.notDeepEqual(minimapView(position, 0).project(0, 0), minimapView({ x: 50, y: -10 }, 0).project(0, 0), 'map scrolls with the car');
assert.equal(minimapView(position, 0, 0).scale, minimapView(position, 0, -20).scale, 'negative speeds clamp');
assert.equal(minimapView(position, 0, 65).scale, minimapView(position, 0, 200).scale, 'zoom is bounded');
assert.equal(minimapSurface('ROADA_7-material'), null, 'pit garage floors do not masquerade as circuit');
assert.equal(minimapSurface('BAK_ROAD_MARKINGS_A-material'), null, 'painted decals do not invent roads');
assert.equal(minimapSurface('FENCE_CONCRETE_F_01-material'), null, 'vertical barriers are not roads');

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute([
  0, 0, 0, 10, 0, 0, 0, 10, 0,
  0, 0, 0, 0, 0, 10, 0, 10, 0,
  0, 0, 0, 0, 10, 0, 10, 0, 0,
], 3));
geometry.addGroup(0, 6, 0);
geometry.addGroup(6, 3, 1);
const transformed = new THREE.Mesh(geometry, [
  new THREE.MeshBasicMaterial({ name: 'ROADA_MAIN-material' }),
  new THREE.MeshBasicMaterial({ name: 'ROAD_OFFTRACK_A-material' }),
]);
transformed.position.set(100, 200, 2);
transformed.rotation.z = Math.PI / 2;
transformed.scale.set(2, 3, 1);
const fixture = new THREE.Group();
fixture.add(transformed);
const sample = await collectMinimapSurfaces(fixture);
assert.equal(sample.layers.circuit.length, 6, 'vertical road-labelled triangles are excluded');
assert.equal(sample.layers.road.length, 6, 'material groups keep their classification');
near(sample.bounds.minX, 70, 'world translation, rotation and scale affect bounds');
near(sample.bounds.maxX, 100, 'transformed X bound');
near(sample.bounds.minY, 200, 'transformed Y bound');
near(sample.bounds.maxY, 220, 'transformed Y extent');

// Record the atlas transform independently of the marker's projection.
const calls = [];
const context = new Proxy({}, {
  get(target, property) {
    return target[property] ?? ((...args) => calls.push({ method: property, args }));
  },
  set(target, property, value) { target[property] = value; return true; },
});
const canvas = { width: 256, height: 256, getContext: () => context };
const baked = await createMinimap(fixture, { canvasFactory: () => canvas, maxSize: 512, yieldFrame: async () => {} });
assert.ok(baked.canvas.width <= 512 && baked.canvas.height <= 512, 'atlas dimensions are bounded');
assert.equal(baked.triangleCount, 2);
for (const heading of [0, Math.PI / 2, -1.1289]) {
  calls.length = 0;
  drawMinimap(canvas, baked, { checkpoints: [] }, position, heading, 30);
  const matrix = calls.find(call => call.method === 'transform').args;
  const worldPoint = [80, 210];
  const atlasX = (worldPoint[0] - baked.bounds.minX) * baked.pixelsPerMeter;
  const atlasY = (baked.bounds.maxY - worldPoint[1]) * baked.pixelsPerMeter;
  const expected = minimapView(position, heading, 30).project(...worldPoint);
  near(matrix[0] * atlasX + matrix[2] * atlasY + matrix[4], expected[0], 'raster and car markers share the same X coordinates');
  near(matrix[1] * atlasX + matrix[3] * atlasY + matrix[5], expected[1], 'raster and car markers share the same Y coordinates');
  assert.equal(calls.filter(call => call.method === 'drawImage').length, 1, 'one cached image per frame');
}
assert.doesNotThrow(() => drawMinimap(canvas, null, null, position, 0), 'empty map and missing checkpoints are safe');
assert.equal(await createMinimap(new THREE.Group()), null, 'empty scene is safe');

function contains(x, y, triangles) {
  for (let i = 0; i < triangles.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = triangles.slice(i, i + 6);
    const ab = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const bc = (cx - bx) * (y - by) - (cy - by) * (x - bx);
    const ca = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
    if (ab >= -1e-5 && bc >= -1e-5 && ca >= -1e-5) return true;
  }
  return false;
}
const root = new THREE.Group();
root.add(...readMapGeometry('baku', name => Boolean(minimapSurface(name))));
const { layers, bounds } = await collectMinimapSurfaces(root);
const route = JSON.parse(readFileSync(new URL('../public/generated/route.json', import.meta.url)));
assert.ok(layers.circuit.length / 6 > 40000, 'use the real circuit geometry');
assert.ok(bounds.maxX - bounds.minX < 3000, 'distant water does not inflate road bounds');
route.checkpoints.forEach((point, index) => {
  assert.ok(contains(point[0], point[1], layers.circuit), `checkpoint ${index + 1} lies on the real circuit`);
});
assert.ok(contains(route.spawn[0], route.spawn[1], [...layers.circuit, ...layers.road]), 'spawn lies on a mapped road');
let falseShortcuts = 0;
for (let i = 0; i < route.checkpoints.length; i++) {
  const a = route.checkpoints[i], b = route.checkpoints[(i + 1) % route.checkpoints.length];
  if (!contains((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, layers.circuit)) falseShortcuts++;
}
assert.ok(falseShortcuts >= 3, 'real geometry avoids shortcuts in the old checkpoint polygon');
console.log(`Minimap verified: all 14 checkpoints aligned, ${falseShortcuts} old shortcuts removed, world transforms, heading, scale and cached rendering passed.`);
