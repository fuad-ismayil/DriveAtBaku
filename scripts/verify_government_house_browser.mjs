import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const url=process.env.GAME_URL??'http://127.0.0.1:5186';
const output=resolve('artifacts/government-house/browser');mkdirSync(output,{recursive:true});
const instrumentation=`
clock.getDelta=()=>1/60;
let houseFlagUpdate;
window.__houseProbe={
 ready:()=>mode!=='loading',
 view:(position,target,night=false,quality='cinematic',preset='sunny')=>{
   mode='pause';keys.clear();setNightMode(night,false);setWeather(preset,false);
   resetCar(false,false,{position:new THREE.Vector3(745,550,2),heading:0});
   graphics.setQuality(quality);localReflections.setQuality(quality);weather.setQuality(quality);
   worldOptimization.setDistances({renderDistance:6000,propsDistance:3000});
   for(const id of ['menu','hud','pause','garage','loading'])ui[id].classList.add('hidden');
   camera.position.fromArray(position);camera.lookAt(new THREE.Vector3(...target));
   camera.fov=48;camera.updateProjectionMatrix();updateCamera=()=>{};
   houseFlagUpdate??=governmentHouse.update;governmentHouse.update=()=>{};sky.material.uniforms.time.value=0;
   scene.updateMatrixWorld(true);worldOptimization.update();localReflections.invalidate();
 },
 state:()=>({night:governmentHouse.nightEnabled,stats:governmentHouse.stats,
   landmarkEmission:[...new Set((()=>{const materials=[];scene.traverse(o=>{
     if(o.material?.name?.startsWith('Government House'))materials.push(o.material);
   });return materials;})())].map(m=>({name:m.name,intensity:m.emissive
     ?m.emissiveIntensity*Math.max(m.emissive.r,m.emissive.g,m.emissive.b):0})),
   geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,
   distance:{...worldOptimization.stats}}),
 toggle:night=>{setNightMode(night,false);sky.material.uniforms.time.value=0;},
 occlusion:enabled=>{worldOptimization.occlusion=enabled;worldOptimization.update();},
 advanceFlag:seconds=>{for(let t=0;t<Math.round(seconds*120);t++)houseFlagUpdate(1/120);},
 flag:()=>{
   const mesh=scene.getObjectByName('Government House simulated flag cloth');
   return {positions:[...mesh.geometry.attributes.position.array],normals:[...mesh.geometry.attributes.normal.array],
     uv:[...mesh.geometry.attributes.uv.array],texture:mesh.material.map.uuid,
     attached:mesh.position.toArray(),doubleSided:mesh.material.side===THREE.DoubleSide};
 },
};`;
const views={
 front:[[745,475,24],[680,630,28]],
 close:[[735,550,8],[710,620,35]],
 courtyard:[[682,594,8],[668,654,26]],
 rear:[[619,776,20],[680,630,26]],
 overview:[[830,450,140],[680,630,15]],
 distant:[[820,260,15],[680,630,28]],
 flag:[[704,572,54],[694,601,51]],
};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const report={errors:[],shaderErrors:[],runs:[]};
const settle=async(page,n=20)=>page.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame);},n);
const difference=async(a,b)=>{
 const pa=await sharp(a).removeAlpha().raw().toBuffer(),pb=await sharp(b).removeAlpha().raw().toBuffer();
 let changed=0,total=0;for(let i=0;i<pa.length;i+=3){const d=Math.max(...[0,1,2].map(j=>Math.abs(pa[i+j]-pb[i+j])));if(d>3)changed++;total+=d;}
 return {fraction:changed/(pa.length/3),mean:total/(pa.length/3)};
};
const capture=async(page,name)=>page.screenshot({path:`${output}/${name}.png`});
try{
 for(const fallback of [false,true]){
  const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  if(fallback)await context.addInitScript(()=>{
   const original=WebGL2RenderingContext.prototype.getExtension;
   WebGL2RenderingContext.prototype.getExtension=function(name){return name==='WEBGL_multi_draw'?null:original.call(this,name);};
  });
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(/THREE.WebGLProgram|VALIDATE_STATUS|Shader Error/i.test(m.text()))report.shaderErrors.push(m.text());});
  await page.route('**/src/main.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n'+instrumentation});});
  await page.goto(url,{timeout:180000});await page.waitForFunction(()=>window.__houseProbe?.ready(),null,{timeout:240000});
  const hardware=await page.evaluate(()=>{const gl=document.querySelector('#game').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),multiDraw:!!gl.getExtension('WEBGL_multi_draw')};});
  const run={fallback,hardware,checks:[]};report.runs.push(run);
  const prefix=fallback?'fallback':'landmark';
  await page.evaluate(args=>window.__houseProbe.view(...args),[...views.front,false]);await settle(page,30);
  const day=await capture(page,`${prefix}-day`),initial=await page.evaluate(()=>window.__houseProbe.state());
  assert.equal(initial.stats.windows,360);assert.equal(initial.stats.materials,3);assert.equal(initial.night,false);
  assert.ok(initial.landmarkEmission.every(m=>m.intensity===0),'all added materials are unlit during the day');
  await page.evaluate(()=>window.__houseProbe.toggle(true));await settle(page);
  const night=await capture(page,`${prefix}-night`);
  assert.equal((await page.evaluate(()=>window.__houseProbe.state())).night,true);
  run.nightDifference=await difference(day,night);assert.ok(run.nightDifference.fraction>.15,'night changes the rendered landmark');
  await page.evaluate(()=>window.__houseProbe.toggle(false));await settle(page);
  const restored=await capture(page,`${prefix}-day-restored`);
  assert.ok((await page.evaluate(()=>window.__houseProbe.state())).landmarkEmission.every(m=>m.intensity===0),'returning to day zeroes all added material emission');
  run.dayRestoration=await difference(day,restored);assert.ok(run.dayRestoration.fraction<.0005,'architectural and interior lights switch completely off in day mode');
  for(const quality of ['performance','balanced','cinematic']){
   await page.evaluate(args=>window.__houseProbe.view(...args),[...views.close,true,quality]);await settle(page);
   await capture(page,`${prefix}-night-close-${quality}`);run.checks.push(`night/${quality}`);
  }
  if(!fallback){
   await page.evaluate(args=>window.__houseProbe.view(...args),[...views.flag,false]);await settle(page);
   const flagBefore=await page.evaluate(()=>window.__houseProbe.flag());
   const flagStill=await capture(page,`${prefix}-flag-wind-0`);
   for(let i=1;i<=4;i++){
    await page.evaluate(()=>window.__houseProbe.advanceFlag(.6));await settle(page,2);
    await capture(page,`${prefix}-flag-wind-${i}`);
   }
   const flagAfter=await page.evaluate(()=>window.__houseProbe.flag());
   assert.notDeepEqual(flagAfter.positions,flagBefore.positions,'wind changes the actual cloth geometry');
   assert.notDeepEqual(flagAfter.normals,flagBefore.normals,'fold lighting follows the moving fabric');
   assert.deepEqual(flagAfter.uv,flagBefore.uv);assert.equal(flagAfter.texture,flagBefore.texture);
   assert.deepEqual(flagAfter.attached,flagBefore.attached);assert.equal(flagAfter.doubleSided,true);
   for(let row=0;row<=16;row++)assert.deepEqual(flagAfter.positions.slice(row*33*3,row*33*3+3),flagBefore.positions.slice(row*33*3,row*33*3+3),'hoist is pinned');
   run.flagDifference=await difference(flagStill,await capture(page,`${prefix}-flag-wind-final`));
   assert.ok(run.flagDifference.fraction>.001,'rendered flag visibly waves');
   run.checks.push('simulated flag gusts, pinned hoist and dynamic normals');
   for(const [name,view]of Object.entries(views)){
    await page.evaluate(args=>window.__houseProbe.view(...args),[...view,false]);await settle(page);
    await capture(page,`${prefix}-${name}-day`);
    await page.evaluate(()=>window.__houseProbe.toggle(true));await settle(page);
    await capture(page,`${prefix}-${name}-night`);run.checks.push(name);
   }
   for(const preset of ['overcast','rain','snow']){
    await page.evaluate(args=>window.__houseProbe.view(...args),[...views.close,true,'balanced',preset]);await settle(page,30);
    await capture(page,`${prefix}-${preset}`);run.checks.push(preset);
   }
  }
  await page.evaluate(args=>window.__houseProbe.view(...args),[...views.close,true]);await settle(page);
  const on=await capture(page,`${prefix}-occlusion-on`);
  await page.evaluate(()=>window.__houseProbe.occlusion(false));await settle(page);
  const off=await capture(page,`${prefix}-occlusion-off`);
  run.occlusionDifference=await difference(on,off);assert.ok(run.occlusionDifference.fraction<.001,'open galleries and relief survive conservative occlusion');
  const memory=await page.evaluate(()=>window.__houseProbe.state());
  for(let i=0;i<8;i++){await page.evaluate(n=>window.__houseProbe.toggle(n),i%2===0);await settle(page,2);}
  const final=await page.evaluate(()=>window.__houseProbe.state());
  assert.equal(final.textures,memory.textures,'mode toggles allocate no textures');assert.equal(final.geometries,memory.geometries,'mode toggles allocate no geometry');
  run.initial=initial;run.final=final;
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaderErrors,[]);
  writeFileSync(`${output}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({fallback,hardware,dayRestoration:run.dayRestoration,occlusion:run.occlusionDifference,checks:run.checks}));
  await context.close();
 }
 console.log('Government House browser checks passed: real rendering, seven views, simulated cloth motion, three quality presets, weather, both batching paths, night-only lighting, occlusion and stable resources.');
}finally{await browser.close();}
