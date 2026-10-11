import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); }
catch {
  const packages = process.env.IMAGE_MODULES ?? `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`;
  sharp = require(`${packages}/sharp`);
}
const before = resolve(process.argv[2] ?? 'artifacts/performance/before-final');
const after = resolve(process.argv[3] ?? 'artifacts/performance/after-final');
const oldResults = JSON.parse(readFileSync(`${before}/results.json`));
const newResults = JSON.parse(readFileSync(`${after}/results.json`));
assert.deepEqual(newResults.errors, []);
assert.equal(newResults.hardware.renderer, oldResults.hardware.renderer);
const timings = oldResults.scenarios.map(old => {
  const next = newResults.scenarios.find(result => result.scenario === old.scenario);
  if (!next && process.env.VISUALS) return null;
  assert.deepEqual(next.graphics, old.graphics, 'all graphics settings stay identical');
  assert.equal(next.world.triangles, old.world.triangles);
  return { scenario: old.scenario,
    beforeFPS: 1000/old.metrics.interval.median, afterFPS: 1000/next.metrics.interval.median,
    beforeP95: old.metrics.interval.p95, afterP95: next.metrics.interval.p95,
    beforeGPU: old.metrics.gpu?.median, afterGPU: next.metrics.gpu?.median,
    releasedMiB: next.world.releasedCPUBytes/1048576 };
}).filter(Boolean);
const visuals = [];
for (const label of (process.env.VISUALS ?? 'sunny,rain,snow,night,studio').split(',')) {
  if (process.env.VISUALS && !process.env.VISUALS.split(',').includes(label)) continue;
  const a = await sharp(`${before}/visual-${label}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(`${after}/visual-${label}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(a.info, b.info);
  const colors = new Set();
  for (let i = 0; i < a.data.length; i += 3000) colors.add(a.data[i]*65536 + a.data[i+1]*256 + a.data[i+2]);
  assert.ok(colors.size > 32, label + ': scene must not be blank');
  let sum = 0, maximum = 0, changedPixels = 0, largePixels = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++) {
      const error = Math.abs(a.data[i+channel] - b.data[i+channel]);
      sum += error; delta = Math.max(delta, error);
    }
    maximum = Math.max(maximum, delta);
    if (delta) changedPixels++;
    if (delta > 8) largePixels++;
  }
  const pixels = a.info.width*a.info.height;
  const result = { label, meanChannelError: sum/a.data.length, maximum,
    changedPercent: 100*changedPixels/pixels, largeDifferencePercent: 100*largePixels/pixels };
  visuals.push(result);
  // Half-float pass fusion can move an output value by one 8-bit level. A
  // missing object/effect produces much larger spatial and average differences.
  assert.ok(result.meanChannelError < .5 && result.largeDifferencePercent < .1,
    `${label}: unexpected visual difference ${JSON.stringify(result)}`);
}
const report = { timings, visuals };
writeFileSync(`${after}/comparison.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
