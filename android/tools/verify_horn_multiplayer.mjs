import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const android = process.argv.includes('--android');
const execute = promisify(execFile);
const adbBinary = process.env.ADB_BIN || `${process.env.ANDROID_HOME || `${process.env.USERPROFILE}/Android/Sdk`}/platform-tools/adb.exe`;
const selector = process.env.DAB_DEVICE ? ['-s', process.env.DAB_DEVICE] : [];
const adb = (...args) => execute(adbBinary, [...selector, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const pkg = 'games.driveatbaku.hornqa';
const outputDir = `artifacts/android/horn-${android ? 'device' : 'desktop'}`;
mkdirSync(outputDir, { recursive: true });
const relay = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: '18787' }, windowsHide: true });
let relayOutput = '', nativeOutput = '', child, browser, page;
relay.stdout.on('data', bytes => relayOutput += bytes);
relay.stderr.on('data', bytes => relayOutput += bytes);
const vite = await createServer({ cacheDir: 'artifacts/android/vite-horn', server: { host: '127.0.0.1', port: 5198, strictPort: true, hmr: false } });
const browserPhases = [], errors = [];
try {
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling'] });
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
const hornQaMuted = new WeakSet();
let hornQaAnalyser, hornQaLocalMuted = false;
window.__hornQA = {
 ready: () => mode !== 'loading',
 sample: () => {
   const ctx = engineAudio.context;
   // Isolate horns in the real remote listener graph. The transport, horn
   // oscillators, spatial gains, listener volume and input remain untouched.
   if (ctx && !hornQaLocalMuted) { engineAudio.master.disconnect(); hornQaLocalMuted = true; }
   const remote = multiplayerSession?.remotes.values().next().value;
   const voice = remote?.audioSource;
   if (voice && !hornQaMuted.has(voice)) { voice.bank.tone.disconnect(); voice.skid.gain.disconnect(); hornQaMuted.add(voice); }
   if (ctx && !hornQaAnalyser) { hornQaAnalyser = ctx.createAnalyser(); hornQaAnalyser.fftSize = 2048; engineAudio.remoteMaster.connect(hornQaAnalyser); }
   const values = new Float32Array(2048); hornQaAnalyser?.getFloatTimeDomainData(values);
   return { mode, context: ctx?.state, rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length),
     localHorn: car.getNetState().in.hn, wire: remote?.buffer.at(-1)?.state, remotes: multiplayerSession?.remotes.size,
     hornGain: remote?.remoteHornGain?.gain.value, listenerGain: engineAudio.remoteMaster?.gain.value };
 },
 ack: revision => { indicatorState.mode = 'off'; indicatorState.revision = revision; multiplayerSession.sendImmediateState(); },
 dropOutgoing: async duration => {
   const client = multiplayerSession.client, send = client.sendState;
   client.sendState = () => {};
   try { await new Promise(resolve => setTimeout(resolve, duration)); } finally { client.sendState = send; }
 },
 dropIncoming: async duration => {
   const client = multiplayerSession.client, snapshot = client.onSnapshot;
   client.onSnapshot = packet => snapshot({ ...packet, states: Object.fromEntries(Object.entries(packet.states || {}).filter(([id]) => id === multiplayerSession.ownId)) });
   try { await new Promise(resolve => setTimeout(resolve, duration)); } finally { client.onSnapshot = snapshot; }
 }
};` });
  });
  await page.goto('http://127.0.0.1:5198/?server=ws%3A%2F%2F127.0.0.1%3A18787');
  await page.waitForFunction(() => window.__hornQA?.ready(), null, { timeout: 240000 });
  await page.locator('#multiplayer-button').click();
  await page.locator('#mp-nick-input').fill('WebHornQA');
  await page.locator('#mp-join-button').click();
  await page.waitForFunction(() => document.querySelector('#mp-status')?.textContent === 'CONNECTED');
  assert.equal((await page.evaluate(() => __hornQA.sample())).context, 'running', 'Actual Join must unlock Web Audio');
  let pid = '';
  if (android) {
    await adb('reverse', 'tcp:18787', 'tcp:18787');
    await adb('install', '-r', 'android/build/DriveAtBaku-horn-qa.apk');
    await adb('shell', 'am', 'start', '-W', '-n', `${pkg}/com.godot.game.GodotAppLauncher`);
    pid = (await adb('shell', 'pidof', pkg)).stdout.trim();
  } else {
    child = spawn(process.env.GODOT_BIN || 'C:/Program Files/Godot_v4.6.1-stable_win64/Godot_v4.6.1-stable_win64_console.exe',
      ['--path', 'android/game', '--resolution', '1480x720', 'res://tests/horn_multiplayer.tscn'], { windowsHide: true });
    child.stdout.on('data', bytes => nativeOutput += bytes);
    child.stderr.on('data', bytes => nativeOutput += bytes);
  }
  async function sample() {
    const levels = [];
    let result;
    // A cold remote model can replace its engine voice during this frame.
    // Let the analyser's previous engine samples drain after isolating it.
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => __hornQA.sample());
      await page.waitForTimeout(75);
    }
    for (let i = 0; i < 5; i++) {
      result = await page.evaluate(() => __hornQA.sample());
      levels.push(result.rms);
      await page.waitForTimeout(50);
    }
    return { ...result, rms: Math.sqrt(levels.reduce((sum, value) => sum + value * value, 0) / levels.length) };
  }
  let lastIndex = 0;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (android) nativeOutput = (await adb('logcat', '-d', `--pid=${pid}`, '-s', 'godot')).stdout;
    assert.doesNotMatch(nativeOutput, /SCRIPT ERROR|Shader compilation failed/);
    if (/HORN_MULTIPLAYER_RESULT/.test(nativeOutput)) break;
    const match = [...nativeOutput.matchAll(/HORN_PHASE (\{.*\})/g)].at(-1);
    if (match) {
      const phase = JSON.parse(match[1]);
      if (phase.index !== lastIndex) {
        console.log('HORN_PHASE', phase.name);
        lastIndex = phase.index;
        if (phase.name === 'web-pause') await page.keyboard.press('Escape');
        else {
          if ((await page.evaluate(() => __hornQA.sample())).mode === 'pause' && phase.name === 'resume') await page.locator('#resume').click();
          if (phase.web) await page.keyboard.down('h'); else await page.keyboard.up('h');
        }
        await page.waitForFunction(expected => {
          const value = __hornQA.sample();
          return value.wire?.li.sigRev === expected.index && Boolean(value.wire.in.hn) === expected.native && Boolean(value.localHorn) === expected.web;
        }, phase, { timeout: 35000 });
        await page.waitForTimeout(500);
        if (phase.name === 'web-hold') {
          await page.evaluate(() => __hornQA.dropOutgoing(2400));
          await page.waitForTimeout(350);
        }
        const heard = await sample();
        assert.ok(phase.native ? heard.rms > .00001 : heard.rms < .00001, `${phase.name}: wrong web listener output ${JSON.stringify(heard)}`);
        const evidence = { ...phase, listenerRms: heard.rms, hornGain: heard.hornGain, localHorn: heard.localHorn, listenerGain: heard.listenerGain };
        if (phase.name === 'leave-held') {
          await page.evaluate(() => { window.__hornDrop = __hornQA.dropIncoming(3600); });
          await page.waitForTimeout(2200);
          const stale = await sample();
          assert.ok(stale.rms < .00001, 'Web listener must silence a stalled native horn: ' + JSON.stringify(stale));
          evidence.staleRms = stale.rms;
          await page.evaluate(() => window.__hornDrop);
          await page.waitForTimeout(350);
          const recovered = await sample();
          assert.ok(recovered.rms > .00001, 'Web horn must recover after fresh snapshots');
        }
        browserPhases.push(evidence);
        await page.evaluate(index => __hornQA.ack(index), phase.index);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.match(nativeOutput, /HORN_MULTIPLAYER_RESULT/);
  // Android truncates long log lines; the saved report is authoritative.
  const nativeReport = android
    ? JSON.parse((await adb('exec-out', 'run-as', pkg, 'cat', 'files/horn-qa/report.json')).stdout)
    : JSON.parse(nativeOutput.match(/HORN_MULTIPLAYER_RESULT (\{.*\})/)[1]);
  assert.deepEqual(nativeReport.failures, []);
  assert.equal(browserPhases.length, 10);
  await page.waitForFunction(() => __hornQA.sample().remotes === 0, null, { timeout: 6000 });
  await page.waitForTimeout(500);
  const left = await sample();
  assert.ok(left.rms < .00001, 'Leaving while honking must silence the web listener');
  assert.deepEqual(errors, []);
  const report = { passed: true, android, nativeReport, browserPhases, disconnectRms: left.rms, errors };
  writeFileSync(`${outputDir}/verification.json`, JSON.stringify(report, null, 2));
  for (const file of ['failure.json', 'failure.png']) rmSync(`${outputDir}/${file}`, { force: true });
  if (android) {
    const files = (await adb('shell', 'run-as', pkg, 'ls', 'files/horn-qa')).stdout.trim().split(/\s+/);
    for (const file of files.filter(name => /^[a-z-]+\.(wav|json)$/.test(name))) {
      const result = await execute(adbBinary, [...selector, 'exec-out', 'run-as', pkg, 'cat', `files/horn-qa/${file}`], { windowsHide: true, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
      writeFileSync(`${outputDir}/${file}`, result.stdout);
    }
  }
  console.log('BIDIRECTIONAL_HORN_PASS', JSON.stringify({ android, nativeChecks: nativeReport.checks, browserPhases: browserPhases.length }));
} catch (error) {
  await page?.screenshot({ path: `${outputDir}/failure.png` }).catch(() => {});
  writeFileSync(`${outputDir}/failure.json`, JSON.stringify({ error: String(error), browserPhases, errors }, null, 2));
  throw error;
} finally {
  writeFileSync(`${outputDir}/native.log`, nativeOutput);
  writeFileSync(`${outputDir}/relay.log`, relayOutput);
  child?.kill();
  await browser?.close();
  await vite.close();
  relay.kill();
  if (android) await adb('reverse', '--remove', 'tcp:18787').catch(() => {});
}
