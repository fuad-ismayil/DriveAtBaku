// Use the web client's exact loop conditioning, offline, not during rendering.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { smoothBuffer } from '../../src/engineAudio.js';

const root = 'android/game/assets/audio';
mkdirSync(root, { recursive: true });
mkdirSync('artifacts/android', { recursive: true });
const report = [];
for (const directory of ['engines', 'tires']) for (const file of readdirSync(`public/assets/audio/${directory}`).filter(f => f.endsWith('.wav'))) {
  const bytes = readFileSync(`public/assets/audio/${directory}/${file}`);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  let format, pcm;
  for (let p = 12; p + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(p + 4), name = bytes.toString('ascii', p, p + 4);
    if (name === 'fmt ') format = { encoding: bytes.readUInt16LE(p + 8), channels: bytes.readUInt16LE(p + 10), sampleRate: bytes.readUInt32LE(p + 12), bits: bytes.readUInt16LE(p + 22) };
    if (name === 'data') pcm = bytes.subarray(p + 8, p + 8 + size);
    p += 8 + size + size % 2;
  }
  assert.equal(format.encoding, 1, `${file}: PCM required`);
  assert.ok([16, 24].includes(format.bits), `${file}: PCM 16/24-bit required`);
  const sampleBytes = format.bits / 8;
  const make = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: c => data[c] };
  };
  const input = make(format.channels, pcm.length / (sampleBytes * format.channels), format.sampleRate);
  for (let c = 0; c < format.channels; c++) for (let i = 0; i < input.length; i++) input.getChannelData(c)[i] = pcm.readIntLE((i * format.channels + c) * sampleBytes, sampleBytes) / (2 ** (format.bits - 1));
  const output = smoothBuffer({ createBuffer: make }, input);
  const measure = buffer => {
    let jump = 0, peak = 0, squared = 0;
    for (let c = 0; c < format.channels; c++) {
      const a = buffer.getChannelData(c);
      jump = Math.max(jump, Math.abs(a[0] - a[a.length - 1]));
      for (const s of a) { peak = Math.max(peak, Math.abs(s)); squared += s * s; }
    }
    return { seamJump: jump, peak, rms: Math.sqrt(squared / (buffer.length * format.channels)), duration: buffer.length / buffer.sampleRate };
  };
  const encoded = Buffer.alloc(44 + output.length * format.channels * 2);
  encoded.write('RIFF'); encoded.writeUInt32LE(encoded.length - 8, 4); encoded.write('WAVEfmt ', 8); encoded.writeUInt32LE(16, 16);
  encoded.writeUInt16LE(1, 20); encoded.writeUInt16LE(format.channels, 22); encoded.writeUInt32LE(format.sampleRate, 24);
  encoded.writeUInt32LE(format.sampleRate * format.channels * 2, 28); encoded.writeUInt16LE(format.channels * 2, 32); encoded.writeUInt16LE(16, 34);
  encoded.write('data', 36); encoded.writeUInt32LE(encoded.length - 44, 40);
  for (let i = 0; i < output.length; i++) for (let c = 0; c < format.channels; c++) encoded.writeInt16LE(Math.round(Math.max(-1, Math.min(32767 / 32768, output.getChannelData(c)[i])) * 32768), 44 + (i * format.channels + c) * 2);
  writeFileSync(`${root}/${file}`, encoded);
  // Godot's default QOA import reintroduces block decoder discontinuities at
  // arbitrary loop wraps. Keep these small, phase-conditioned loops as PCM.
  const importFile = `${root}/${file}.import`;
  if (existsSync(importFile)) writeFileSync(importFile, readFileSync(importFile, 'utf8').replace(/compress\/mode=\d+/, 'compress/mode=0'));
  const before = measure(input), after = measure(output);
  assert.ok(after.peak <= .800001 && Number.isFinite(after.rms));
  report.push({ file, before, after });
}
writeFileSync('artifacts/android/audio-loops.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.map(({ file, before, after }) => ({ file, rawJump: before.seamJump, preparedJump: after.seamJump })), null, 2));

// Offline equivalent of EngineAudio.shiftSound's quiet 550 Hz band-pass burst.
// The seed changes texture only; timing and level follow the owner's gear state.
const rate = 44100, frames = Math.ceil(rate * .15), shift = Buffer.alloc(44 + frames * 2);
shift.write('RIFF'); shift.writeUInt32LE(shift.length - 8, 4); shift.write('WAVEfmt ', 8); shift.writeUInt32LE(16, 16);
shift.writeUInt16LE(1, 20); shift.writeUInt16LE(1, 22); shift.writeUInt32LE(rate, 24); shift.writeUInt32LE(rate * 2, 28);
shift.writeUInt16LE(2, 32); shift.writeUInt16LE(16, 34); shift.write('data', 36); shift.writeUInt32LE(frames * 2, 40);
const omega = 2 * Math.PI * 550 / rate, alpha = Math.sin(omega) / (2 * .8), a0 = 1 + alpha;
let seed = 9127, low = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
for (let i = 0; i < frames; i++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  const white = (seed >>> 0) / 0xffffffff * 2 - 1;
  low += (white - low) * .035;
  const x = white * .68 + low * .32;
  const y = alpha / a0 * (x - x2) + 2 * Math.cos(omega) / a0 * y1 - (1 - alpha) / a0 * y2;
  x2 = x1; x1 = x; y2 = y1; y1 = y;
  const time = i / rate, envelope = time < .012 ? time / .012 : Math.pow(.0001, (time - .012) / (.12 - .012));
  shift.writeInt16LE(Math.round(Math.max(-1, Math.min(.9999, y * envelope)) * 32768), 44 + i * 2);
}
writeFileSync(`${root}/gear-shift.wav`, shift);
if (existsSync(`${root}/gear-shift.wav.import`)) {
  const path = `${root}/gear-shift.wav.import`;
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^compress\/mode=\d+/m, 'compress/mode=0'));
}
