import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { summarizeFrames } from './lib/performanceMetrics.mjs';
import playwright from 'playwright';
const output = resolve(process.argv[2] ?? 'artifacts/engine-investigation/current');
const url = process.env.GAME_URL ?? 'http://127.0.0.1:5186';
const frames = Number(process.env.FRAMES ?? 180), warmup = Number(process.env.WARMUP ?? 90);
const repeats = Number(process.env.REPEATS ?? 2), passMode = process.env.PASS_PROFILE === '1';
const variants = (process.env.VARIANTS ?? 'current').split(',');
const resolutions = (process.env.RESOLUTIONS ?? '1080,720').split(',').map(Number);
const qualities = (process.env.QUALITIES ?? 'balanced,performance,cinematic').split(',');
const scenarios = (process.env.SCENARIOS ?? 'idle,urban,drive,fast,night,rain,garage').split(',');
const experiments = (process.env.EXPERIMENTS ?? process.env.EXPERIMENT ?? 'normal').split(',');
mkdirSync(output, { recursive: true });
const instrumentation = `
import { GpuTimer } from '/src/gpuTimer.js';
clock.getDelta = () => 1/60;
renderer.info.autoReset = false;
const timer = new GpuTimer(renderer.getContext(), { maxPending: 2048 });
const probe = { rows: [], remaining: 0, row: null, resolve: null, last: 0, started: 0, stack: ['frame'] };
function scope(owner, key, label, gpu = false) {
  const original = owner[key]; if (!original) return;
  owner[key] = function(...args) {
    const name = typeof label === 'function' ? label(...args) : label;
    if (!name) return original.apply(this, args);
    const row = probe.row, start = performance.now();
    if(row && gpu && !${passMode} && !timer.active)timer.begin('frame',row);
    if (row && gpu && ${passMode}) { timer.end(); probe.stack.push(name); timer.begin(name, row); }
    try { return original.apply(this, args); }
    finally {
      if (row) row['cpu.' + name] = (row['cpu.' + name] ?? 0) + performance.now() - start;
      if (row && gpu && ${passMode}) { timer.end(); probe.stack.pop(); timer.begin(probe.stack.at(-1), row); }
    }
  };
}
const functions = { updateCar, updateCamera, updateSceneLighting };
for (const key of Object.keys(functions)) scope(functions, key, key);
updateCar=functions.updateCar; updateCamera=functions.updateCamera; updateSceneLighting=functions.updateSceneLighting;
scope(worldOptimization,'update','culling'); scope(weather,'update','weather'); scope(tireEffects,'update','tires');
scope(graphics,'render','render',true); scope(localReflections,'update','reflections',true);
scope(renderer,'render',renderedScene=>renderedScene===scene ? (probe.stack.includes('reflections')?'reflection.faces':'beauty.scene') : null,true);
scope(renderer.shadowMap,'render','shadows',true);
function hookPasses() {
  const generator=globalThis.__profileReflectionGenerator;
  if(generator&&!generator.benchmarkHooked){generator.benchmarkHooked=true;scope(generator,'fromCubemap','reflection.pmrem',true);}
  const passes=globalThis.__profilePasses;
  if (!passes || passes.hooked) return;
  passes.hooked=true;
  if(passes.smaa){
    passes.smaa.benchmarkEdge={format:passes.smaa._edgesRT.texture.format,type:passes.smaa._edgesRT.texture.type};
    const original=passes.smaa.render,clear=new THREE.Color();
    passes.smaa.render=function(...args){
      if(!globalThis.__smaaBlack)return original.apply(this,args);
      renderer.getClearColor(clear);const alpha=renderer.getClearAlpha();renderer.setClearColor(0,0);
      try{return original.apply(this,args);}finally{renderer.setClearColor(clear,alpha);}
    };
  }
  for (const [key,pass] of Object.entries(passes)) if(pass && key!=='hooked') scope(pass,'render',key,true);
  if(passes.ao) scope(passes.ao,'_renderPass',(_renderer,material)=>material===passes.ao.gtaoMaterial?'ao.evaluate':'ao.denoise',true);
  if(passes.smaa)scope(passes.smaa._fsQuad,'render',()=>passes.smaa._fsQuad.material===passes.smaa._materialEdges?'smaa.edges':passes.smaa._fsQuad.material===passes.smaa._materialWeights?'smaa.weights':'smaa.blend-output',true);
}
const rawSetTarget=renderer.setRenderTarget;
const targets=new Map();
renderer.setRenderTarget=function(target,...args){
  if(probe.row&&!${passMode}&&!timer.active)timer.begin('frame',probe.row);
  if(target)targets.set(target,target);return rawSetTarget.call(this,target,...args);
};
const renderGL=renderer.getContext();
for(const key of ['useProgram','linkProgram','bufferData','bufferSubData','texImage2D','texSubImage2D']){
  const original=renderGL[key];renderGL[key]=function(...args){
    if(probe.row){probe.row[key]=(probe.row[key]??0)+1;
      if(key==='bufferSubData'){
        const data=args[2],offset=args[3]??0,length=args[4]||((data?.length??0)-offset);
        const bytes=data?.BYTES_PER_ELEMENT?length*data.BYTES_PER_ELEMENT:data?.byteLength??0;
        probe.row.bufferUploadBytes=(probe.row.bufferUploadBytes??0)+bytes;
      }
      if(key==='bufferData')probe.row.bufferUploadBytes=(probe.row.bufferUploadBytes??0)+(args[1]?.byteLength??(typeof args[1]==='number'?args[1]:0));
    }return original.apply(this,args);
  };
}
graphicsDiagnostics.begin = () => {
  timer.poll(); hookPasses(); renderer.info.reset();
  probe.started=performance.now();
  probe.row=probe.remaining ? { interval: probe.last ? probe.started-probe.last : null, pending:0,
    useProgram:0,linkProgram:0,bufferData:0,bufferSubData:0,texImage2D:0,texSubImage2D:0,bufferUploadBytes:0 } : null;
  probe.last=probe.started;
  if(probe.row && ${passMode}) timer.begin('frame',probe.row);
};
// The served harness owns queries; the optional visible overlay stays idle.
graphicsDiagnostics.startGPU = () => {};
graphicsDiagnostics.end = () => {
  timer.end();
  if(probe.row){
    Object.assign(probe.row,{cpu:performance.now()-probe.started,calls:renderer.info.render.calls,
      triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,
      programs:renderer.info.programs?.length,heap:performance.memory?.usedJSHeapSize});
    probe.rows.push(probe.row);probe.row=null;probe.remaining--;
    if(!probe.remaining)probe.finishedAt=performance.now();
  }
  timer.poll();
  if(probe.resolve && !probe.remaining && performance.now()-probe.finishedAt>5000 && timer.pending.length){timer.discard();probe.queryTimeouts=(probe.queryTimeouts??0)+1;}
  if(probe.resolve && !probe.remaining && probe.rows.every(row=>!row.pending)) {
    const resolve=probe.resolve;probe.resolve=null;resolve(probe.rows);
  }
};
const originalCamera=updateCamera;
window.__engineProbe={
  ready:()=>mode!=='loading',
  replay:scenario=>{
    keys.clear();resetCar(false,false);mode='drive';startDrive();updateCamera=originalCamera;
    if(scenario==='urban-drive'){
      const from=new THREE.Vector3(...route.checkpoints[7]),forward=new THREE.Vector3(...route.checkpoints[8]).sub(from).setZ(0).normalize();
      resetCar(false,false,{position:from,heading:Math.atan2(-forward.x,forward.y)});
    }
    if(scenario==='fast'){const forward=new THREE.Vector3(0,1,0).applyQuaternion(handling.quaternion);handling.velocity.copy(forward).multiplyScalar(35);}
    keys.add('KeyW');localReflections.invalidate();
  },
  timer:()=>({supported:timer.supported,...timer.stats,pending:timer.pending.length,timeouts:probe.queryTimeouts??0}),
  measure:(n,replayScenario)=>new Promise(resolve=>{if(replayScenario)window.__engineProbe.replay(replayScenario);probe.rows=[];probe.last=0;probe.remaining=n;probe.resolve=resolve;}),
  prepare:({quality,height,scenario,experiment})=>{
    keys.clear(); if(mode==='garage') closeGarage();
    graphics.setQuality(quality);localReflections.setQuality(quality);weather.setQuality(quality);graphics.setAO(true);graphics.setRenderScale(1);
    if(${process.env.USE_NATIVE==='1'}){
      globalThis.__benchmarkRatio=undefined;if(graphics.setRenderingResolution)graphics.setRenderingResolution('native');else graphics.resize();
    }
    else if(graphics.setRenderingResolution)graphics.setRenderingResolution(height===720?'1280x720':'1920x1080');
    else{globalThis.__benchmarkRatio=Math.min(height*16/9/innerWidth,height/innerHeight);graphics.resize();}
    setWeather(scenario==='rain'?'rain':'sunny',false);setNightMode(scenario.startsWith('night'),false);
    headlightMode=scenario==='night-lights'?1:0;for(const vehicle of carCache.values())applyHeadlightMode(vehicle);
    resetCar(false,false); mode='drive';startDrive();updateCamera=originalCamera;
    if(scenario==='urban'||scenario==='urban-drive'){
      const from=new THREE.Vector3(...route.checkpoints[7]),to=new THREE.Vector3(...route.checkpoints[8]);
      const forward=to.sub(from).setZ(0).normalize();resetCar(false,false,{position:from,heading:Math.atan2(-forward.x,forward.y)});
    }
    if(scenario==='fast'){
      const forward=new THREE.Vector3(0,1,0).applyQuaternion(handling.quaternion);handling.velocity.copy(forward).multiplyScalar(35);
    }
    if(['idle','urban'].includes(scenario)){
      mode='pause';camera.position.copy(car.position).add(new THREE.Vector3(6,-9,3));camera.lookAt(car.position.clone().add(new THREE.Vector3(0,0,.8)));
      camera.fov=62;camera.updateProjectionMatrix();updateCamera=()=>{};
    }
    if(['drive','fast','night','night-lights','rain','urban-drive'].includes(scenario))keys.add('KeyW');
    if(scenario==='garage')openGarage();
    worldOptimization.occlusion=experiment!=='occlusion-off';
    worldOptimization.hierarchicalFrustum=experiment!=='frustum-original';worldOptimization.cullDirty=true;
    if(experiment==='ao-off')graphics.setAO(false);
    hookPasses();globalThis.__smaaBlack=experiment.startsWith('smaa-black');
    const edgeTarget=globalThis.__profilePasses?.smaa?._edgesRT;
    if(edgeTarget){
      const compact=experiment.endsWith('rg8'),force=experiment.startsWith('smaa-black'),original=globalThis.__profilePasses.smaa.benchmarkEdge;
      const format=force?(compact?THREE.RGFormat:THREE.RGBAFormat):original.format,type=force?(compact?THREE.UnsignedByteType:THREE.HalfFloatType):original.type;
      if(edgeTarget.texture.format!==format||edgeTarget.texture.type!==type){edgeTarget.dispose();edgeTarget.texture.format=format;edgeTarget.texture.type=type;}
    }
    for(const lamp of car.userData.headlights??[])lamp.visible=experiment!=='zero-lights' || lamp.intensity>0;
    localReflections.invalidate();scene.updateMatrixWorld(true);worldOptimization.update();
    for(const id of ['menu','hud','pause','garage','loading'])ui[id].classList.add('hidden');
  },
  state:()=>({graphics:graphics.stats,quality:graphics.quality,world:{...worldOptimization.stats},reflections:{...localReflections.stats},shadow:{...shadowCache.stats},
    pose:car.position.toArray(),viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,buffer:[renderer.getContext().drawingBufferWidth,renderer.getContext().drawingBufferHeight],
    canvasAA:renderer.getContext().getParameter(renderer.getContext().SAMPLES),visualViewport:visualViewport?.scale,
    renderTargets:[...targets.values()].filter(t=>renderer.properties.get(t).__webglFramebuffer).map(t=>({width:t.width,height:t.height,samples:t.samples,cube:!!t.isWebGLCubeRenderTarget,
      attachments:t.textures.map(x=>({format:x.format,type:x.type})),depth:t.depthBuffer,depthTexture:!!t.depthTexture}))}),
  cullingAB:()=>{
    const result={original:[],hierarchical:[]},saved=worldOptimization.hierarchicalFrustum;
    for(let i=0;i<320;i++)for(const hierarchical of i%2?[true,false]:[false,true]){
      worldOptimization.hierarchicalFrustum=hierarchical;worldOptimization.cullDirty=true;
      const start=performance.now();worldOptimization.update();const elapsed=performance.now()-start;
      if(i>=80)result[hierarchical?'hierarchical':'original'].push(elapsed);
    }
    worldOptimization.hierarchicalFrustum=saved;worldOptimization.cullDirty=true;worldOptimization.update();return result;
  },
  snapshot:async({weatherMode='sunny',night=false,garage=false})=>{
    keys.clear();if(mode==='garage')closeGarage();setWeather(weatherMode,false);setNightMode(night,false);resetCar(false,false);animateCarModel(car,handling,0);
    mode=garage?'garage':'pause';updateSceneLighting(0);mode='loading';
    camera.position.copy(car.position).add(new THREE.Vector3(6,-9,3));camera.lookAt(car.position.clone().add(new THREE.Vector3(0,0,.8)));camera.fov=62;camera.updateProjectionMatrix();
    scene.getObjectByName('tire marks').visible=false;scene.getObjectByName('subtle tire smoke').visible=false;
    sky.material.uniforms.time.value=0;for(const name of ['weather rain','weather snow'])scene.getObjectByName(name).material.uniforms.weatherTime.value=0;
    scene.updateMatrixWorld(true);worldOptimization.update();localReflections.invalidate();
    for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);sky.position.copy(camera.position);weather.update(0,camera,!garage);localReflections.update(1/60,car,carCache.values(),garage);graphics.render(1/60);}
    return window.__engineProbe.state();
  }
};
`;
const browser = await playwright.chromium.launch({ channel:'chrome',headless:process.env.HEADED!=='1',
  args:['--disable-background-timer-throttling','--disable-renderer-backgrounding',...(process.env.GPU_PREFERENCE==='high'?['--force_high_performance_gpu']:[])] });
