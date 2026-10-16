import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const html = readFileSync('index.html', 'utf8');
assert.equal((html.match(/name="theme-color"/g) || []).length, 1, 'One unambiguous browser theme color');
for (const file of ['favicon.svg', 'favicon-32.png', 'favicon.ico', 'apple-touch-icon.png']) {
  assert.ok(html.includes(`/branding/${file}`), `Browser must declare ${file}`);
}
assert.ok(!/unapproved|proposal/.test(readFileSync('public/branding/mark.svg', 'utf8')), 'Production master must be finalized');
const presets = readFileSync('android/game/export_presets.cfg', 'utf8');
const android = presets.split(/(?=\[preset\.\d+\])/).filter(part => part.includes('platform="Android"'));
assert.equal(android.length, 11);
for (const preset of android) for (const [key, file] of [
  ['main_192x192', 'launcher.png'], ['adaptive_foreground_432x432', 'adaptive-foreground.png'],
  ['adaptive_background_432x432', 'adaptive-background.png'], ['adaptive_monochrome_432x432', 'adaptive-monochrome.png'],
]) assert.ok(preset.includes(`launcher_icons/${key}="res://branding/${file}"`), `${preset.match(/name="([^"]+)/)?.[1]}: missing ${key}`);
for (const file of ['adaptive-foreground.png', 'adaptive-monochrome.png']) {
  const { data, info } = await sharp(`android/game/branding/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 432); assert.equal(info.height, 432);
  let visible = 0;
  for (let y = 0; y < 432; y++) for (let x = 0; x < 432; x++) {
    const i = (y * 432 + x) * 4;
    if (data[i + 3] < 16) continue;
    visible++;
    assert.ok(Math.hypot(x + .5 - 216, y + .5 - 216) <= 132, `${file}: launcher mask can crop visible artwork`);
    if (file.includes('monochrome')) assert.ok(data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255, 'Themed icon must contain only white RGB and alpha');
  }
  assert.ok(visible > 5000, 'Adaptive icon must not be blank');
  assert.equal(data[3], 0, 'Foreground must have a transparent background');
}
for (const [file, sizes] of [
  ['public/branding/favicon.ico', [16, 32, 48]],
  ['android/game/branding/app.ico', [16, 32, 48, 64, 128, 256]],
]) {
  const icon = readFileSync(file);
  assert.equal(icon.readUInt16LE(2), 1); assert.equal(icon.readUInt16LE(4), sizes.length);
  for (const [i, size] of sizes.entries()) {
    const entry = 6 + i * 16, offset = icon.readUInt32LE(entry + 12);
    assert.equal(icon[entry] || 256, size);
    assert.equal(icon.readUInt32LE(offset + 4), size);
    assert.equal(icon.readUInt32LE(offset + 8), size * 2);
    assert.ok(offset + icon.readUInt32LE(entry + 8) <= icon.length, 'ICO frame must be complete');
  }
}
const project = readFileSync('android/game/project.godot', 'utf8');
for (const value of ['config/icon="res://icon.png"', 'config/windows_native_icon="res://branding/app.ico"', 'boot_splash/image="res://branding/boot.png"']) assert.ok(project.includes(value));
assert.ok(presets.includes('application/modify_resources=true'));
console.log('Branding: browser declarations, 11 Android presets, adaptive safe circle, monochrome alpha and all Windows ICO sizes passed.');
