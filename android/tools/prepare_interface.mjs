import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

// Reuse the web's original in-game captures; never download startup artwork.
mkdirSync('android/game/assets/ui', { recursive: true });
for (const scene of ['city', 'night']) {
  await sharp(`public/assets/loading/${scene}.webp`)
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(`android/game/assets/ui/${scene}.webp`);
}
console.log('Native interface: two packaged city captures prepared.');
