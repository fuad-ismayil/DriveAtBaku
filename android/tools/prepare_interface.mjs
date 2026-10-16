import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import * as THREE from 'three';
import { collectMinimapSurfaces, minimapSurface } from '../../src/minimap.js';
import { readMapGeometry } from '../../scripts/lib/readMapGeometry.mjs';

// Reuse the web's original in-game captures; never download startup artwork.
mkdirSync('android/game/assets/ui', { recursive: true });
copyFileSync('public/assets/fonts/AlteDIN1451-Regular.ttf', 'android/game/assets/ui/plate-din.ttf');
copyFileSync('public/branding/wordmark.svg', 'android/game/assets/ui/wordmark.svg');
copyFileSync('shared/ui-spec.json', 'android/game/assets/data/ui-spec.json');
copyFileSync('public/assets/fonts/AlteDIN1451-Pressed.ttf', 'android/game/assets/ui/plate-din-bold.ttf');
for (const scene of ['city', 'night', 'weather', 'garage']) {
  await sharp(`public/assets/loading/${scene}.webp`)
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(`android/game/assets/ui/${scene}.webp`);
}
console.log('Native interface: four packaged city captures prepared.');

// Bake the exact same street layers as the web map at build time. On-device
// rendering needs just one shared texture, never another copy of city geometry.
const root = new THREE.Group();
root.add(...readMapGeometry('baku', name => Boolean(minimapSurface(name)), { city: true }));
const { layers, bounds } = await collectMinimapSurfaces(root);
for (const key of ['minX', 'minY']) bounds[key] -= 450;
for (const key of ['maxX', 'maxY']) bounds[key] += 450;
const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
const factor = 2048 / Math.max(width, height);
const colors = { water: '#0d3042', land: '#172e38', grass: '#20443e', pavement: '#30464f', road: '#6c8790' };
const paths = Object.entries(colors).map(([layer, color]) => {
  const triangles = layers[layer];
  const paths = [];
  for (let i = 0; i < triangles.length; i += 6) {
    const p = [];
    for (let j = 0; j < 6; j += 2) p.push(`${((triangles[i + j] - bounds.minX) * factor).toFixed(2)},${((bounds.maxY - triangles[i + j + 1]) * factor).toFixed(2)}`);
    paths.push(`M${p[0]}L${p[1]}L${p[2]}Z`);
  }
  return `<path fill="${color}" d="${paths.join('')}"/>`;
});
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width * factor)}" height="${Math.ceil(height * factor)}"><rect width="100%" height="100%" fill="#0c202b"/>${paths.join('')}</svg>`))
  .webp({ lossless: true }).toFile('android/game/assets/ui/map.webp');
writeFileSync('android/game/assets/ui/map.json', JSON.stringify({ bounds, roadTriangles: layers.road.length / 6 }));
console.log(`Native map: ${layers.road.length / 6} real street triangles baked to a shared 2048px atlas.`);
