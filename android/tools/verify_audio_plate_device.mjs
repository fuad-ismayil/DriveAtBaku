import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
const execute = promisify(execFile);
const binary = process.env.ADB_BIN || `${process.env.USERPROFILE}/Android/Sdk/platform-tools/adb.exe`;
const adb = (...args) => execute(binary, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const folder = 'artifacts/android/audio-plate-device', pkg = 'games.driveatbaku.audioplateqa';
mkdirSync(folder, { recursive: true });
await adb('install', '-r', 'android/build/DriveAtBaku-audio-plate-qa.apk');
await adb('shell', 'input', 'keyevent', '224');
await adb('shell', 'am', 'start', '-W', '-n', `${pkg}/com.godot.game.GodotAppLauncher`);
let pid = '', output = '', lastPhase = '';
for (let step = 0; step < 300; step++) {
  if (!pid) pid = (await adb('shell', 'pidof', pkg)).stdout.trim();
  output = (await adb('logcat', '-d', `--pid=${pid}`, '-s', 'godot')).stdout;
  const phase = output.match(/AUDIO_PLATE_PHASE .*/g)?.at(-1);
  if (phase && phase !== lastPhase) { console.log(phase); lastPhase = phase; }
  if (step === 6) writeFileSync(`${folder}/audioflinger.txt`, (await adb('shell', 'dumpsys', 'media.audio_flinger')).stdout);
  if (/AUDIO_PLATE_PASS|AUDIO_PLATE_FAILED|SCRIPT ERROR/.test(output)) break;
  await new Promise(resolve => setTimeout(resolve, 750));
}
writeFileSync(`${folder}/device.log`, output);
assert.match(output, /AUDIO_PLATE_PASS/);
assert.doesNotMatch(output, /SCRIPT ERROR|Shader compilation failed/);
const archive = await execute(binary, ['exec-out', 'run-as', pkg, 'tar', '-cf', '-', 'files/audio-plate-qa'], { windowsHide: true, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
writeFileSync(`${folder}/captures.tar`, archive.stdout);
await execute('tar.exe', ['-xf', `${folder}/captures.tar`, '-C', folder], { windowsHide: true });
console.log(output.match(/AUDIO_PLATE_PASS .*/)?.[0]);
