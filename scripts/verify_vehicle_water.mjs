import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { createVehicleWater } from '../src/vehicleWater.js';

const water = createVehicleWater();
function fixture(paint = new THREE.MeshPhysicalMaterial({ color: '#af182b', roughness: .28, metalness: .5, clearcoat: .85 })) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), paint); body.position.z = .7;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1), new THREE.MeshPhysicalMaterial({
    color: '#20313b', roughness: .13, transparent: true, opacity: .67, side: THREE.DoubleSide,
  }));
  glass.position.set(0, .7, 1.3); glass.rotation.x = -.55;
  car.add(body, glass); car.userData.paintMaterials = [paint];
  return { car, body, glass };
}
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader, {});
  return shader;
}
const { car, body, glass } = fixture();
const properties = material => ({ color: material.color.toArray(), roughness: material.roughness, metalness: material.metalness,
  opacity: material.opacity, transparent: material.transparent, clearcoat: material.clearcoat, map: material.map });
const originalBody = properties(body.material), originalGlass = properties(glass.material);
water.updateVehicle(car, 0);
const shader = compile(body.material), windowShader = compile(glass.material), version = body.material.version;
assert.equal(shader.uniforms.carWaterWetness.value, 0, 'new dry cars have no water');
assert.deepEqual(properties(body.material), originalBody); assert.deepEqual(properties(glass.material), originalGlass);
assert.equal(shader.uniforms.carWaterWetness, windowShader.uniforms.carWaterWetness, 'body and windows share the same accumulation');
for (let i = 0; i < 120; i++) { water.update(1 / 60); water.updateVehicle(car, 1 / 60, { rain: 1 }); }
const earlyWet = water.getWetness(car);
assert.ok(earlyWet > .25 && earlyWet < .4, 'rain builds gradually over seconds');
for (let i = 0; i < 900; i++) water.updateVehicle(car, 1 / 60, { rain: 1 });
const soaked = water.getWetness(car); assert.ok(soaked > .96);
water.updateVehicle(car, 1 / 60, { rain: 0 });
assert.ok(water.getWetness(car) > soaked - .001, 'stopping rain retains the water');
const stationaryFlow = shader.uniforms.carWaterFlow.value.clone();
water.updateVehicle(car, 1 / 60, { rain: 1, velocity: new THREE.Vector3(0, 40, 0) });
assert.ok(shader.uniforms.carWaterFlow.value.y < stationaryFlow.y - .09, 'forward driving moves water backwards');
water.updateVehicle(car, 1 / 60, { rain: 1, velocity: new THREE.Vector3(0, -20, 0) });
assert.ok(shader.uniforms.carWaterFlow.value.y > stationaryFlow.y + .04, 'reversing reverses airflow');
car.rotation.y = .35; car.position.set(800, -550, 3);
water.updateVehicle(car, 0, { rain: 1 });
const local = car.position.clone().applyMatrix4(shader.uniforms.carWaterWorldToLocal.value);
assert.ok(local.length() < 1e-9, 'the drop field remains attached to a translated car');
assert.ok(Math.abs(shader.uniforms.carWaterGravity.value.x) > .3, 'gravity follows the actual surface slope');
water.updateVehicle(car, .1, { rain: 1, outside: false });
assert.equal(shader.uniforms.carWaterWetness.value, 0, 'the garage preserves dry showroom materials');
water.updateVehicle(car, 0, { rain: 0, outside: true });
assert.ok(shader.uniforms.carWaterWetness.value > .9, 'leaving the garage restores remaining accumulated water');
for (let i = 0; i < 4000; i++) water.updateVehicle(car, 1 / 60, { rain: 0 });
assert.equal(water.getWetness(car), 0, 'sunny weather dries the car completely');
assert.deepEqual(properties(body.material), originalBody); assert.deepEqual(properties(glass.material), originalGlass);
assert.equal(body.material.version, version, 'weather and movement never recompile the shader');
water.setQuality('performance'); water.updateVehicle(car, 0);
assert.equal(shader.uniforms.carWaterDetail.value, 0, 'performance mode skips the fine bead layer');
const shared = fixture(body.material); water.updateVehicle(shared.car, .1, { rain: 1 });
assert.notEqual(shared.body.material, body.material, 'different cars receive independent uniforms even with shared source materials');
assert.ok(water.getWetness(shared.car) > 0); assert.equal(water.getWetness(car), 0);
const excluded = fixture();
const wheel = new THREE.Group(), plate = new THREE.Group();
wheel.add(new THREE.Mesh(new THREE.BoxGeometry(), excluded.body.material));
plate.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
excluded.car.add(wheel, plate); excluded.car.userData.wheels = [{ steerPivot: wheel }];
excluded.car.userData.licensePlates = { rigs: [plate] };
const wheelMaterial = wheel.children[0].material;
// Use a separate wheel material so body registration cannot patch the wheel's shared source.
wheel.children[0].material = wheelMaterial.clone();
const wheelKey = wheel.children[0].material.customProgramCacheKey();
water.updateVehicle(excluded.car, .1, { rain: 1 });
assert.equal(wheel.children[0].material.customProgramCacheKey(), wheelKey, 'wheels are excluded from body water');
console.log('Vehicle water: accumulation, drying, paint/glass preservation, speed/reverse/tilt, garage, quality and shared-material isolation passed.');

