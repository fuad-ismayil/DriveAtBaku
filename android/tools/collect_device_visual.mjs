import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
const serial = process.env.DAB_DEVICE;
const adbBinary = process.env.ADB_BIN || `${process.env.ANDROID_HOME || `${process.env.USERPROFILE}/Android/Sdk`}/platform-tools/adb.exe`;
const packageName = 'games.driveatbaku.visualverification';
const output = 'artifacts/android/visual'; mkdirSync(output, { recursive: true });
const run = args => {
  const result = spawnSync(adbBinary, [...(serial ? ['-s', serial] : []), ...args], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return result.stdout;
};
const names = run(['shell','run-as',packageName,'ls','files']).toString().trim().split(/\s+/).filter(n=>/^[a-z0-9_-]+\.(png|wav|json)$/.test(n));
for (const name of names) writeFileSync(`${output}/${name}`, run(['exec-out','run-as',packageName,'cat',`files/${name}`]));
const indicators = [];
for (const id of ['ferrari','elantra','amg','prado']) for (const side of ['front','rear']) {
  const baseline = `${output}/${id}_${side}_off.png`;
  if (!existsSync(baseline)) continue;
  const off = await sharp(baseline).ensureAlpha().raw().toBuffer();
  for (const mode of side === 'front' ? ['left','right','hazard'] : ['hazard']) {
    const path = `${output}/${id}_${side}_${mode}.png`; if (!existsSync(path)) continue;
    const on = await sharp(path).ensureAlpha().raw().toBuffer();
    let amberPixels = 0;
    for (let p=0;p<on.length;p+=4) if (on[p] > off[p]+16 && on[p] > on[p+1]*1.4 && on[p+1] > on[p+2]*1.25) amberPixels++;
    indicators.push({ id, side, mode, amberPixels });
  }
}
writeFileSync(`${output}/indicator-pixels.json`, JSON.stringify(indicators, null, 2));
console.log(JSON.stringify({ files: names.length, indicators }));
