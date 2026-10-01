import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync, statSync } from 'node:fs';
import { fetchAssetBytes } from '../src/assetTransfer.js';

const payload = Buffer.alloc(8192, 37);
const server = createServer((request, response) => {
  if (request.url === '/missing') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, request.url === '/unknown' ? {} : { 'Content-Length': payload.length });
  let offset = 0;
  const send = () => {
    if (response.destroyed) return;
    if (offset === payload.length) { response.end(); return; }
    response.write(payload.subarray(offset, offset += 1024));
    setTimeout(send, 12);
  };
  send();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const progress = [];
  const bytes = await fetchAssetBytes(`${origin}/known`, event => progress.push(event));
  assert.deepEqual(Buffer.from(bytes), payload, 'incremental reading preserves all asset bytes');
  assert.ok(progress.some(event => event.loaded > 0 && event.loaded < payload.length), 'progress arrives before the download completes');
  assert.ok(progress.every((event, index) => !index || event.loaded >= progress[index - 1].loaded), 'received bytes never go backwards');
  assert.ok(progress.slice(0, -1).every(event => event.total === payload.length), 'content length supplies real totals');
  assert.deepEqual(progress.at(-1), { loaded: payload.length, total: payload.length, complete: true });
  const unknown = [];
  await fetchAssetBytes(`${origin}/unknown`, event => unknown.push(event));
  assert.ok(unknown.slice(0, -1).every(event => event.total === 0), 'unknown sizes stay unknown until EOF');
  assert.equal(unknown.at(-1).total, payload.length);
  const planned = [];
  await fetchAssetBytes(`${origin}/unknown`, event => planned.push(event), { expectedBytes: payload.length });
  assert.equal(planned[0].total, payload.length, 'manifest sizes work without content length');
  await assert.rejects(fetchAssetBytes(`${origin}/missing`), /404/, 'HTTP failures reject rather than claim completion');
  const controller = new AbortController();
  await assert.rejects(fetchAssetBytes(`${origin}/known`, event => {
    if (event.loaded < payload.length) controller.abort();
  }, { signal: controller.signal }), error => error.name === 'AbortError', 'interrupted transfers can be cancelled');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public/generated/asset-manifest.json', root), 'utf8'));
for (const [file, bytes] of Object.entries(manifest.files)) assert.equal(statSync(new URL(`public${file}`, root)).size, bytes, `accurate size for ${file}`);
for (const asset of Object.values(manifest.assets)) {
  const size = asset.parts.reduce((sum, file) => sum + statSync(new URL(`public/generated/${file}`, root)).size, 0);
  assert.equal(size, asset.compressedBytes, 'map progress matches packed files on disk');
}
for (const scene of ['city', 'night', 'weather', 'garage']) assert.ok(statSync(new URL(`public/assets/loading/${scene}.webp`, root)).size < 350000, 'scene artwork remains lightweight');
console.log('Loading verification passed: streamed progress, unknown sizes, cancellation, HTTP errors, manifest sizes, and artwork budget.');
