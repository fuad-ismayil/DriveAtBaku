import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const output=resolve('artifacts/room-lights/browser');mkdirSync(output,{recursive:true});
const focused=process.env.ROOM_LIGHTS_FOCUSED==='1';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const report={errors:[],shaderErrors:[],runs:[]};
const hook=`
clock.getDelta=()=>1/60;let roomStep;
window.__rooms={ready:()=>mode!=='loading',
 view:(pos,target,night=true,quality='cinematic',preset='sunny')=>{
  mode='pause';keys.clear();setNightMode(night,false);setWeather(preset,false);
  if(!roomStep){roomStep=roomLights.update.bind(roomLights);roomLights.update=()=>{};governmentHouse.update=()=>{};}
  graphics.setQuality(quality);localReflections.setQuality(quality);weather.setQuality(quality);
  worldOptimization.setDistances({renderDistance:6000,propsDistance:3000});
  for(const id of ['menu','hud','pause','garage','loading'])ui[id].classList.add('hidden');
  resetCar(false,false,{position:new THREE.Vector3(pos[0],pos[1],2),heading:0});
  camera.position.fromArray(pos);camera.lookAt(new THREE.Vector3(...target));camera.fov=55;camera.updateProjectionMatrix();updateCamera=()=>{};
  sky.material.uniforms.time.value=0;scene.updateMatrixWorld(true);worldOptimization.update();localReflections.invalidate();
 },
 enabled:enabled=>{roomLights.group.visible=enabled;},
 advance:seconds=>roomStep(seconds),
 toggle:night=>{setNightMode(night,false);sky.material.uniforms.time.value=0;},
 state:()=>({stats:roomLights.stats,time:roomLights.activity.time,events:roomLights.activity.events,night:roomLights.activity.night,
  visible:roomLights.group.visible,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,
  lit:Array.from({length:roomLights.activity.count},(_,id)=>roomLights.activity.states[id*4+1]).reduce((a,b)=>a+b,0)}),
};`;
const settle=(page,n=20)=>page.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame)},n);
const difference=async(a,b)=>{const x=await sharp(a).removeAlpha().raw().toBuffer(),y=await sharp(b).removeAlpha().raw().toBuffer();let changed=0,energy=0;
 for(let i=0;i<x.length;i+=3){const delta=Math.max(...[0,1,2].map(j=>Math.abs(x[i+j]-y[i+j])));if(delta>4)changed++;energy+=delta;}return {pixels:changed,fraction:changed/(x.length/3),mean:energy/(x.length/3)};};
const shots=(page,name)=>page.screenshot({path:`${output}/${name}.png`});
const views={government:[[745,475,24],[680,630,28]],residential:[[785,860,12],[735,815,24]],
 urban:[[-540,-150,7],[-580,-80,22]],skyline:[[760,540,12],[870,850,55]],street:[[680,480,4],[675,630,18]]};
