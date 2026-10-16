import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { engineMixTargets } from '../../src/engineMix.js';
import { remoteEngineState } from '../../src/net/engineState.js';
import { VEHICLES } from '../../src/vehicleCatalog.js';
const execute = promisify(execFile), android = process.argv.includes('--android');
const realWeb = process.argv.includes('--real-web');
assert.ok(!realWeb || android, '--real-web requires --android for the full device/Join/output verification');
const sdkAdb = `${process.env.ANDROID_HOME || `${process.env.USERPROFILE}/Android/Sdk`}/platform-tools/adb.exe`;
const adbBinary = process.env.ADB_BIN || (existsSync(sdkAdb) ? sdkAdb : 'adb');
const adb = (...args) => execute(adbBinary, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const relay = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: '18787' }, windowsHide: true });
let relayText = ''; relay.stdout.on('data', b => relayText += b); relay.stderr.on('data', b => relayText += b);
const vite = await createServer({ cacheDir: 'artifacts/android/vite-audio-test', server: { host: '127.0.0.1', port: 5198, strictPort: true, hmr: false },
  plugins: [{ name: 'native-game-fixture', configureServer(s) { s.middlewares.use((req, res, next) => {
    if (req.url === '/__network_fixture') { res.setHeader('Content-Type', 'text/html'); res.end('<link rel="icon" href="data:,"><title>Multiplayer game verification</title>'); } else next();
  }); } }] });
