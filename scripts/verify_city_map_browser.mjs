import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
const url = process.env.GAME_URL ?? 'http://localhost:5173';
const output = resolve('artifacts/city-map/browser'); mkdirSync(output,{recursive:true});
const compare = process.env.CITY_MAP_COMPARE === '1';
const instrumentation = `
clock.getDelta = () => 1/60;
renderer.info.autoReset = false;
const cityProbe = {rows:[],remaining:0,pending:[],resolve:null,last:performance.now()};
const cityOriginalCamera=updateCamera;
const cityGL=renderer.getContext(), cityTimer=cityGL.getExtension('EXT_disjoint_timer_query_webgl2');
graphicsDiagnostics.begin=()=>{
  renderer.info.reset();cityProbe.start=performance.now();
  sky.material.uniforms.time.value=0;
  if(cityTimer && cityProbe.remaining){cityProbe.query=cityGL.createQuery();cityGL.beginQuery(cityTimer.TIME_ELAPSED_EXT,cityProbe.query);}
};
graphicsDiagnostics.end=()=>{
  const now=performance.now();
  const row={cpu:now-cityProbe.start,interval:now-cityProbe.last,calls:renderer.info.render.calls,
    triangles:renderer.info.render.triangles,visibleTriangles:worldOptimization.stats.mainTriangles,
    culling:worldOptimization.stats.milliseconds,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures};
  cityProbe.last=now;
  if(cityProbe.query){cityGL.endQuery(cityTimer.TIME_ELAPSED_EXT);cityProbe.pending.push({query:cityProbe.query,row});cityProbe.query=null;}
  if(cityTimer){
    const disjoint=cityGL.getParameter(cityTimer.GPU_DISJOINT_EXT);
    while(cityProbe.pending.length && cityGL.getQueryParameter(cityProbe.pending[0].query,cityGL.QUERY_RESULT_AVAILABLE)){
      const p=cityProbe.pending.shift();if(!disjoint)p.row.gpu=cityGL.getQueryParameter(p.query,cityGL.QUERY_RESULT)/1e6;cityGL.deleteQuery(p.query);
    }
  }
  if(cityProbe.remaining){cityProbe.rows.push(row);if(--cityProbe.remaining===0){cityProbe.resolve();cityProbe.resolve=null;}}
};
window.__cityProbe={
  ready:()=>mode!=='loading',
  frames:n=>new Promise(resolve=>{cityProbe.rows=[];cityProbe.remaining=n;cityProbe.resolve=resolve;}),
  results:()=>({rows:cityProbe.rows,world:{...worldOptimization.stats}}),
  prepare:(quality,checkpoint=-1)=>{
    keys.clear();setWeather('sunny',false);setNightMode(false,false);resetCar(false,false);mode='pause';
    graphics.setQuality(quality);localReflections.setQuality(quality);weather.setQuality(quality);
    worldOptimization.setDistances({renderDistance:6000,propsDistance:3000});
    for(const id of ['menu','hud','pause','garage','loading'])ui[id].classList.add('hidden');
    camera.position.copy(car.position).add(new THREE.Vector3(6,-9,3));camera.lookAt(car.position.clone().add(new THREE.Vector3(0,0,.8)));
    if(checkpoint>=0){
      const from=new THREE.Vector3(...route.checkpoints[checkpoint]),to=new THREE.Vector3(...route.checkpoints[(checkpoint+1)%route.checkpoints.length]);
      const forward=to.sub(from).setZ(0).normalize();resetCar(false,false,{position:from,heading:Math.atan2(-forward.x,forward.y)});
      camera.position.copy(car.position).addScaledVector(forward,-8).add(new THREE.Vector3(0,0,3));
      camera.lookAt(car.position.clone().addScaledVector(forward,80).add(new THREE.Vector3(0,0,1.5)));
    }
    camera.fov=62;camera.updateProjectionMatrix();updateCamera=()=>{};
    scene.updateMatrixWorld(true);worldOptimization.update();localReflections.invalidate();
  },
  occlusion:enabled=>{worldOptimization.occlusion=enabled;worldOptimization.update();},
  beginDriving:()=>{resetCar(false,false);mode='drive';cameraReady=false;updateCamera=cityOriginalCamera;keys.add('KeyW');},
  endDriving:()=>{keys.clear();mode='pause';updateCamera=()=>{};return {position:handling.position.toArray(),speed:handling.velocity.length()};},
  inventory:()=>{const names=[];scene.traverse(o=>{if(o.isMesh){for(const m of Array.isArray(o.material)?o.material:[o.material])names.push(m.name);}});return names;},
  atmosphere:(preset,night)=>{setWeather(preset,false);setNightMode(night,false);},
  drive:async()=>{
    resetCar(false,false);mode='drive';cameraReady=false;const from=handling.position.clone();
    keys.add('KeyW');for(let i=0;i<180;i++)await new Promise(requestAnimationFrame);keys.clear();mode='pause';
    return {travel:handling.position.distanceTo(from),finite:Number.isFinite(handling.position.length()),ground:!!sampleGround(handling.position.clone(),new THREE.Vector3(0,0,-1),5)};
  },
};
`;
const metrics = rows => Object.fromEntries([...new Set(rows.flatMap(Object.keys))].map(key=>{
  const values=rows.map(r=>r[key]).filter(Number.isFinite).sort((a,b)=>a-b);
  return [key,{median:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],samples:values.length}];
}));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const report={measurements:[],occlusion:[],errors:[],shaderErrors:[]};
const settle = async (page,n=30) => page.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame);},n);
try {
  for(const variant of [...(compare?['before']:[]),'city',...(process.env.CITY_MAP_FALLBACK==='1'?['city-fallback']:[])]){
    const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
    if(variant==='city-fallback')await context.addInitScript(()=>{
      const original=WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension=function(name){return name==='WEBGL_multi_draw'?null:original.call(this,name);};
    });
    const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(`${variant}: ${e}`));
    page.on('console',m=>{if(/THREE.WebGLProgram|VALIDATE_STATUS|Shader Error/i.test(m.text()))report.shaderErrors.push(`${variant}: ${m.text()}`);});
    await page.route('**/src/main.js*',async route=>{
      const response=await route.fetch();let body=await response.text();
      if(variant==='before'){
        const hook='createCityMapPlugin(parser, mapAsset)';
        assert.ok(body.includes(hook),'baseline must disable the actual city loader hook');
        body=body.replace(hook,"({ name: 'BAKU_original_asset_probe' })");
      }
      await route.fulfill({response,body:body+'\n'+instrumentation});
    });
    await page.goto(url,{timeout:180000});await page.waitForFunction(()=>window.__cityProbe?.ready(),null,{timeout:240000});
    const hardware=await page.evaluate(()=>{
      const gl=document.querySelector('#game').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),multiDraw:!!gl.getExtension('WEBGL_multi_draw'),timerQueries:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};
    });
    const scenarios=variant==='city-fallback'?[['performance',-1],['cinematic',6]]:
      [['performance',-1],['balanced',-1],['cinematic',-1],['performance',6],['cinematic',6],['cinematic-drive',-1]];
    for(const [quality,checkpoint] of scenarios){
      await page.evaluate(args=>window.__cityProbe.prepare(...args),[quality.replace('-drive',''),checkpoint]);
      await page.evaluate(()=>window.__cityProbe.frames(60));
      if(quality.endsWith('-drive'))await page.evaluate(()=>window.__cityProbe.beginDriving());
      await page.evaluate(()=>window.__cityProbe.frames(180));
      const driving=quality.endsWith('-drive')?await page.evaluate(()=>window.__cityProbe.endDriving()):null;
      await settle(page,20);
      const measured=await page.evaluate(()=>window.__cityProbe.results());
      const row={variant,quality,checkpoint,hardware,metrics:metrics(measured.rows),world:measured.world,driving};
      row.fps=1000/row.metrics.interval.median;report.measurements.push(row);
      await page.screenshot({path:`${output}/${variant}-${quality}-${checkpoint}.png`});
      writeFileSync(`${output}/results.json`,JSON.stringify(report,null,2));
      console.log(JSON.stringify({variant,quality,checkpoint,fps:row.fps,calls:row.metrics.calls.median,triangles:row.metrics.triangles.median,gpu:row.metrics.gpu?.median}));
    }
    if(variant!=='before'){
      const audit=JSON.parse(readFileSync(new URL('../src/cityMapAudit.json',import.meta.url)));
      const excluded=new Set([...Object.keys(audit.baku),...Object.keys(audit.buildings)]);
      assert.ok((await page.evaluate(()=>window.__cityProbe.inventory())).every(n=>!excluded.has(n)),'no event geometry in main, shadow or reflection scene');
      for(const checkpoint of [-1,2,6,10]){
        await page.evaluate(args=>window.__cityProbe.prepare(...args),['performance',checkpoint]);
        await page.evaluate(()=>window.__cityProbe.occlusion(true));await settle(page);
        const on=await page.screenshot({path:`${output}/${variant}-occlusion-on-${checkpoint}.png`});
        const onStats=await page.evaluate(()=>window.__cityProbe.results().world);
        await page.evaluate(()=>window.__cityProbe.occlusion(false));await settle(page);
        const off=await page.screenshot({path:`${output}/${variant}-occlusion-off-${checkpoint}.png`});
        const a=await sharp(on).removeAlpha().raw().toBuffer(),b=await sharp(off).removeAlpha().raw().toBuffer();
        let changed=0,max=0;for(let i=0;i<a.length;i+=3){let delta=0;for(let j=0;j<3;j++)delta=Math.max(delta,Math.abs(a[i+j]-b[i+j]));max=Math.max(max,delta);if(delta>3)changed++;}
        const fraction=changed/(1280*720);report.occlusion.push({variant,checkpoint,changedPixels:changed,fraction,maxDelta:max,occludedChunks:onStats.occluded});
        assert.ok(fraction<.001,`conservative occlusion matches uncullled image at ${variant}/${checkpoint}: ${fraction}`);
      }
      if(variant==='city'){
        await page.evaluate(args=>window.__cityProbe.prepare(...args),['cinematic',2]);
        for(const [preset,night] of [['rain',false],['snow',false],['sunny',true]]){
          await page.evaluate(args=>window.__cityProbe.atmosphere(...args),[preset,night]);await settle(page,120);
          await page.screenshot({path:`${output}/city-${night?'night':preset}.png`});
        }
        await page.evaluate(args=>window.__cityProbe.prepare(...args),['performance',-1]);
        const drive=await page.evaluate(()=>window.__cityProbe.drive());assert.ok(drive.finite&&drive.ground&&drive.travel>4,'real car drives on unchanged road');report.drive=drive;
      }
    }
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaderErrors,[]);await context.close();
  }
  if(compare){
    const before=report.measurements.find(m=>m.variant==='before'&&m.driving);
    const city=report.measurements.find(m=>m.variant==='city'&&m.driving);
    assert.deepEqual(city.driving,before.driving,'matched driving benchmark retains the exact car position and speed');
  }
  writeFileSync(`${output}/results.json`,JSON.stringify(report,null,2));
  console.log('City map browser checks passed: real rendering, GPU/CPU measurements, all presets, conservative occlusion, atmosphere and driving.');
} finally {await browser.close();}
