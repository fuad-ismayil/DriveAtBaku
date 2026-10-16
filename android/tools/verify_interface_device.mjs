import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const binary = process.env.ADB_BIN || `${process.env.ANDROID_HOME || `${process.env.USERPROFILE}/Android/Sdk`}/platform-tools/adb.exe`;
const selector = process.env.DAB_DEVICE ? ['-s', process.env.DAB_DEVICE] : [];
const pkg = 'games.driveatbaku.interfaceqa';
const output = 'artifacts/android/ui-device';
mkdirSync(output, { recursive: true });
function adb(args, optional = false) {
  const result = spawnSync(binary, [...selector, ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  if (!optional && result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result;
}
function preferenceHash() {
  const result = adb(['exec-out', 'run-as', 'games.driveatbaku.nativegame', 'cat', 'files/preferences.cfg'], true);
  return result.status === 0 ? createHash('sha256').update(result.stdout).digest('hex') : null;
}
const before = preferenceHash();
adb(['install', '-r', 'android/build/DriveAtBaku-interface-qa.apk']);
adb(['shell', 'am', 'start', '-W', '-n', `${pkg}/com.godot.game.GodotAppLauncher`]);
const pid = adb(['shell', 'pidof', pkg]).stdout.toString().trim();
console.log(`Native UI verification running on Android (PID ${pid}).`);
let log = '';
for (let attempt = 0; attempt < 120; attempt++) {
  log = adb(['logcat', '-d', `--pid=${pid}`, '-s', 'godot']).stdout.toString();
  if (/NATIVE_INTERFACE_FLOW|SCRIPT ERROR|Shader compilation failed/.test(log)) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
writeFileSync(`${output}/device.log`, log);
assert.match(log, /NATIVE_INTERFACE_FLOW/, 'UI verification did not finish; see device.log');
assert.doesNotMatch(log, /SCRIPT ERROR|Shader compilation failed/);
const files = adb(['shell', 'run-as', pkg, 'ls', 'files/ui']).stdout.toString().trim().split(/\s+/).filter(name => /^[a-zA-Z0-9_.-]+\.(png|json)$/.test(name));
for (const name of files) {
  writeFileSync(`${output}/${name}`, adb(['exec-out', 'run-as', pkg, 'cat', `files/ui/${name}`]).stdout);
}
const report = JSON.parse(adb(['exec-out', 'run-as', pkg, 'cat', 'files/ui/verification.json']).stdout.toString());
const after = preferenceHash();
const device = {
  model: adb(['shell', 'getprop', 'ro.product.model']).stdout.toString().trim(),
  android: adb(['shell', 'getprop', 'ro.build.version.release']).stdout.toString().trim(),
  density: adb(['shell', 'wm', 'density']).stdout.toString().trim(),
  primaryPreferencesUnchanged: before !== null && after !== null ? before === after : null,
  report,
};
writeFileSync(`${output}/device-verification.json`, JSON.stringify(device, null, 2));
assert.equal(report.passed, true, JSON.stringify(report.failures));
assert.equal(before, after, 'Isolated QA must preserve primary app preferences');
console.log(JSON.stringify(device, null, 2));