let browser, child, page, output = '';
mkdirSync('artifacts/android', { recursive: true });
try {
  await vite.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...(realWeb ? [] : ['--autoplay-policy=no-user-gesture-required']), '--disable-background-timer-throttling'] });
  page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => { errors.push(String(e)); console.log('BROWSER_PAGE_ERROR', String(e)); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  if (realWeb) {
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
const audioFixtureUpdate = updateCar;
let audioFixtureSelecting = false, audioFixtureAnalyser, audioFixtureClient;
window.__seen = []; window.__left = []; window.__banks = []; window.__heard = {};
updateCar = dt => {
  audioFixtureUpdate(dt);
  const remote = multiplayerSession?.remotes.values().next().value;
  const native = remote?.buffer.at(-1)?.state;
  if (!native) return;
  if (native.cid !== activeVehicle.id && !selectingVehicle && !audioFixtureSelecting) {
    audioFixtureSelecting = true;
    selectVehicle(native.cid).finally(() => { audioFixtureSelecting = false; });
  }
  if (activeVehicle.id !== native.cid) return;
  const phase = native.li.sig;
  const fixture = { off: [activeVehicle.idleRpm, 0, 0, 0, 1], left: [5000, .9, 0, 5, 2], right: [3000, 0, 0, -3, 2], hazard: [3500, .4, .1, 0, 3] }[phase];
  if (!fixture) return;
  [handling.rpm, handling.engineLoad, handling.shiftTimer, handling.acceleration, handling.gear] = fixture;
  handling.throttle = fixture[1]; handling.braking = phase === 'right' ? .8 : 0;
  handling.brakeForceInput = handling.braking; handling.horn = false;
  handling.velocity.set(0, 0, 0);
  for (const wheel of handling.wheels) { wheel.grounded = true; wheel.load = 1000; wheel.slideSpeed = phase === 'right' ? 10.2 : 0; }
  indicatorState.mode = phase;
  // Acknowledge a phase only after the actual web listener has measured it.
  // This keeps the first idle fixture alive through cold remote-model loading.
  const heard = window.__heard[native.cid + '_' + phase];
  if (heard?.wire.li.sigRev === native.li.sigRev) indicatorState.revision = native.li.sigRev;
};
window.__audioQA = {
 ready: () => mode !== 'loading',
 spatial: async () => {
   const remote = multiplayerSession.remotes.values().next().value, update = remote.update;
   remote.update = () => {};
   const samples = {};
   try {
     for (const [name, distance] of [['near',5],['middle',55],['far',140]]) {
       const listener = new THREE.PerspectiveCamera(); listener.position.copy(remote.currentPosition).add(new THREE.Vector3(distance,0,0));
       remote._updateAudio(listener, 1/60);
       await new Promise(resolve => setTimeout(resolve, 450));
       samples[name] = window.__audioQA.sample().rms;
     }
   } finally { remote.update = update; }
   return samples;
 },
 track: () => {
   if (!multiplayerSession || audioFixtureClient === multiplayerSession.client) return;
   audioFixtureClient = multiplayerSession.client;
   const snapshot = audioFixtureClient.onSnapshot, left = audioFixtureClient.onLeft;
   audioFixtureClient.onSnapshot = packet => { for (const [id,s] of Object.entries(packet.states || {})) if(id !== multiplayerSession.ownId) window.__seen.push(s); snapshot(packet); };
   audioFixtureClient.onLeft = packet => { window.__left.push(packet.id); left(packet); };
 },
 sample: () => {
   const ctx = engineAudio.context;
   if (ctx && !audioFixtureAnalyser) { audioFixtureAnalyser = ctx.createAnalyser(); audioFixtureAnalyser.fftSize = 2048; engineAudio.remoteMaster.connect(audioFixtureAnalyser); }
   const values = new Float32Array(2048); audioFixtureAnalyser?.getFloatTimeDomainData(values);
   const rms = Math.sqrt(values.reduce((sum,v) => sum + v*v, 0)/values.length);
   const remote = multiplayerSession?.remotes.values().next().value, native = remote?.buffer.at(-1)?.state;
   const voice = remote?.audioSource;
   if (voice && !window.__banks.includes(remote.carId)) window.__banks.push(remote.carId);
   const sample = { mode, context:ctx?.state, rms, master:engineAudio.master?.gain.value, listener:engineAudio.remoteMaster?.gain.value,
     cid:remote?.carId, phase:native?.li.sig, rpm:voice?.rpm, load:voice?.load, tire:voice?.skid.gain.gain.value,
     wire:native, distance:remote?.currentPosition.distanceTo(camera.position) };
   if (voice && native?.cid === remote.carId && rms > .00001 && Math.abs(voice.rpm - native.rpm) < 40)
     window.__heard[remote.carId + '_' + native.li.sig] = sample;
   return sample;
 }
};` });
    });
    await page.goto('http://127.0.0.1:5198/?server=ws%3A%2F%2F127.0.0.1%3A18787');
    await page.waitForFunction(() => window.__audioQA?.ready(), null, { timeout: 240000 });
    await page.locator('#multiplayer-button').click();
    await page.locator('#mp-nick-input').fill('WebAudioQA');
    await page.locator('#mp-join-button').click();
    await page.waitForFunction(() => document.querySelector('#mp-status')?.textContent === 'CONNECTED', null, { timeout: 30000 });
    await page.evaluate(() => __audioQA.track());
    const contextState = await page.evaluate(() => __audioQA.sample().context);
    assert.equal(contextState, 'running', 'The real Join gesture must unlock audio without an autoplay override');
  } else {
    await page.goto('http://127.0.0.1:5198/__network_fixture');
    await page.evaluate(async () => {
    const { NetClient } = await import('/src/net/NetClient.js'), { formatStatePayload } = await import('/src/net/protocol.js');
    const { EngineAudio } = await import('/src/engineAudio.js'), { RemotePlayer } = await import('/src/net/RemotePlayer.js');
    const { installLicensePlates } = await import('/src/licensePlates.js');
    const { VEHICLES } = await import('/src/vehicleCatalog.js'), THREE = await import('/node_modules/three/build/three.module.js');
    const audio = new EngineAudio(); await audio.activate(); audio.master.gain.value = .32;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const client = new NetClient(), remotes = new Map();
    window.__seen = []; window.__left = []; window.__banks = []; let seq = 0, native;
    client.onWelcome = p => { window.__webId = p.id; window.__webReady = true; };
    client.onSnapshot = packet => {
      for (const [id, state] of Object.entries(packet.states || {})) if (id !== window.__webId) {
        native = state; window.__seen.push(state);
        if (!remotes.has(id)) remotes.set(id, new RemotePlayer({ id, state }, { scene, engineAudio: audio, createVehicleModel: async carId => {
          const car = new THREE.Group(); installLicensePlates(car, carId); return car;
        } }));
        remotes.get(id).pushState(state, packet.ts);
      }
    };
    client.onLeft = packet => { window.__left.push(packet.id); remotes.get(packet.id)?.dispose(); remotes.delete(packet.id); };
    client.connect('ws://127.0.0.1:18787', 'WebEngineQA');
    setInterval(() => {
      if (!window.__webReady || !native) return;
      const phase = native.li.sig, profile = VEHICLES[native.cid];
      const target = { off: [profile.idleRpm, 0, 0, 0, 1], left: [5000, .9, 0, 5, 2], right: [3000, 0, 0, -3, 2], hazard: [3500, .4, .1, 0, 3] }[phase];
      const [rpm, ld, sh, ac, gr] = target;
      client.sendState(formatStatePayload(++seq, Date.now(), { cid: native.cid, col: '#314159', rpm, gr, au: { ld, sh, ac },
        p: [native.p[0] + 3, native.p[1], native.p[2]], q: native.q, v: [0, 0, 0], av: [0, 0, 0], spd: 0,
        in: { th: .2, br: 0, st: 0, hb: 0, hn: 0, rev: 0 }, li: { head: phase === 'off' ? 0 : 1, sig: phase, sigRev: native.li.sigRev, sigAt: native.li.sigAt, brake: phase === 'right', rev: 0 },
        w: Array.from({ length: 4 }, () => ({ st: 0, rot: 0, sl: phase === 'right' ? 10.2 : 0, sk: phase === 'right', sm: 0, c: 1, cp: native.p, n: [0, 0, 1] })) }));
    }, 34);
    setInterval(() => { for (const remote of remotes.values()) {
      camera.position.copy(remote.currentPosition).add(new THREE.Vector3(0, -5, 2));
      remote.update(1 / 60, camera);
      if (remote.audioSource && !window.__banks.includes(remote.carId)) window.__banks.push(remote.carId);
    } }, 16);
  });
  await page.waitForFunction(() => window.__webReady, null, { timeout: 15000 });
  }
  let pauseVerified = false, spatialReport;
  if (android) {
    await adb('reverse', 'tcp:18787', 'tcp:18787');
    await adb('install', '-r', 'android/build/DriveAtBaku-multiplayer-features.apk');
    await adb('shell', 'am', 'start', '-W', '-n', 'games.driveatbaku.multiplayerfeatures/com.godot.game.GodotAppLauncher');
    let pid = '', lastPhase = '';
    for (let i = 0; i < 230; i++) {
      if (!pid) { try { pid = (await adb('shell', 'pidof', 'games.driveatbaku.multiplayerfeatures')).stdout.trim(); } catch {} }
      if (pid) output = (await adb('logcat', '-d', `--pid=${pid}`, '-s', 'godot')).stdout;
      if (realWeb) {
        const sample = await page.evaluate(() => __audioQA.sample());
        if (sample.rms > .00001 && !pauseVerified) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          const paused = await page.evaluate(() => __audioQA.sample());
          assert.equal(paused.mode, 'pause');
          assert.ok(paused.rms > .00001 && paused.listener > 0 && paused.master < .001, 'Remote sound must remain audible while the local engine is paused');
          await page.locator('#resume').click();
          pauseVerified = true;
          spatialReport = await page.evaluate(() => __audioQA.spatial());
          assert.ok(spatialReport.near > .00001 && spatialReport.middle > spatialReport.near * .03 && spatialReport.middle < spatialReport.near * .65 && spatialReport.far < spatialReport.near * .02, 'Actual web output must attenuate with distance: ' + JSON.stringify(spatialReport));
        }
      }
      const phase = output.match(/DEVICE_MP_PHASE .*/g)?.at(-1);
      if (phase && phase !== lastPhase) { console.log(phase); lastPhase = phase; }
      if (output.includes('NATIVE_MULTIPLAYER_FEATURES_PASS') || output.includes('NATIVE_MULTIPLAYER_FEATURES_FAILED') || output.includes('SCRIPT ERROR')) break;
      if (!pid && i > 30) throw new Error('Android QA app closed before initialization; leave the test game open during the run.');
      if (pid && i % 10 === 0) {
        const alive = await adb('shell', 'pidof', 'games.driveatbaku.multiplayerfeatures').catch(() => null);
        if (!alive?.stdout.trim()) throw new Error('Android QA app exited before the result. See the saved device log.');
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  } else {
    child = spawn(process.env.GODOT_BIN || 'C:/Program Files/Godot_v4.6.1-stable_win64/Godot_v4.6.1-stable_win64_console.exe', ['--headless', '--path', 'android/game', 'res://tests/multiplayer_features.tscn'], { windowsHide: true });
    child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const code = await new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill(); reject(new Error('Game test timed out')); }, 200000);
      child.on('exit', code => { clearTimeout(timer); resolve(code); }); child.on('error', reject); });
    assert.equal(code, 0, output);
  }
  writeFileSync('artifacts/android/multiplayer-browser-diagnostics.json', JSON.stringify(await page.evaluate(() => ({ seen: window.__seen?.length, heard: window.__heard, banks: window.__banks, left: window.__left, current: window.__audioQA?.sample() })), null, 2));
  assert.match(output, /NATIVE_MULTIPLAYER_FEATURES_PASS/);
  assert.doesNotMatch(output, /SCRIPT ERROR|Shader compilation failed/);
  await page.waitForFunction(() => window.__left.length >= 2, null, { timeout: 6000 });
  const browserReport = await page.evaluate(() => ({ messages: window.__seen.length, left: window.__left, banks: window.__banks, heard: window.__heard || {} }));
  if (realWeb) {
    assert.equal(pauseVerified, true);
    for (const cid of ['ferrari','elantra','amg','prado']) for (const phase of ['off','left','right','hazard']) {
      const sample = browserReport.heard[cid + '_' + phase];
      assert.ok(sample?.rms > .00001, cid + ' ' + phase + ': Android audio must reach the actual web listener');
      const expected = engineMixTargets(remoteEngineState(sample.wire), VEHICLES[cid]);
      assert.ok(Math.abs(sample.rpm - expected.rpm) < 40 && Math.abs(sample.load - expected.load) < .02, cid + ' ' + phase + ': web voice must reproduce authoritative RPM/load/shift');
      assert.ok(phase === 'right' ? sample.tire > .1 : sample.tire < .001, cid + ' ' + phase + ': wrong braking/tire mix');
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(new Set(browserReport.banks), new Set(['ferrari', 'elantra', 'amg', 'prado']));
  writeFileSync(`artifacts/android/multiplayer-features${android ? '-android' : ''}${realWeb ? '-real-web' : ''}.json`, JSON.stringify({ browserReport, nativeOutput: output, errors, pauseVerified, spatialReport }, null, 2));
  console.log(output.trim()); console.log('BROWSER_MULTIPLAYER_FEATURES_PASS all four full engine banks, real audio graphs, clean leave and rejoin');
} catch (error) {
  await page?.screenshot({ path: 'artifacts/android/multiplayer-failure.png' }).catch(() => {});
  writeFileSync('artifacts/android/multiplayer-browser-failure.json', JSON.stringify(await page?.evaluate(() => ({ heard: window.__heard, banks: window.__banks, left: window.__left, current: window.__audioQA?.sample() })).catch(() => null), null, 2));
  throw error;
} finally {
  writeFileSync(`artifacts/android/multiplayer-features${android ? '-android' : ''}.log`, output);
  child?.kill(); await browser?.close(); await vite.close(); relay.kill();
  writeFileSync('artifacts/android/multiplayer-features-relay.log', relayText);
  if (android) await adb('reverse', '--remove', 'tcp:18787').catch(() => {});
}
