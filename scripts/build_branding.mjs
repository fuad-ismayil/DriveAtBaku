import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

// The approved SVGs are the masters. PNG native assets avoid differences in SVG
// mask support between browsers and Godot's SVG importer.
const dir = 'public/branding';
const native = 'android/game/branding';
mkdirSync(native, { recursive: true });
const mark = readFileSync(`${dir}/mark.svg`, 'utf8');
const favicon = readFileSync(`${dir}/favicon.svg`, 'utf8');
const app = readFileSync(`${dir}/app.svg`, 'utf8');
const inner = mark.slice(mark.indexOf('</title>') + 8, mark.lastIndexOf('</svg>'));
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 100 100">${body}</svg>`;
const raster = (source, size) => sharp(Buffer.from(source)).resize(size, size).png().toBuffer();
const png = async (path, source, size) => writeFileSync(path, await raster(source, size));

// All icon foreground pixels fit inside Android's central 66/108 safe circle.
const foreground = svg(`<g transform="translate(50 50) scale(.72) translate(-53 -50)">${inner}</g>`);
const monochrome = foreground.replaceAll('#edf5f2', '#ffffff').replaceAll('#9fe4d4', '#ffffff');
const background = svg('<rect width="100" height="100" fill="#0d171b"/>');
await png(`${native}/adaptive-foreground.png`, foreground, 432);
await png(`${native}/adaptive-monochrome.png`, monochrome, 432);
await png(`${native}/adaptive-background.png`, background, 432);
await png(`${native}/launcher.png`, app, 192);
await png(`${native}/mark.png`, mark, 256);
await png(`${native}/boot.png`, mark, 256);
await png('android/game/icon.png', app, 512);
for (const size of [16, 32, 48]) await png(`${dir}/favicon-${size}.png`, favicon, size);
await png(`${dir}/apple-touch-icon.png`, app, 180);
await png(`${dir}/app-512.png`, app, 512);

// Uncompressed 32-bit DIBs, including every Godot template size, ensure the PE
// patcher can replace every resource without retaining a stock icon at any size.
async function ico(sizes) {
  const head = Buffer.alloc(6 + sizes.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  const frames = [];
  let offset = head.length;
  for (const [i, size] of sizes.entries()) {
    const pixels = await sharp(await raster(size <= 48 ? favicon : app, size)).ensureAlpha().raw().toBuffer();
    const rowMask = Math.ceil(size / 32) * 4;
    const frame = Buffer.alloc(40 + size * size * 4 + rowMask * size);
    frame.writeUInt32LE(40, 0);
    frame.writeInt32LE(size, 4);
    frame.writeInt32LE(size * 2, 8);
    frame.writeUInt16LE(1, 12);
    frame.writeUInt16LE(32, 14);
    frame.writeUInt32LE(size * size * 4, 20);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = 40 + ((size - 1 - y) * size + x) * 4;
      frame[dst] = pixels[src + 2]; frame[dst + 1] = pixels[src + 1];
      frame[dst + 2] = pixels[src]; frame[dst + 3] = pixels[src + 3];
      if (pixels[src + 3] < 128) frame[40 + size * size * 4 + (size - 1 - y) * rowMask + (x >> 3)] |= 128 >> (x & 7);
    }
    const entry = 6 + i * 16;
    head[entry] = head[entry + 1] = size === 256 ? 0 : size;
    head.writeUInt16LE(1, entry + 4); head.writeUInt16LE(32, entry + 6);
    head.writeUInt32LE(frame.length, entry + 8); head.writeUInt32LE(offset, entry + 12);
    frames.push(frame); offset += frame.length;
  }
  return Buffer.concat([head, ...frames]);
}
writeFileSync(`${dir}/favicon.ico`, await ico([16, 32, 48]));
writeFileSync(`${native}/app.ico`, await ico([16, 32, 48, 64, 128, 256]));
console.log('Built approved A1 web, Android legacy/adaptive/monochrome, boot and Windows assets.');
