import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import playwright from 'playwright';
const url=process.env.GAME_URL??'http://127.0.0.1:5173',server=process.env.CITY_TEST_SERVER??'ws://127.0.0.1:8788';
const output=process.env.CITY_CLEANUP_OUTPUT??'artifacts/city-cleanup/browser';mkdirSync(output,{recursive:true});
const baselineSource=process.env.CITY_CLEANUP_BASELINE??'artifacts/city-cleanup/baseline/src';
const compare=process.env.CITY_CLEANUP_COMPARE==='1';
if(compare)assert.ok(existsSync(`${baselineSource}/main.js`),'save the previous city source before comparing');
const instrumentation=`
clock.getDelta=()=>1/60;renderer.info.autoReset=false;
const cleanup={rows:[],remaining:0,resolve:null,last:performance.now(),physics:0,contacts:0};
const cleanupResolve=barrierCollision.resolve;barrierCollision.resolve=function(...args){const time=performance.now();const hit=cleanupResolve.apply(this,args);cleanup.physics+=performance.now()-time;if(hit)cleanup.contacts++;return hit;};
graphicsDiagnostics.begin=()=>{renderer.info.reset();cleanup.start=performance.now();cleanup.physics=0;};
graphicsDiagnostics.end=()=>{const now=performance.now(),row={cpu:now-cleanup.start,interval:now-cleanup.last,physics:cleanup.physics,culling:worldOptimization.stats.milliseconds,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};cleanup.last=now;if(cleanup.remaining){cleanup.rows.push(row);if(--cleanup.remaining===0){if(cleanup.drivingMeasurement){keys.clear();mode='pause';updateCamera=()=>{};cleanup.drivingMeasurement=false;}cleanup.resolve();cleanup.resolve=null;}}};
const cleanupOriginalCamera=updateCamera;
window.__cleanup={
 ready:()=>mode!=='loading',
 report:()=>typeof cityCollisions==='undefined'?null:cityCollisions.report,
 state:()=>({position:car.position.toArray(),physics:handling.position.toArray(),speed:handling.velocity.length(),multiplayer:isMultiplayer,remotes:[...(multiplayerSession?.remotes.values()??[])].map(r=>r.currentPosition.toArray()),id:multiplayerSession?.ownId}),
 setup:()=>{keys.clear();graphics.setQuality('cinematic');localReflections.setQuality('cinematic');weather.setQuality('cinematic');setWeather('sunny',false);setNightMode(false,false);resetCar(false,false);mode='pause';for(const id of ['menu','hud','pause','garage','loading'])ui[id].classList.add('hidden');},
 view:(pos,target)=>{mode='pause';updateCamera=()=>{};camera.position.fromArray(pos);camera.lookAt(...target);camera.updateProjectionMatrix();scene.updateMatrixWorld(true);worldOptimization.update();},
 frames:n=>new Promise(resolve=>{cleanup.rows=[];cleanup.remaining=n;cleanup.resolve=resolve;}),
 results:()=>({rows:cleanup.rows,world:{...worldOptimization.stats}}),
 drive:()=>{resetCar(false,false);mode='drive';cameraReady=false;updateCamera=cleanupOriginalCamera;keys.add('KeyW');},
 driveFrames:n=>new Promise(resolve=>{resetCar(false,false);mode='drive';cameraReady=false;updateCamera=cleanupOriginalCamera;keys.add('KeyW');cleanup.rows=[];cleanup.remaining=n;cleanup.resolve=resolve;cleanup.drivingMeasurement=true;}),
 stop:()=>{keys.clear();mode='pause';updateCamera=()=>{};return {position:handling.position.toArray(),speed:handling.velocity.length()};},
 prepareMP:()=>{graphics.setQuality('performance');localReflections.setQuality('performance');weather.setQuality('performance');},
 surface:(point)=>sampleGround(new THREE.Vector3(...point).add(new THREE.Vector3(0,0,2)),new THREE.Vector3(0,0,-1),4),
 treeDrive:()=>{
  for(const trunk of cityCollisions.trunks){
    const from=new THREE.Vector3(trunk.x-5,trunk.y,trunk.bottom),ground=sampleGround(from.clone().add(new THREE.Vector3(0,0,3)),new THREE.Vector3(0,0,-1),8);
    const far=sampleGround(new THREE.Vector3(trunk.x+3,trunk.y,trunk.bottom+3),new THREE.Vector3(0,0,-1),8);
    if(!ground||!far)continue;from.z=ground.point.z;const state=createDynamicsState(-Math.PI/2,activeVehicle,from);
    const hit=barrierCollision.sweep(state.position,state.quaternion,new THREE.Vector3(10,0,0),activeVehicle,state.comHeight);
    const expected=trunk.x-activeVehicle.dims.length/2-.025-trunk.radius;
    if(!hit||Math.abs(from.x+10*hit.time-expected)>.04)continue;
    resetCar(false,false,{position:from,heading:-Math.PI/2});cleanup.contacts=0;keys.add('KeyW');mode='drive';cameraReady=false;updateCamera=cleanupOriginalCamera;
    return {trunk,from:from.toArray(),expected};
  }throw new Error('No clear drivable trunk test location');
 },
 treeStop:()=>{keys.clear();mode='pause';handling.velocity.set(0,0,0);multiplayerSession?.sendImmediateState();return {contacts:cleanup.contacts,position:car.position.toArray(),finite:Number.isFinite(handling.position.length())};},
};
`;
const browser=await playwright.chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const report={measurements:[],errors:[],shaderErrors:[]};
const settle=(page,n=30)=>page.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame);},n);
async function pageIn(context,variant){
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(/THREE.WebGLProgram|Shader Error/i.test(m.text()))report.shaderErrors.push(m.text());});
 await page.route('**/src/main.js*',async route=>{
   const response=await route.fetch(variant==='before'?{url:`${url}/${baselineSource}/main.js`}:{});
   await route.fulfill({response,body:await response.text()+'\n'+instrumentation});
 });
 await page.goto(`${url}/?server=${encodeURIComponent(server)}`,{timeout:180000});await page.waitForFunction(()=>window.__cleanup?.ready(),null,{timeout:240000});return page;
}
function summarize(rows){return Object.fromEntries(Object.keys(rows[0]).map(key=>{const values=rows.map(r=>r[key]).sort((a,b)=>a-b);return[key,{median:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)]}];}));}
try{
 for(const variant of [...(compare?['before']:[]),'after']){
   const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});const page=await pageIn(context,variant);
   await page.evaluate(()=>window.__cleanup.setup());await page.evaluate(()=>window.__cleanup.frames(60));await page.evaluate(()=>window.__cleanup.driveFrames(180));
   const pose=await page.evaluate(()=>window.__cleanup.stop()),data=await page.evaluate(()=>window.__cleanup.results());const row={variant,pose,metrics:summarize(data.rows),world:data.world};row.fps=1000/row.metrics.interval.median;
   report.measurements.push(row);console.log(JSON.stringify({variant,fps:row.fps,cpu:row.metrics.cpu.median,physics:row.metrics.physics.median,calls:row.metrics.calls.median,triangles:row.metrics.triangles.median}));
   if(variant==='after'){report.collisions=await page.evaluate(()=>window.__cleanup.report());assert.equal(report.collisions.trunks,1219);}
   for(const [name,pos,target]of [['floating-start',[665,440,5],[680,457,16]],['starting-street',[687,471,4],[680,479,1]],['government-asphalt',[677,482,6],[677,535,.7]],['faded-markings',[702,481,15],[680,480,.5]]]){
     await page.evaluate(args=>window.__cleanup.view(...args),[pos,target]);await settle(page);await page.screenshot({path:`${output}/${variant}-${name}.png`});
   }
   writeFileSync(`${output}/results.json`,JSON.stringify(report,null,2));await context.close();
 }
 if(compare)assert.deepEqual(report.measurements[1].pose,report.measurements[0].pose,'unaffected driving position and speed stay exact');
 if(process.env.CITY_MULTIPLAYER_TEST==='1'){
   const contexts=[],pages=[];
   for(let i=0;i<2;i++){
     const context=await browser.newContext({viewport:{width:960,height:600}});contexts.push(context);const page=await pageIn(context,'after');pages.push(page);
     await page.evaluate(()=>window.__cleanup.prepareMP());await page.locator('#multiplayer-button').click();await page.locator('#mp-nick-input').fill(`Collision QA ${i+1}`);
     await page.waitForFunction(server=>document.getElementById('mp-server-input').value===server,server,{timeout:10000});
     await page.locator('#mp-join-button').click();await page.waitForFunction(()=>document.getElementById('mp-status')?.textContent==='CONNECTED',null,{timeout:20000});
   }
   for(const page of pages)await page.waitForFunction(()=>window.__cleanup.state().remotes.length===1,null,{timeout:20000});
   const tree=await pages[0].evaluate(()=>window.__cleanup.treeDrive());await settle(pages[0],180);const result=await pages[0].evaluate(()=>window.__cleanup.treeStop());
   assert.ok(result.contacts>0&&result.finite,'connected owner collides with real trunk using the same physics');
   await settle(pages[1],40);const owner=await pages[0].evaluate(()=>window.__cleanup.state()),observer=await pages[1].evaluate(()=>window.__cleanup.state());
   const distance=Math.hypot(...owner.position.map((v,i)=>v-observer.remotes[0][i]));assert.ok(distance<.25,'observer receives the collision-correct owner position');
   report.multiplayer={clients:2,tree,result,remotePositionError:distance,owner,observer};
   await pages[0].screenshot({path:`${output}/multiplayer-trunk.png`});
   for(const context of contexts)await context.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaderErrors,[]);writeFileSync(`${output}/results.json`,JSON.stringify(report,null,2));console.log('City cleanup browser verification passed.');
}finally{await browser.close();}
