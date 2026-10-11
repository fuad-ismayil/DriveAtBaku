import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import playwright from 'playwright';
import { PNG } from 'pngjs';
const baseline = process.env.WATER_BASELINE === '1';
const output = resolve(`artifacts/vehicle-water-distance/${baseline ? 'before' : 'after'}`);
mkdirSync(output, { recursive: true });
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
const errors = [], reports = [];
function contrast(beads, film, mask) {
  const a = PNG.sync.read(beads), b = PNG.sync.read(film), roles = PNG.sync.read(mask);
  const result = { paint: { pixels: 0, changed: 0, absolute: 0 }, glass: { pixels: 0, changed: 0, absolute: 0 } };
  for (let i = 0; i < a.data.length; i += 4) {
    const role = roles.data[i] > 100 && roles.data[i] > roles.data[i + 1] * 1.4 && roles.data[i] > roles.data[i + 2] * 1.4 ? 'paint'
      : roles.data[i + 1] > 100 && roles.data[i + 1] > roles.data[i] * 1.3 && roles.data[i + 1] > roles.data[i + 2] * 1.3 ? 'glass' : null;
    if (!role) continue;
    const change = Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i + c] - b.data[i + c])));
    result[role].pixels++; result[role].absolute += change;
    if (change >= 3) result[role].changed++;
  }
  for (const r of Object.values(result)) { r.mean = r.absolute / Math.max(r.pixels, 1); r.fraction = r.changed / Math.max(r.pixels, 1); }
  return result;
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (baseline) await page.route('**/src/vehicleWater.js*', async route => {
    const response = await route.fetch(), transformed = await response.text();
    const imports = transformed.match(/import \* as THREE from [^;]+;/)?.[0];
    assert.ok(imports);
    const source = readFileSync(resolve('artifacts/vehicle-water-distance/vehicleWater-before.js'), 'utf8');
    await route.fulfill({ response, body: source.replace(/import \* as THREE from 'three';/, imports) });
  });
  await page.route('**/scripts/plate-fit.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      import { createVehicleWater } from '/src/vehicleWater.js';
      const testWater = createVehicleWater(), wetCheck = {value:1}, maskCheck = {value:0};
      const checkReady=new WeakSet(), checkMaterials=new WeakSet();
      renderer.setAnimationLoop(null); document.querySelector('aside').style.display='none';
      window.__distanceWater = {
        ready: () => ui.report.dataset.ready==='true',
        select: async id => {
          ui.car.value=id; ui.view.value='whole'; ui.light.value='day'; await refresh();
          testWater.setQuality('balanced');
          for(let i=0;i<1200;i++) { testWater.update(1/60); testWater.updateVehicle(car,1/60,{rain:1,velocity:new THREE.Vector3()}); }
          if(!checkReady.has(car)) {
            const paints=new Set(car.userData.paintMaterials), materials=new Set();
            car.traverse(mesh=>{if(mesh.isMesh) for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]) materials.add(m);});
            for(const m of materials) {
              if(checkMaterials.has(m)) continue; checkMaterials.add(m);
              const role=paints.has(m)?new THREE.Vector3(1,0,0):(m.userData.vehicleWaterGlass??(m.transparent&&m.opacity>=.1&&m.roughness<.35))?new THREE.Vector3(0,1,0):new THREE.Vector3();
              const previous=m.onBeforeCompile, key=m.customProgramCacheKey();
              m.onBeforeCompile=(shader,r)=>{
                previous.call(m,shader,r);
                shader.uniforms.verifyWaterBeads=wetCheck; shader.uniforms.verifyWaterMask=maskCheck; shader.uniforms.verifyWaterRole={value:role};
                shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\\nuniform float verifyWaterBeads,verifyWaterMask;uniform vec3 verifyWaterRole;')
                  .replace('return height;','return height * verifyWaterBeads;')
                  .replace('#include <opaque_fragment>','#include <opaque_fragment>\\nif(verifyWaterMask>.5) gl_FragColor=vec4(verifyWaterRole,1.0);');
              };
              m.customProgramCacheKey=()=>key+':distance-check'; m.needsUpdate=true;
            }
            checkReady.add(car);
          }
        },
        setup: (view,lighting,color) => {
          for(const m of car.userData.paintMaterials) m.color.set(color);
          const h=VEHICLES[ui.car.value].dims.height;
          const distance=view==='far'?12:7;
          const direction=new THREE.Vector3(view==='side'?1:view==='rear'?.32:.26,view==='side'?.1:view==='rear'?-1:1,.23).normalize();
          const target=new THREE.Vector3(0,0,h*.5);
          camera.position.copy(target).addScaledVector(direction,distance); camera.lookAt(target); camera.fov=62;camera.updateProjectionMatrix();
          sun.position.set(-3,5,6); sun.intensity=lighting==='night'?0:lighting==='overcast'?.3:3;
          hemi.intensity=lighting==='night'?.045:lighting==='overcast'?.55:1;
          scene.environmentIntensity=lighting==='night'?.18:lighting==='overcast'?.55:.8;
          lamp.position.copy(camera.position);lamp.target.position.copy(target);lamp.intensity=lighting==='night'?28:0;
          scene.background.set(lighting==='night'?'#111820':'#68747a');
        },
        measure: async () => {
          wetCheck.value=1;maskCheck.value=0;
          const gl=renderer.getContext(), timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
          const cpu=[], gpu=[], pending=[];
          for(let i=0;i<40;i++) {
            const query=timer&&i>=8?gl.createQuery():null;
            if(query) gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
            const start=performance.now(); renderer.render(scene,camera);
            if(query) gl.endQuery(timer.TIME_ELAPSED_EXT);
            gl.finish(); if(i>=8) cpu.push(performance.now()-start);
            if(query) pending.push(query);
          }
          await new Promise(requestAnimationFrame);
          if(timer&&!gl.getParameter(timer.GPU_DISJOINT_EXT)) for(const q of pending) {
            if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);
          }
          for(const q of pending) gl.deleteQuery(q);
          const stats=a=>{a.sort((x,y)=>x-y);return a.length?{median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],samples:a.length}:null;};
          return {synchronousFrameMs:stats(cpu),gpuMs:stats(gpu)};
        },
        render: async (beads,mask=false) => {
          wetCheck.value=beads?1:0;maskCheck.value=mask?1:0;
          renderer.render(scene,camera);renderer.getContext().finish();
          await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
          return { calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures };
        }
      };` });
  });
  await page.goto(`${process.env.GAME_URL ?? 'http://localhost:5173'}/scripts/plate-fit.html`);
  await page.waitForFunction(() => window.__distanceWater?.ready(), { timeout: 120000 });
  for (const id of ['ferrari', 'elantra', 'amg', 'prado']) {
    await page.evaluate(id => window.__distanceWater.select(id), id);
    for (const [view, lighting, color] of [
      ['front','day','#af182b'], ['rear','day','#af182b'], ['side','day','#af182b'], ['far','day','#af182b'],
      ['front','overcast','#eeeeee'], ['side','overcast','#111111'], ['front','night','#111111'], ['rear','night','#eeeeee'],
    ]) {
      const label = `${id}-${view}-${lighting}-${color.slice(1)}`;
      await page.evaluate(args => window.__distanceWater.setup(...args), [view, lighting, color]);
      if(process.env.WATER_MEASURE === '1') {
        if(view!=='front'||lighting!=='day') continue;
        await page.evaluate(() => window.__distanceWater.render(true));
        const timing=await page.evaluate(() => window.__distanceWater.measure());
        reports.push({label,timing}); console.log(JSON.stringify({label,timing})); continue;
      }
      const on = await page.evaluate(() => window.__distanceWater.render(true));
      const beads = await page.screenshot({ path: `${output}/${label}.png` });
      const off = await page.evaluate(() => window.__distanceWater.render(false));
      const film = await page.screenshot();
      await page.evaluate(() => window.__distanceWater.render(true, true));
      const mask = await page.screenshot({path:`${output}/${label}-mask.png`}), metrics = contrast(beads, film, mask);
      assert.deepEqual(on, off, 'droplet detail adds no draws, triangles or textures');
      assert.ok(metrics.paint.pixels > 200 && metrics.glass.pixels > 30, `${label}: separately measure visible paint and glass`);
      if(!baseline) {
        assert.ok(metrics.paint.mean>.35,`${label}: paint droplets have readable contrast at driving distances`);
        if(view==='front'||view==='side'||view==='far') assert.ok(metrics.glass.mean>.2,`${label}: glass droplets retain contrast at driving distances`);
      }
      reports.push({ label, ...metrics, render: on });
      console.log(JSON.stringify({ label, paint:metrics.paint.mean,glass:metrics.glass.mean }));
    }
  }
  assert.deepEqual(errors, [], 'distance shaders compile and render');
  writeFileSync(`${output}/${process.env.WATER_MEASURE === '1' ? 'timings' : 'verification'}.json`, JSON.stringify({ reports, errors }, null, 2));
} finally { await browser.close(); }
