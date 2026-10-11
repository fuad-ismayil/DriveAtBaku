import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const bundledModules = process.env.PLAYWRIGHT_MODULES ?? `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`;
const { PNG } = require(`${bundledModules}/pngjs`);
let playwright;
try { playwright = require('playwright'); }
catch {
  playwright = require(`${bundledModules}/playwright`);
}
const output = resolve('artifacts/weather');
mkdirSync(output, { recursive: true });
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__weatherVerification = {
        ready: () => mode !== 'loading',
        capture: async (weatherMode, night = false, quality = 'balanced', amount = 1) => {
          mode = 'pause'; keys.clear(); resetCar(false, false);
          graphics.setQuality(quality); localReflections.setQuality(quality); weather.setQuality(quality);
          setNightMode(night, false); setWeather(weatherMode, false); weather.setIntensity(amount);
          animateCarModel(car, handling, 0); updateSceneLighting(0); mode = 'loading';
          for (const id of ['menu','hud','pause','garage','loading']) ui[id].classList.add('hidden');
          const forward = new THREE.Vector3(-Math.sin(handling.heading), Math.cos(handling.heading), 0);
          const right = new THREE.Vector3(forward.y, -forward.x, 0);
          camera.position.copy(car.position).addScaledVector(forward,-7).addScaledVector(right,1.5); camera.position.z += 2.4;
          camera.lookAt(car.position.clone().addScaledVector(forward,7).add(new THREE.Vector3(0,0,.2)));
          camera.fov=62; camera.updateProjectionMatrix();
          for (const name of ['tire marks','subtle tire smoke']) scene.getObjectByName(name).visible=false;
          sky.material.uniforms.time.value=0;
          scene.getObjectByName('weather rain').material.uniforms.weatherTime.value=1;
          // Settle car water independently of the fixed precipitation snapshot.
          // Road presets keep their established colour and reflection behaviour.
          for(let i=0;i<(weatherMode==='rain' && amount>0 ? 1200 : 5400);i++) {
            weather.updateVehicle(car,1/60,new THREE.Vector3(),true);
          }
          scene.updateMatrixWorld(true); worldOptimization.update(); localReflections.invalidate();
          for (let i=0;i<75;i++) {
            await new Promise(requestAnimationFrame);
            sky.position.copy(camera.position); weather.update(0,camera,true);
            localReflections.update(1/60,car,carCache.values(),false); graphics.render(1/60);
          }
          const roads=new Set(); scene.traverse(o=>{
            if(o.isMesh) for(const m of Array.isArray(o.material)?o.material:[o.material]) if(m.userData.dryRoadSurface) roads.add(m);
          });
          return { rain: scene.getObjectByName('weather rain').visible, snow: scene.getObjectByName('weather snow').visible,
            vehicleWetness: weather.getVehicleWetness(car),
            reflectedRoads: [...roads].filter(m=>m.envMap?.mapping===THREE.CubeUVReflectionMapping).length,
            roadCount: roads.size, calls: renderer.info.render.calls };
        }
      };` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://localhost:5173', { timeout: 180000 });
  await page.waitForFunction(() => window.__weatherVerification?.ready(), { timeout: 240000 });
  const states = [];
  let dryImage;
  for (const [label, mode, night, quality, amount] of [
    ['dry','sunny',false,'balanced',1], ['wet','wet',false,'balanced',1],
    ['rain','rain',false,'balanced',1], ['rain-night','rain',true,'balanced',1],
    ['dry-restored','sunny',false,'balanced',1], ['rain-performance','rain',false,'performance',2],
    ['rain-zero','rain',false,'performance',0], ['snow','snow',false,'balanced',1],
  ]) {
    const state = await page.evaluate(args => window.__weatherVerification.capture(...args), [mode,night,quality,amount]);
    const screenshot = await page.screenshot({ path: `${output}/${label}.png` });
    assert.equal(state.rain, mode === 'rain' && amount > 0, `${label}: falling rain follows the mode and amount`);
    assert.equal(state.snow, mode === 'snow', `${label}: snow is independent of rain`);
    assert.equal(state.vehicleWetness > .95, mode === 'rain' && amount > 0, `${label}: settled car water follows falling rain`);
    assert.ok(state.roadCount > 0);
    assert.equal(state.reflectedRoads > 0, quality !== 'performance' && (mode === 'rain' || mode === 'wet'), `${label}: city road reflections are exclusive to rainy/wet modes`);
    if (label === 'dry') dryImage = PNG.sync.read(screenshot);
    if (label === 'dry-restored') {
      const restored = PNG.sync.read(screenshot);
      // Compare exposed asphalt, excluding the car's independently blending
      // reflection probe and the sky. Every road pixel must match exactly.
      let changed = 0;
      for (let y=580;y<700;y++) for (let x=100;x<900;x++) for (let c=0;c<3;c++) {
        const pixel=(y*dryImage.width+x)*4+c;
        if(restored.data[pixel] !== dryImage.data[pixel]) changed++;
      }
      assert.equal(changed, 0, 'returning to dry restores all 96000 sampled road pixels exactly');
    }
    states.push({ label, ...state });
    console.log(JSON.stringify(states.at(-1)));
  }
  writeFileSync(`${output}/verification.json`, JSON.stringify({ states, errors }, null, 2));
  assert.deepEqual(errors, [], 'browser and WebGL shaders render without errors');
  console.log('Weather: rainy/wet isolation, day/night rendering, zero/max precipitation, quality fallback, snow and exact dry appearance restoration passed.');
} finally { await browser.close(); }
