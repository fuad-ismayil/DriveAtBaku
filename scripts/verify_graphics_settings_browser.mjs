import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(`${process.env.PLAYWRIGHT_MODULES ?? `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`}/playwright`); }
const url = process.env.GAME_URL ?? 'http://localhost:5173';
const output = resolve(process.env.SETTINGS_REPORT ?? 'artifacts/distance-settings/browser');
const openView = process.env.TEST_VIEW === 'open';
mkdirSync(output, { recursive: true });
const baseline = process.env.COMPARE_BASELINE === '1';
const instrumentation = `
clock.getDelta = () => 1 / 60;
renderer.info.autoReset = false;
const settingsProbe = { rows: [], remaining: 0, resolve: null, start: 0, last: 0, queries: [] };
const probeGL = renderer.getContext(), probeTimer = probeGL.getExtension('EXT_disjoint_timer_query_webgl2');
graphicsDiagnostics.begin = () => {
  renderer.info.reset(); settingsProbe.start = performance.now();
  if (probeTimer && settingsProbe.remaining) {
    settingsProbe.query = probeGL.createQuery();
    probeGL.beginQuery(probeTimer.TIME_ELAPSED_EXT, settingsProbe.query);
  }
};
graphicsDiagnostics.end = () => {
  const now = performance.now();
  const row = { cpu: now - settingsProbe.start, interval: now - settingsProbe.last,
    calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    culling: worldOptimization.stats.milliseconds, skipped: worldOptimization.stats.skippedSubmissions ?? 0 };
  settingsProbe.last = now;
  if (settingsProbe.query) {
    probeGL.endQuery(probeTimer.TIME_ELAPSED_EXT);
    settingsProbe.queries.push({ query: settingsProbe.query, row }); settingsProbe.query = null;
  }
  const disjoint = probeTimer && probeGL.getParameter(probeTimer.GPU_DISJOINT_EXT);
  while (settingsProbe.queries.length && probeGL.getQueryParameter(settingsProbe.queries[0].query, probeGL.QUERY_RESULT_AVAILABLE)) {
    const pending = settingsProbe.queries.shift();
    if (!disjoint) pending.row.gpu = probeGL.getQueryParameter(pending.query, probeGL.QUERY_RESULT) / 1e6;
    probeGL.deleteQuery(pending.query);
  }
  if (settingsProbe.remaining) {
    settingsProbe.rows.push(row);
    if (--settingsProbe.remaining === 0) settingsProbe.resolve({ rows: settingsProbe.rows,
      world: { ...worldOptimization.stats }, graphics: graphics.stats });
  }
};
window.__settingsProbe = {
  ready: () => mode !== 'loading',
  pause: () => { mode = 'drive'; pause(); },
  distances: () => ({ ...worldOptimization.distances }),
  prepare: (quality, renderDistance, propsDistance) => {
    keys.clear(); if (mode === 'garage') closeGarage();
    setWeather('sunny', false); setNightMode(false, false); resetCar(false, false);
    graphics.setQuality(quality); localReflections.setQuality(quality); weather.setQuality(quality);
    worldOptimization.setDistances?.({ renderDistance, propsDistance });
    mode = 'pause';
    for (const id of ['menu','hud','pause','garage','loading']) ui[id].classList.add('hidden');
    camera.position.copy(car.position).add(new THREE.Vector3(6, -9, 3));
    camera.lookAt(car.position.clone().add(new THREE.Vector3(0,0,.8)));
    ${openView ? `
    const from = new THREE.Vector3(...route.checkpoints[2]), to = new THREE.Vector3(...route.checkpoints[3]);
    const forward = to.sub(from).setZ(0).normalize();
    resetCar(false, false, { position: from, heading: Math.atan2(-forward.x, forward.y) });
    camera.position.copy(car.position).addScaledVector(forward, -8).add(new THREE.Vector3(0, 0, 3));
    camera.lookAt(car.position.clone().addScaledVector(forward, 100).add(new THREE.Vector3(0,0,1.5)));
    ` : ''}
    camera.fov = 62; camera.updateProjectionMatrix();
    // Hold a reproducible main view while leaving all other renderer work intact.
    updateCamera = () => {};
    scene.updateMatrixWorld(true); worldOptimization.update();
  },
  measure: frames => new Promise(resolve => { settingsProbe.rows = []; settingsProbe.remaining = frames; settingsProbe.resolve = resolve; }),
};
`;

function metrics(rows) {
  return Object.fromEntries(Object.keys(rows[0]).map(key => {
    const values = rows.map(row => row[key]).filter(Number.isFinite).sort((a,b) => a-b);
    return [key, values.length ? { median: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)] } : null];
  }));
}

