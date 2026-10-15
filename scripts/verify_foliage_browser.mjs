import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readMapGeometry } from './lib/readMapGeometry.mjs';

const output = resolve('artifacts/foliage-volume/browser');
mkdirSync(output, { recursive: true });
const source = readMapGeometry('baku', name => name === 'TREEC-material')[0];
const p = source.geometry.attributes.position, n = source.geometry.attributes.normal;
const vertices = Array.from({ length: 8 }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
const centre = [0, 1, 2].map(axis => (Math.min(...vertices.map(v => v[axis])) + Math.max(...vertices.map(v => v[axis]))) / 2);
const bottom = Math.min(...vertices.map(v => v[1]));
const fixture = {
  positions: vertices.flatMap(v => [v[0] - centre[0], v[1] - bottom, v[2] - centre[2]]),
  normals: Array.from({ length: 8 }, (_, i) => [n.getX(i), n.getY(i), n.getZ(i)]).flat(),
  uv: Array.from(source.geometry.attributes.uv.array.slice(0, 16)),
  indices: Array.from(source.geometry.index.array.slice(0, 12)), matrix: source.matrixWorld.toArray(),
};
const instrumentation = `
clock.getDelta=()=>1/60;
window.__foliageProbe={
 ready:()=>mode!=='loading',
 view:(pose=0,quality='balanced',preset='sunny',night=false)=>{
   mode='pause';keys.clear();resetCar(false,false,{position:new THREE.Vector3(550,806,.7),heading:0});
   graphics.setQuality(quality);localReflections.setQuality(quality);weather.setQuality(quality);
   setWeather(preset,false);setNightMode(night,false);updateSceneLighting(0);
   for(const id of ['menu','hud','pause','garage','loading'])ui[id].classList.add('hidden');
   const poses=[[[562,799,4],[549.5,826,7]],[[536,798,5],[549.5,826,7]],[[568,799,2],[549.5,826,7]]];
   camera.position.fromArray(poses[pose][0]);camera.lookAt(...poses[pose][1]);
   camera.fov=48;camera.updateProjectionMatrix();updateCamera=()=>{};
   governmentHouse.update=()=>{};sky.material.uniforms.time.value=0;
   scene.updateMatrixWorld(true);worldOptimization.update();localReflections.invalidate();shadowCache.invalidate();
 },
 state:()=>({graphics:graphics.stats,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,
   foliage:(()=>{const result=[];scene.traverse(o=>{if(o.material?.name==='TREEC-material')result.push({
     volume:!!o.geometry.attributes.foliageVolume,batched:!!o.isBatchedMesh});});return result;})()}),
 fixture:(data,angle=0,solid=false,light=true)=>{
   mode='loading';
   const testScene=new THREE.Scene();testScene.background=new THREE.Color(0x7da7c2);
   const geometry=new THREE.BufferGeometry();
   for(const [name,values,size] of [['position',data.positions,3],['normal',data.normals,3],['uv',data.uv,2]])
     geometry.setAttribute(name,new THREE.Float32BufferAttribute(values,size));
   geometry.setIndex(data.indices);
   let treeMaterial;scene.traverse(o=>{if(o.material?.name==='TREEC-material')treeMaterial=o.material;});
   const material=new THREE.MeshStandardMaterial({name:'TREEC-material',map:solid?null:treeMaterial.map,
     color:solid?0x819867:0xffffff,side:THREE.DoubleSide,alphaTest:solid?0:.38,alphaToCoverage:true,roughness:.85});
   applyFoliageLighting(material);
   const mesh=new THREE.Mesh(geometry,material);prepareFoliageGeometry(mesh);
   mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(data.matrix);testScene.add(mesh);
   if(light){const key=new THREE.DirectionalLight(0xfff7ee,2.75);key.position.set(12,-20,20);testScene.add(key);
     const fill=new THREE.HemisphereLight(0xd6e3ee,0x79817e,.65);fill.position.set(0,0,1);testScene.add(fill);}
   const view=new THREE.PerspectiveCamera(48,1100/800,.15,100);view.up.set(0,0,1);
   view.position.set(Math.sin(angle)*26,-Math.cos(angle)*26,7);view.lookAt(0,0,7);
   renderer.setRenderTarget(null);renderer.toneMappingExposure=.97;renderer.render(testScene,view);
   geometry.dispose();material.dispose();
 }
};`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { errors: [], shaderErrors: [], runs: [] };
const settle = page => page.evaluate(async () => { for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame); });
const capture = (page, name) => page.screenshot({ path: `${output}/${name}.png` });
try {
  for (const fallback of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
    if (fallback) await context.addInitScript(() => {
      const original = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function(name) {
        return name === 'WEBGL_multi_draw' ? null : original.call(this, name);
      };
    });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', m => { if (/THREE.WebGLProgram|VALIDATE_STATUS|Shader Error/i.test(m.text())) report.shaderErrors.push(m.text()); });
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\n' + instrumentation });
    });
    await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5186', { timeout: 180000 });
    await page.waitForFunction(() => window.__foliageProbe?.ready(), null, { timeout: 240000 });
    const prefix = fallback ? 'fallback' : 'multi-draw', run = { fallback, checks: [] };
    run.hardware = await page.evaluate(() => {
      const gl = document.querySelector('#game').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        multiDraw: !!gl.getExtension('WEBGL_multi_draw') };
    });
    report.runs.push(run);
    for (const [pose, quality, preset, night] of [
      [0, 'balanced', 'sunny', false], [1, 'balanced', 'sunny', false], [2, 'balanced', 'sunny', false],
      [0, 'performance', 'sunny', false], [0, 'cinematic', 'sunny', false],
      [0, 'balanced', 'overcast', false], [0, 'balanced', 'wet', false],
      [0, 'balanced', 'rain', false], [0, 'balanced', 'snow', false], [0, 'balanced', 'sunny', true],
    ]) {
      await page.evaluate(args => window.__foliageProbe.view(...args), [pose, quality, preset, night]); await settle(page);
      const label = `${prefix}-${pose}-${quality}-${preset}-${night ? 'night' : 'day'}`;
      await capture(page, label); run.checks.push(label);
      const state = await page.evaluate(() => window.__foliageProbe.state());
      assert.ok(state.foliage.length > 0 && state.foliage.every(m => m.volume), 'rendered canopy retains volume data');
      run.state = state;
    }
    if (!fallback) {
      for (const angle of [0, .65, 1.3, 2.1, Math.PI]) {
        await page.evaluate(args => window.__foliageProbe.fixture(...args), [fixture, angle]);
        await capture(page, `isolated-tree-${angle.toFixed(2)}`);
      }
      await page.evaluate(args => window.__foliageProbe.fixture(...args), [fixture, 0, true]);
      const lit = await capture(page, 'solid-crown-lit');
      const { data, info } = await sharp(lit).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const luma = (x, y) => { const i = (y * info.width + x) * 3; return data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722; };
      run.crownSamples = [400, 450, 500, 550, 600, 650, 700].map(x => luma(x, 350));
      assert.ok(Math.max(...run.crownSamples) - Math.min(...run.crownSamples) > 12, 'a solid-colour crown has visible lighting depth');
      const reversed = { ...fixture, indices: fixture.indices.map((_, i, indices) => indices[Math.floor(i / 3) * 3 + 2 - i % 3]) };
      await page.evaluate(args => window.__foliageProbe.fixture(...args), [reversed, 0, true]);
      const reversedPixels = await sharp(await capture(page, 'solid-crown-reversed-winding')).removeAlpha().raw().toBuffer();
      let windingDifference = 0;
      for (let i = 0; i < data.length; i++) windingDifference += Math.abs(data[i] - reversedPixels[i]);
      run.windingDifference = windingDifference / data.length;
      assert.ok(run.windingDifference < .01, 'reversing card triangles cannot create bright/dark wedges');
      await page.evaluate(args => window.__foliageProbe.fixture(...args), [fixture, 0, true, false]);
      const dark = await sharp(await capture(page, 'solid-crown-unlit')).removeAlpha().raw().toBuffer();
      const middle = (350 * info.width + 550) * 3;
      assert.ok(Math.max(...dark.subarray(middle, middle + 3)) < 2, 'foliage cannot glow without incident light');
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.shaderErrors, []);
    writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2));
    console.log(`${prefix}: ${run.checks.length} scene views, three presets, five weather modes and day/night passed.`);
    await context.close();
  }
} finally { await browser.close(); }
console.log('Foliage browser checks passed: real tree angles, lighting depth, no emission and both rendering paths.');