const report={date:new Date().toISOString(),frames,warmup,repeats,passMode,windowState:process.env.WINDOW_STATE??'controlled-viewport',samples:[],errors:[]};
try {
  for(const variant of variants){
    const context=await browser.newContext(process.env.WINDOW_STATE?{viewport:null}:{viewport:{width:Number(process.env.VIEWPORT_WIDTH??1920),height:Number(process.env.VIEWPORT_HEIGHT??1080)},deviceScaleFactor:Number(process.env.PIXEL_RATIO??1)});
    const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push({variant,error:String(e)}));
    page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text().slice(0,500));});
    page.on('console',msg=>{if(/THREE.WebGLProgram|Shader Error|CONTEXT_LOST/.test(msg.text()))report.errors.push({variant,error:msg.text()});});
    await page.addInitScript(()=>{localStorage.setItem('baku-selected-car','ferrari');localStorage.setItem('baku-render-scale','1');localStorage.setItem('baku-rendering-resolution','native');});
    await page.route(/\/graphics\.js(?:\?.*)?$/,async route=>{
      const response=await route.fetch();let body=await response.text();
      body=body.replace('composer.addPass(new OutputPass());','composer.addPass(new OutputPass()); globalThis.__profilePasses={beauty:scenePass,ao,bloom,grade,smaa,output:composer.passes.at(-1)};');
      if(!body.includes('globalThis.__profilePasses'))body=body.replace('composer.addPass(smaa);','composer.addPass(smaa); globalThis.__profilePasses={beauty:scenePass,ao,bloom,grade,smaa};');
      body=body.replace('Math.min(devicePixelRatio, PRESETS[quality].pixelRatio) * renderScale','(globalThis.__benchmarkRatio ?? Math.min(devicePixelRatio, PRESETS[quality].pixelRatio) * renderScale)');
      await route.fulfill({response,body});
    });
    await page.route(/\/streetAOPass\.js(?:\?.*)?$/,async route=>{
      const response=await route.fetch();let body=(await response.text()).replace('super(scene, camera, 1, 1);',`const savedRandom=Math.random;let noiseSeed=41;Math.random=()=>{noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;return noiseSeed/4294967296;};super(scene,camera,1,1);Math.random=savedRandom;`);
      await route.fulfill({response,body});
    });
    await page.route(/\/localReflections\.js(?:\?.*)?$/,async route=>{
      const response=await route.fetch();const body=(await response.text()).replace('generator = new THREE.PMREMGenerator(renderer);','generator = new THREE.PMREMGenerator(renderer);globalThis.__profileReflectionGenerator=generator;');
      await route.fulfill({response,body});
    });
    await page.route('**/src/main.js*',async route=>{
      const response=await route.fetch(variant!=='current'?{url:url+'/artifacts/engine-investigation/'+variant+'/src/main.js'}:{});
      await route.fulfill({response,body:(await response.text())+'\n'+instrumentation});
    });
    await page.goto(url,{timeout:180000});await page.waitForFunction(()=>window.__engineProbe?.ready(),null,{timeout:240000});
    const hardware=await page.evaluate(()=>{
      const gl=document.querySelector('#game').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
      return{renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,
        unmasked:!!ext,timerQueries:!!gl.getExtension('EXT_disjoint_timer_query_webgl2'),version:navigator.userAgent,screen:[screen.width,screen.height],dpr:devicePixelRatio};
    });
    if(/SwiftShader|llvmpipe|Software Rasterizer/i.test(hardware.renderer))throw new Error('Software renderer rejected: '+hardware.renderer);
    if(!hardware.unmasked)throw new Error('Cannot verify the rendering adapter: unmasked GPU information is unavailable.');
    report.hardware=hardware;console.log(JSON.stringify({variant,hardware}));
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    const layout=await cdp.send('Page.getLayoutMetrics');
    report.browserZoom={zoom:layout.cssVisualViewport?.zoom??null,pinchScale:layout.cssVisualViewport?.scale??null};
    if(process.env.WINDOW_STATE){
      const{windowId}=await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
      await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:process.env.WINDOW_STATE}});
      await page.evaluate(async()=>{for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);});
      report.window=await cdp.send('Browser.getWindowBounds',{windowId});
    }
    for(let repeat=0;repeat<repeats;repeat++)for(const height of repeat%2?[...resolutions].reverse():resolutions)for(const quality of qualities)for(const scenario of scenarios)for(const experiment of repeat%2?[...experiments].reverse():experiments){
      await page.evaluate(args=>window.__engineProbe.prepare(args),{height,quality,scenario,experiment});
      await page.evaluate(n=>window.__engineProbe.measure(n),warmup);
      if(process.env.PROFILE_CPU==='1'){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
      // Begin replay and collection in ONE browser call. IPC latency must not
      // advance physics an arbitrary number of frames before collection starts.
      const rows=await page.evaluate(({frames,scenario})=>window.__engineProbe.measure(frames,['drive','fast','night','night-lights','rain','urban-drive'].includes(scenario)?scenario:null),{frames,scenario});
      if(process.env.PROFILE_CPU==='1'){const{profile}=await cdp.send('Profiler.stop');writeFileSync(`${output}/${variant}-${height}-${quality}-${scenario}-${repeat}.cpuprofile`,JSON.stringify(profile));}
      const state=await page.evaluate(()=>window.__engineProbe.state()),timer=await page.evaluate(()=>window.__engineProbe.timer());
      const sample={variant,height,quality,scenario,repeat,experiment,...summarizeFrames(rows),state,timer,rows};report.samples.push(sample);
      writeFileSync(output+'/results.json',JSON.stringify(report,null,2));
      console.log(JSON.stringify({variant,height,quality,scenario,repeat,experiment,gpu:sample.metrics.gpu,cpu:sample.metrics.cpu,fps:sample.fps,passes:passMode?sample.passes:undefined,buffer:state.buffer}));
    }
    if(process.env.SNAPSHOTS==='1')for(const [label,settings] of Object.entries({sunny:{},rain:{weatherMode:'rain'},snow:{weatherMode:'snow'},night:{night:true},garage:{garage:true}})){
      await page.evaluate(()=>window.__engineProbe.prepare({quality:'balanced',height:1080,scenario:'idle',experiment:'normal'}));
      const state=await page.evaluate(settings=>window.__engineProbe.snapshot(settings),settings);
      await page.screenshot({path:`${output}/${variant}-${label}.png`});writeFileSync(`${output}/${variant}-${label}.json`,JSON.stringify(state,null,2));
    }
    if(process.env.CPU_CULL_AB==='1'&&variant==='current'){
      report.cullingAB??=[];
      for(const scenario of ['idle','urban']){
        await page.evaluate(args=>window.__engineProbe.prepare(args),{height:1080,quality:'balanced',scenario,experiment:'normal'});
        await page.evaluate(n=>window.__engineProbe.measure(n),60);
        const samples=await page.evaluate(()=>window.__engineProbe.cullingAB());
        const metrics=Object.fromEntries(Object.entries(samples).map(([method,values])=>[method,summarizeFrames(values.map(cpu=>({cpu}))).metrics.cpu]));
        report.cullingAB.push({scenario,metrics});console.log(JSON.stringify({cullingAB:{scenario,metrics}}));
      }
    }
    await context.close();
  }
}finally{writeFileSync(output+'/results.json',JSON.stringify(report,null,2));await browser.close();}
