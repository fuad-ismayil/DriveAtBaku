import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const execute = promisify(execFile);
const binary = process.env.ADB_BIN || `${process.env.USERPROFILE}/Android/Sdk/platform-tools/adb.exe`;
const adb = (...args) => execute(binary, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const pkg = 'games.driveatbaku.nativegame';
const preset = readFileSync('android/game/export_presets.cfg', 'utf8').split('[preset.0.options]')[1].split('[preset.')[0];
const expectedCode = Number(preset.match(/version\/code=(\d+)/)[1]);
const expectedName = preset.match(/version\/name="([^"]+)"/)[1];
const versionTag = expectedName.split('-')[0];
const preferences = async () => (await adb('shell', 'run-as', pkg, 'cat', 'files/preferences.cfg')).stdout;
const preferenceHash = (text, addedKeys = []) => {
  // Allow only newly introduced keys; existing accessibility settings must
  // participate in the preservation check just like every other saved value.
  const content = addedKeys.reduce((value, key) => value.replace(new RegExp(`^${key}=.*\\r?\\n`, 'gm'), ''), text);
  return createHash('sha256').update(content).digest('hex');
};
mkdirSync('artifacts/android', { recursive: true });
const beforeText = await preferences();
const addedKeys = ['reduce_motion', 'reduce_transparency'].filter(key => !new RegExp(`^${key}=`, 'm').test(beforeText));
const before = preferenceHash(beforeText);
const beforeExisting = preferenceHash(beforeText, addedKeys);
await adb('install', '-r', 'android/build/DriveAtBaku-native-debug.apk');
const afterInstall = preferenceHash(await preferences());
await adb('shell', 'am', 'start', '-W', '-n', `${pkg}/com.godot.game.GodotAppLauncher`);
const pid = (await adb('shell', 'pidof', pkg)).stdout.trim();
let output = '';
for (let step = 0; step < 180; step++) {
  output = (await adb('logcat', '-d', `--pid=${pid}`, '-s', 'godot')).stdout;
  if (/NATIVE_READY|SCRIPT ERROR/.test(output)) break;
  await new Promise(resolve => setTimeout(resolve, 750));
}
writeFileSync(`artifacts/android/device-primary-${versionTag}.log`, output);
assert.match(output, /NATIVE_READY/);
assert.doesNotMatch(output, /SCRIPT ERROR|Shader compilation failed/);
const afterText = await preferences();
const afterLaunch = preferenceHash(afterText);
const afterExisting = preferenceHash(afterText, addedKeys);
const version = (await adb('shell', 'dumpsys', 'package', pkg)).stdout.match(/versionCode=.*|versionName=.*/g);
assert.ok(version.some(line => new RegExp(`versionCode=${expectedCode}\\b`).test(line)) && version.some(line => line.includes(`versionName=${expectedName}`)));
const report = { before, afterInstall, afterLaunch, existingSettingsPreserved: before === afterInstall && beforeExisting === afterExisting, version, ready: output.match(/NATIVE_READY .*/)?.[0] };
writeFileSync(`artifacts/android/preferences-${versionTag}-verification.json`, JSON.stringify(report, null, 2));
assert.equal(report.existingSettingsPreserved, true, 'Saved preferences changed during update');
console.log(JSON.stringify(report));