const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const reports = [];
try {
  for (const variant of baseline ? ['before', 'after'] : ['after']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    if (process.env.MULTI_DRAW_OFF === '1') await context.addInitScript(() => {
      const original = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function(name) { return name === 'WEBGL_multi_draw' ? null : original.call(this, name); };
    });
    const page = await context.newPage(), errors = [], shaderErrors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (/THREE.WebGLProgram|VALIDATE_STATUS|Shader Error/i.test(message.text())) shaderErrors.push(message.text()); });
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch(variant === 'before' ? { url: `${url}/artifacts/distance-settings/baseline/src/main.js` } : {});
      await route.fulfill({ response, body: `${await response.text()}\n${instrumentation}` });
    });
    await page.goto(url, { timeout: 180000 });
    await page.waitForFunction(() => window.__settingsProbe?.ready(), { timeout: 240000 });
    const hardware = await page.evaluate(() => {
      const gl = document.querySelector('#game').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), timerQueries: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
    });
    if (variant === 'after' && process.env.PROFILE_ONLY !== '1') {
      await page.evaluate(() => window.__settingsProbe.pause());
      const layouts = [];
      for (const [width, height] of [[1920,1080], [1366,768], [1280,720], [1024,768], [820,700], [390,844]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const layout = await page.evaluate(() => {
          const card = document.querySelector('.pause-card'), rect = card.getBoundingClientRect();
          return { overflow: card.scrollHeight - card.clientHeight, cardWidth: rect.width, left: rect.left, right: rect.right,
            controls: [...card.querySelectorAll('button,input,select')].map(el => ({ id: el.id, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })) };
        });
        assert.ok(layout.left >= 0 && layout.right <= width + 1, 'menu stays inside viewport');
        assert.ok(layout.controls.every(el => el.left >= layout.left && el.right <= layout.right + 1), 'no horizontal overflow');
        if (width >= 1024) assert.ok(layout.overflow <= 1, `${width}x${height}: all settings fit without scrolling (${layout.overflow}px)`);
        layouts.push({ width, height, ...layout });
        await page.screenshot({ path: `${output}/pause-${width}x${height}.png` });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.locator('#exit').focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'resume', 'keyboard stays in dialog');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'exit');
      const setSlider = (id, value) => page.locator(id).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      await setSlider('#render-distance', '1200'); await setSlider('#props-distance', '250');
      assert.deepEqual(await page.evaluate(() => window.__settingsProbe.distances()), { renderDistance: 1200, propsDistance: 250 });
      await page.locator('#props-distance').focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#props-distance').inputValue(), '300', 'native keyboard sliders work');
      await setSlider('#props-distance', '250');
      await page.reload({ timeout: 180000 });
      await page.waitForFunction(() => window.__settingsProbe?.ready(), { timeout: 240000 });
      assert.deepEqual(await page.evaluate(() => window.__settingsProbe.distances()), { renderDistance: 1200, propsDistance: 250 }, 'preferences survive restart');
      writeFileSync(`${output}/layout.json`, JSON.stringify(layouts, null, 2));
    }
    const scenarios = process.env.UI_ONLY === '1' ? [] : variant === 'before' ? [[6000,3000]] : [[6000,3000], [6000,250], [1200,250], [400,100]];
    for (const quality of ['performance', 'balanced', 'cinematic']) for (const [renderDistance, propsDistance] of scenarios) {
      await page.evaluate(args => window.__settingsProbe.prepare(...args), [quality, renderDistance, propsDistance]);
      await page.evaluate(() => window.__settingsProbe.measure(60));
      const result = await page.evaluate(() => window.__settingsProbe.measure(120));
      const row = { variant, quality, view: openView ? 'open' : 'spawn', renderDistance, propsDistance, hardware, metrics: metrics(result.rows), world: result.world, graphics: result.graphics };
      reports.push(row);
      await page.screenshot({ path: `${output}/${variant}-${quality}-${renderDistance}-${propsDistance}.png` });
      writeFileSync(`${output}/results.json`, JSON.stringify({ reports, errors, shaderErrors }, null, 2));
      console.log(JSON.stringify(row));
    }
    assert.deepEqual(errors, [], 'no game exceptions'); assert.deepEqual(shaderErrors, [], 'all shaders compile');
    await context.close();
  }
  console.log('Browser checks passed: desktop/mobile layouts, keyboard navigation, live settings, restart persistence and all preset/distance combinations.');
} finally { await browser.close(); }