try{
 for(const fallback of focused?[false]:[false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
  if(fallback)await context.addInitScript(()=>{const original=WebGL2RenderingContext.prototype.getExtension;WebGL2RenderingContext.prototype.getExtension=function(n){return n==='WEBGL_multi_draw'?null:original.call(this,n)};});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(/THREE.WebGLProgram|VALIDATE_STATUS|Shader Error/i.test(m.text()))report.shaderErrors.push(m.text())});
  await page.route('**/src/main.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n'+hook})});
  await page.goto(process.env.GAME_URL??'http://127.0.0.1:5186',{timeout:180000});await page.waitForFunction(()=>window.__rooms?.ready(),null,{timeout:240000});
  const prefix=fallback?'fallback':'city',run={fallback,views:{}};report.runs.push(run);
  for(const [name,view]of Object.entries(focused?{skyline:views.skyline}:fallback?{government:views.government}:views)){
   await page.evaluate(args=>window.__rooms.view(...args),[...view]);await settle(page,30);
   await page.evaluate(()=>window.__rooms.enabled(false));await settle(page);
   const before=await shots(page,`${prefix}-${name}-unlit`);
   await page.evaluate(()=>window.__rooms.enabled(true));await settle(page);
   const lit=await shots(page,`${prefix}-${name}-night`);
   run.views[name]=await difference(before,lit);
   if(name==='skyline'){
    const glass={left:1290,top:285,width:110,height:240};
    const [unlitGlass,litGlass]=await Promise.all([sharp(before).extract(glass).png().toBuffer(),sharp(lit).extract(glass).png().toBuffer()]);
    run.curtainWall=await difference(unlitGlass,litGlass);
    assert.ok(run.curtainWall.pixels<10,'circled continuous-glass tower receives no random room illumination');
    const sides={left:1170,top:305,width:100,height:230};
    const [unlitSide,litSide]=await Promise.all([sharp(before).extract(sides).png().toBuffer(),sharp(lit).extract(sides).png().toBuffer()]);
    run.sideWindows=await difference(unlitSide,litSide);
    assert.ok(run.sideWindows.pixels>200,'tower side windows retain their independent night lighting');
   }
   console.log(JSON.stringify({fallback,name,difference:run.views[name]}));
  }
  if(focused){
   assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaderErrors,[]);
   writeFileSync(`${output}/targeted-tower.json`,JSON.stringify(report,null,2));await context.close();continue;
  }
  assert.ok(run.views.government.pixels>200,'actual glass windows illuminate in the rendered city');
  await page.evaluate(args=>window.__rooms.view(...args),[...views.government]);await settle(page);
  const initial=await page.evaluate(()=>window.__rooms.state());assert.ok(initial.stats.rooms>30000);assert.ok(initial.lit/initial.stats.rooms>.25&&initial.lit/initial.stats.rooms<.43);
  const beforeActivity=await shots(page,`${prefix}-activity-start`);
  await page.evaluate(()=>window.__rooms.advance(600));await settle(page);
  const afterActivity=await shots(page,`${prefix}-activity-ten-minutes`),later=await page.evaluate(()=>window.__rooms.state());
  run.activity=await difference(beforeActivity,afterActivity);assert.ok(run.activity.pixels>100&&run.activity.fraction<.08,'time changes individual windows without changing whole facades');
  assert.ok(later.events>initial.events+5000);assert.ok(later.lit/initial.stats.rooms>.25&&later.lit/initial.stats.rooms<.43);
  await page.evaluate(()=>window.__rooms.toggle(false));await settle(page);
  const day=await shots(page,`${prefix}-day`),paused=await page.evaluate(()=>window.__rooms.state());
  assert.equal(paused.visible,false);assert.equal(paused.night,false);await page.evaluate(()=>window.__rooms.advance(1800));
  assert.equal((await page.evaluate(()=>window.__rooms.state())).events,paused.events,'no activity during day mode');
  const dayLater=await shots(page,`${prefix}-day-later`);run.dayDifference=await difference(day,dayLater);assert.ok(run.dayDifference.fraction<.001);
  for(const quality of ['performance','balanced','cinematic']){
   await page.evaluate(args=>window.__rooms.view(...args),[...views.residential,true,quality]);await settle(page);
   await shots(page,`${prefix}-${quality}`);
  }
  if(!fallback)for(const preset of ['rain','snow']){
   await page.evaluate(args=>window.__rooms.view(...args),[...views.government,true,'balanced',preset]);await settle(page);
   await shots(page,`${prefix}-${preset}`);
  }
  await page.evaluate(args=>window.__rooms.view(...args),[...views.government,true,'balanced']);await settle(page);
  await page.evaluate(()=>window.__rooms.toggle(false));await settle(page);
  await page.evaluate(()=>window.__rooms.toggle(true));await settle(page);
  const memory=await page.evaluate(()=>window.__rooms.state());
  for(let i=0;i<8;i++){await page.evaluate(n=>window.__rooms.toggle(n),i%2===0);await settle(page,2);}
  const final=await page.evaluate(()=>window.__rooms.state());assert.equal(final.textures,memory.textures);assert.equal(final.geometries,memory.geometries);
  run.initial=initial;run.final=final;assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaderErrors,[]);
  writeFileSync(`${output}/results.json`,JSON.stringify(report,null,2));await context.close();
 }
 console.log(focused?'Tower lighting passed: side windows illuminated, central glass panel unlit, no rendering errors.':'Room lighting browser checks passed: actual window pixels, independent activity, night/day gating, presets, weather, both render paths and stable resources.');
}finally{await browser.close();}
