import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'public', 'generated');
const partSize = 48 * 1024 * 1024;
const clean = process.argv.includes('--clean');
const assets = {};

for (const name of ['baku', 'buildings']) {
  const source = join(output, `${name}.glb`);
  if (!existsSync(source)) throw new Error(`Missing ${source}. Run npm run convert-map first.`);
  const raw = readFileSync(source);
  const zipped = gzipSync(raw, { level: 9 });
  if (!gunzipSync(zipped).equals(raw)) throw new Error(`Compression check failed for ${name}.`);
  const parts = [];
  for (let offset = 0; offset < zipped.length; offset += partSize) {
    const filename = `${name}.glb.gz.part${parts.length}`;
    writeFileSync(join(output, filename), zipped.subarray(offset, offset + partSize));
    parts.push(filename);
  }
  assets[name] = { encoding: 'gzip', originalBytes: raw.length, compressedBytes: zipped.length, parts };
  console.log(`${name}: ${(raw.length / 1048576).toFixed(1)} MiB → ${parts.length} upload-safe parts (${(zipped.length / 1048576).toFixed(1)} MiB total)`);
}

writeFileSync(join(output, 'asset-manifest.json'), JSON.stringify({ assets }, null, 2) + '\n');
const currentParts = new Set(Object.values(assets).flatMap(asset => asset.parts));
for (const filename of readdirSync(output)) {
  if (/^(baku|buildings)\.glb\.gz\.part\d+$/.test(filename) && !currentParts.has(filename)) {
    unlinkSync(join(output, filename));
  }
}
if (clean) {
  for (const name of Object.keys(assets)) unlinkSync(join(output, `${name}.glb`));
  const textures = join(output, 'textures');
  if (existsSync(textures)) rmSync(textures, { recursive: true, force: true });
  console.log('Removed unpacked GLBs and standalone conversion textures after verifying the packed copies.');
}
