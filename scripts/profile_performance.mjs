import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import playwright from 'playwright';
const output = resolve(process.argv[2] ?? 'artifacts/performance/current');
const url = process.env.GAME_URL ?? 'http://localhost:5173';
mkdirSync(output, { recursive: true });
const instrumentation = `
import { GpuTimer } from '/src/gpuTimer.js';
import { summarizeFrames } from '/scripts/lib/performanceMetrics.mjs';
clock.getDelta = () => 1 / 60;
const profile = { rows: [], phases: {}, remaining: 0, resolve: null, last: 0 };
const profileGpu = new GpuTimer(renderer.getContext());
renderer.info.autoReset = false;
function wrapProfile(owner, key, label = key) {
  const original = owner[key];
  owner[key] = function(...args) {
    const start = performance.now();
    const result = original.apply(this, args);
    profile.phases[label] = (profile.phases[label] ?? 0) + performance.now() - start;
    return result;
  };
}
const frameProfile = { updateCar, updateCamera, updateSceneLighting };
for (const key of Object.keys(frameProfile)) wrapProfile(frameProfile, key);
updateCar = frameProfile.updateCar; updateCamera = frameProfile.updateCamera; updateSceneLighting = frameProfile.updateSceneLighting;
wrapProfile(worldOptimization, 'update', 'culling');
wrapProfile(localReflections, 'update', 'reflections');
wrapProfile(graphics, 'render', 'render');
graphicsDiagnostics.begin = () => {
  profileGpu.poll();
  profile.phases = {}; renderer.info.reset();
  profile.start = performance.now();
  profile.gpuRow = profile.remaining ? { pending: 0 } : null;
};
let lastGpuRow;
graphicsDiagnostics.startGPU = () => {
  if (profile.gpuRow && lastGpuRow !== profile.gpuRow) {
    profileGpu.begin('frame', profile.gpuRow); lastGpuRow = profile.gpuRow;
  }
};
const originalReflectionUpdate = localReflections.update;
localReflections.update = function(...args) {
  graphicsDiagnostics.startGPU(); return originalReflectionUpdate.apply(this, args);
};
graphicsDiagnostics.end = () => {
  profileGpu.end(); profileGpu.poll();
  const now = performance.now();
  const row = Object.assign(profile.gpuRow ?? {}, { cpu: now - profile.start, interval: profile.last ? now - profile.last : null,
    ...profile.phases, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
  profile.last = now;
  if (profile.remaining) {
    profile.rows.push(row);
    if (--profile.remaining === 0) profile.finishedAt = now;
  }
  if (profile.resolve && !profile.remaining) {
    if (now - profile.finishedAt > 5000 && profileGpu.pending.length) profileGpu.discard();
    if (profile.rows.every(row => !row.pending)) {
      const result = summarizeFrames(profile.rows);
      profile.resolve({ ...result, graphics: graphics.stats, world: {...worldOptimization.stats}, reflections: {...localReflections.stats},
        shadow: typeof shadowCache === 'undefined' ? null : {...shadowCache.stats}, queries: { supported: profileGpu.supported, pending: profileGpu.pending.length, ...profileGpu.stats } });
      profile.resolve = null;
    }
  }
};
window.__gameProfile = {
  ready: () => mode !== 'loading',
  measure: frames => new Promise(resolve => { profile.rows = []; profile.last = 0; profile.remaining = frames; profile.resolve = resolve; }),
  scenario: value => {
    keys.clear(); setWeather(value === 'rain' ? 'rain' : 'sunny', false); setNightMode(value === 'night', false);
    if (mode === 'garage') closeGarage();
    resetCar(false, false); mode = 'drive'; startDrive();
    if (value === 'idle') mode = 'pause';
    if (value === 'drive' || value === 'rain' || value === 'night') keys.add('KeyW');
    if (value === 'garage') openGarage();
  },
  snapshot: async (weatherMode, night, garage = false, ambientOcclusion = true) => {
    graphics.setAO(ambientOcclusion);
    keys.clear(); if (mode === 'garage') closeGarage();
    setWeather(weatherMode, false); setNightMode(night, false); resetCar(false, false);
    animateCarModel(car, handling, 0);
    mode = garage ? 'garage' : 'pause'; updateSceneLighting(0); mode = 'loading';
    for (const id of ['menu', 'hud', 'pause', 'garage', 'loading']) ui[id].classList.add('hidden');
    camera.position.copy(car.position).add(new THREE.Vector3(6, -9, 3));
    camera.lookAt(car.position.clone().add(new THREE.Vector3(0, 0, .8)));
    camera.fov = 62; camera.updateProjectionMatrix();
    scene.getObjectByName('tire marks').visible = false; scene.getObjectByName('subtle tire smoke').visible = false;
    sky.material.uniforms.time.value = 0;
    for (const name of ['weather rain', 'weather snow']) scene.getObjectByName(name).material.uniforms.weatherTime.value = 0;
    scene.updateMatrixWorld(true); worldOptimization.update(); localReflections.invalidate();
    for (let i = 0; i < 120; i++) {
      await new Promise(requestAnimationFrame);
      sky.position.copy(camera.position); weather.update(0, camera, !garage);
      localReflections.update(1/60, car, carCache.values(), garage); graphics.render(1/60);
    }
    return { settings: graphics.stats, pose: car.position.toArray(), world: {...worldOptimization.stats} };
  },
};
`;
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.VIEWPORT_WIDTH ?? 1280),
    height: Number(process.env.VIEWPORT_HEIGHT ?? 720) }, deviceScaleFactor: Number(process.env.PIXEL_RATIO ?? 1) });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  if (process.env.MULTI_DRAW_OFF === '1') await page.addInitScript(() => {
    const getExtension = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function(name) {
      return name === 'WEBGL_multi_draw' ? null : getExtension.call(this, name);
    };
  });
  await page.route(/\/streetAOPass\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    // Match the stochastic denoising texture across captures without changing
    // the production generator or randomness elsewhere in the game.
    let body = (await response.text()).replace('super(scene, camera, 1, 1);', `
      const savedRandom = Math.random; let noiseSeed = 41;
      Math.random = () => { noiseSeed = (Math.imul(noiseSeed,1664525)+1013904223)>>>0; return noiseSeed/4294967296; };
      super(scene, camera, 1, 1); Math.random = savedRandom;`);
    await route.fulfill({ response, body });
  });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch(process.env.BASELINE === '1'
      ? { url: url + '/artifacts/performance/baseline/src/main.js' } : {});
    await route.fulfill({ response, body: `${await response.text()}\n${instrumentation}` });
  });
  await page.goto(url, { timeout: 180000 });
  await page.waitForFunction(() => window.__gameProfile?.ready(), { timeout: 240000 });
  const hardware = await page.evaluate(() => {
    const gl = document.querySelector('#game').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      timerQueries: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
  });
  if (/SwiftShader|llvmpipe|Software Rasterizer/i.test(hardware.renderer)) throw new Error('Software renderer rejected: ' + hardware.renderer);
  const scenarios = process.env.SNAPSHOT_ONLY && existsSync(output + '/results.json')
    ? JSON.parse(readFileSync(output + '/results.json')).scenarios : [];
  const cdp = await page.context().newCDPSession(page);
  for (const scenario of process.env.SNAPSHOT_ONLY ? [] : ['idle', 'drive', 'rain', 'night', 'garage']) {
    await page.evaluate(scenario => window.__gameProfile.scenario(scenario), scenario);
    await page.evaluate(() => window.__gameProfile.measure(60));
    if (process.env.PROFILE_CPU === '1') { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    const result = await page.evaluate(() => window.__gameProfile.measure(180));
    if (process.env.PROFILE_CPU === '1') {
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(output + '/' + scenario + '.cpuprofile', JSON.stringify(profile));
    }
    scenarios.push({ scenario, ...result });
    writeFileSync(`${output}/results.json`, JSON.stringify({ hardware, scenarios, errors }, null, 2));
    await page.screenshot({ path: `${output}/${scenario}.png` });
    console.log(JSON.stringify(scenarios.at(-1)));
  }
  if (process.env.SNAPSHOTS === '1' || process.env.SNAPSHOT_ONLY) {
    for (const [label, weather, night, garage, ambientOcclusion] of [
      ['sunny', 'sunny', false, false], ['rain', 'rain', false, false],
      ['snow', 'snow', false, false], ['night', 'sunny', true, false], ['studio', 'sunny', false, true],
      ['no-ao', 'sunny', false, false, false],
    ]) {
      if (process.env.VISUALS && !process.env.VISUALS.split(',').includes(label)) continue;
      const state = await page.evaluate(args => window.__gameProfile.snapshot(...args), [weather, night, garage, ambientOcclusion]);
      await page.screenshot({ path: output + '/visual-' + label + '.png' });
      console.log(JSON.stringify({ visual: label, state }));
    }
  }
  writeFileSync(`${output}/results.json`, JSON.stringify({ hardware, scenarios, errors }, null, 2));
  console.log(JSON.stringify({ hardware, errors, output }));
} finally { await browser.close(); }