// Compile and render the actual four car assets. The existing fitting viewer
// supplies the loader/lighting; interception changes only this verification tab.
const require = createRequire(import.meta.url);
const modules = process.env.PLAYWRIGHT_MODULES ?? `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`;
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(`${modules}/playwright`); }
const { PNG } = require(`${modules}/pngjs`);
const output = resolve('artifacts/vehicle-water'); mkdirSync(output, { recursive: true });
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
const errors = [], reports = [];
const differentPixels = (a, b) => {
  const aa = PNG.sync.read(a), bb = PNG.sync.read(b); let count = 0;
  for (let i = 0; i < aa.data.length; i += 4) if (aa.data[i] !== bb.data[i] || aa.data[i + 1] !== bb.data[i + 1] || aa.data[i + 2] !== bb.data[i + 2]) count++;
  return count;
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/scripts/plate-fit.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      import { createVehicleWater } from '/src/vehicleWater.js';
      const vehicleWaterCheck = createVehicleWater();
      renderer.setAnimationLoop(null);
      document.querySelector('aside').style.display = 'none';
      window.__vehicleWaterCheck = {
        ready: () => ui.report.dataset.ready === 'true',
        select: async id => { ui.car.value=id; ui.view.value='whole'; ui.light.value='day'; await refresh(); },
        capture: async (effect, quality='cinematic', view='close', night=false) => {
          const h = VEHICLES[ui.car.value].dims.height;
          camera.position.set(view==='side'?3.1:1.75,view==='side'?.3:2.7,h+1.0);
          camera.lookAt(0,view==='side'?0:.75,h*.7);
          camera.fov=view==='side'?42:38; camera.updateProjectionMatrix();
          sun.intensity=night?0:3; hemi.intensity=night?.04:1; scene.environmentIntensity=night?.25:.8;
          lamp.position.copy(camera.position); lamp.target.position.set(0,.7,h*.7); lamp.intensity=night?20:0;
          vehicleWaterCheck.setQuality(quality);
          const zero=new THREE.Vector3();
          if(effect !== 'original') {
            vehicleWaterCheck.updateVehicle(car,0);
            let seconds=effect==='wet'?20:effect==='dry-restored'?90:effect==='moving'?1:0;
            for(let i=0;i<seconds*60;i++) {
              vehicleWaterCheck.update(1/60);
              vehicleWaterCheck.updateVehicle(car,1/60,{rain:effect==='wet'||effect==='moving'?1:0,velocity:effect==='moving'?new THREE.Vector3(0,40,0):zero});
            }
          }
          renderer.render(scene,camera);
          const gl=renderer.getContext(); gl.finish();
          await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
          return { wetness:vehicleWaterCheck.getWetness(car), calls:renderer.info.render.calls,
            triangles:renderer.info.render.triangles, geometries:renderer.info.memory.geometries,
            textures:renderer.info.memory.textures, paint:car.userData.paintMaterials.map(m=>m.color.getHexString()) };
        }
      };` });
  });
  await page.goto(`${process.env.GAME_URL ?? 'http://localhost:5173'}/scripts/plate-fit.html`);
  await page.waitForFunction(() => window.__vehicleWaterCheck?.ready(), { timeout: 120000 });
  for (const id of ['ferrari', 'elantra', 'amg', 'prado']) {
    await page.evaluate(id => window.__vehicleWaterCheck.select(id), id);
    const capture = async (effect, quality = 'cinematic', view = 'close', night = false) => {
      const state = await page.evaluate(args => window.__vehicleWaterCheck.capture(...args), [effect, quality, view, night]);
      const screenshot = await page.screenshot({ path: `${output}/${id}-${effect}-${quality}-${view}${night ? '-night' : ''}.png` });
      return { state, screenshot };
    };
    const original = await capture('original'), dry = await capture('dry'), wet = await capture('wet');
    assert.equal(differentPixels(original.screenshot, dry.screenshot), 0, `${id}: registering water leaves all dry pixels unchanged`);
    assert.ok(differentPixels(dry.screenshot, wet.screenshot) > 1000, `${id}: accumulated water is visible`);
    for (const key of ['calls', 'triangles', 'geometries', 'textures']) assert.equal(wet.state[key], dry.state[key], `${id}: water adds no ${key}`);
    assert.deepEqual(wet.state.paint, dry.state.paint, `${id}: original pigment is retained`);
    const moving = await capture('moving');
    assert.ok(differentPixels(wet.screenshot, moving.screenshot) > 500, `${id}: water moves under airflow`);
    await capture('wet', 'balanced', 'side'); await capture('wet', 'performance');
    await capture('wet', 'cinematic', 'close', true);
    const restored = await capture('dry-restored');
    assert.equal(restored.state.wetness, 0);
    assert.equal(differentPixels(dry.screenshot, restored.screenshot), 0, `${id}: complete drying restores every dry pixel`);
    reports.push({ id, dry:dry.state, wet:wet.state, moving:moving.state, restored:restored.state });
    console.log(`${id}: visible moving water, exact dry restoration, day/night and all quality modes passed.`);
  }
  assert.deepEqual(errors, [], 'all vehicle water shaders compile and render without errors');
  writeFileSync(`${output}/verification.json`, JSON.stringify({ reports, errors }, null, 2));
} finally { await browser.close(); }
