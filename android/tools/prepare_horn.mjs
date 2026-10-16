import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

// The web horn's two sawtooth voices and band-pass settings, baked offline.
// Both integer frequencies repeat after one second; warm the filters first.
const rate = 44100, frames = rate, samples = new Float64Array(frames);
for (const hz of [420, 505]) {
  const omega = 2 * Math.PI * (hz * 2.6) / rate;
  const alpha = Math.sin(omega) / (2 * 1.1), a0 = 1 + alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < frames * 4; i++) {
    const x = 2 * ((i * hz % rate) / rate) - 1;
    const y = alpha / a0 * (x - x2) + 2 * Math.cos(omega) / a0 * y1 - (1 - alpha) / a0 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    if (i >= frames * 3) samples[i - frames * 3] += y * 0.2;
  }
}
const peak = Math.max(...samples.map(Math.abs));
const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / frames);
assert.ok(peak < 0.95 && rms > 0.02, 'Horn must be audible with unclipped PCM headroom');
const wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(samples[i] * 32768), 44 + i * 2);
mkdirSync('android/game/assets/audio', { recursive: true });
const path = 'android/game/assets/audio/horn-loop.wav';
writeFileSync(path, wav);
if (existsSync(`${path}.import`)) writeFileSync(`${path}.import`, readFileSync(`${path}.import`, 'utf8').replace(/^compress\/mode=\d+/m, 'compress/mode=0'));
console.log(JSON.stringify({ horn: '420 Hz + 505 Hz', peak, rms, frames }));
