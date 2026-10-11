import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';
const url=process.env.GAME_URL??'http://127.0.0.1:5173';
const server=process.env.INDICATOR_TEST_SERVER??'ws://127.0.0.1:8787';
const out='artifacts/indicators';mkdirSync(out,{recursive:true});
const instrumentation=`
window.__signals={
 ready:()=>mode!=='loading',
 prepare:()=>{graphics.setQuality('balanced');localReflections.setQuality('balanced');weather.setQuality('balanced');graphics.setOcclusion?.(false);keys.clear();updateCamera=()=>{};for(const id of ['menu','pause','garage','loading','controls'])ui[id].classList.add('hidden');mode='drive';ui.hud.classList.remove('hidden');document.activeElement?.blur();},
 select:async id=>{await selectVehicle(id);},
 view:side=>{const offset=new THREE.Vector3(...(side==='rear'?[2.3,-4.8,1.5]:side==='side'?[5,0,1.5]:[-2.3,4.8,1.5])).applyQuaternion(car.quaternion);camera.position.copy(car.position).add(offset);camera.lookAt(car.position.clone().add(new THREE.Vector3(0,0,.85)));camera.updateProjectionMatrix();scene.updateMatrixWorld(true);},
 rearLampView:remoteId=>{const vehicle=remoteId?multiplayerSession.remotes.get(remoteId).car:car;ui.hud.classList.add('hidden');camera.position.copy(vehicle.position).add(new THREE.Vector3(0,-5,1.2).applyQuaternion(vehicle.quaternion));camera.lookAt(vehicle.localToWorld(new THREE.Vector3(0,-1.6,.88)));camera.updateProjectionMatrix();scene.updateMatrixWorld(true);},
 rearLampAreas:remoteId=>{const vehicle=remoteId?multiplayerSession.remotes.get(remoteId).car:car;camera.updateMatrixWorld(true);return [-.685,.685].map(x=>{const p=vehicle.localToWorld(new THREE.Vector3(x,-1.99,.873)).project(camera);return {left:Math.round((p.x+1)*innerWidth/2)-12,top:Math.round((1-p.y)*innerHeight/2)-12,width:24,height:24};});},
 remotePhotograph:(id,on)=>{window.__indicatorRemoteFreeze=multiplayerSession.remotes.get(id).buffer.at(-1).state.li.sigAt+(on?100:500);},
 photograph:on=>{window.__indicatorFreeze=indicatorState.startedAt+(on?100:500);},
 unfreeze:()=>{delete window.__indicatorFreeze;delete window.__indicatorRemoteFreeze;},
 atmosphere:(preset,night)=>{setWeather(preset,false);setNightMode(night,false);},
 drive:()=>{mode='drive';document.activeElement?.blur();},
 sample:()=>({mode:indicatorState.mode,revision:indicatorState.revision,start:indicatorState.startedAt,serverAt:indicatorState.serverAt,now:multiplayerSession?.client.getServerTime(),levels:car.userData.indicators.levels.value.toArray(),car:activeVehicle.id,head:headlightMode,seq:multiplayerSession?.seq,id:multiplayerSession?.ownId,remotes:[...(multiplayerSession?.remotes.values()??[])].map(r=>({id:r.id,car:r.carId,mode:r.buffer.at(-1)?.state.li.sig,at:r.buffer.at(-1)?.state.li.sigAt,levels:r.car?.userData.indicators?.levels.value.toArray(),ready:!!r.car,disposed:r.disposed})),memory:{...renderer.info.memory},calls:renderer.info.render.calls}),
 paused:()=>pause(), resumed:()=>{mode='drive';ui.pause.classList.add('hidden');document.activeElement?.blur();},
 garage:()=>openGarage(), garageExit:()=>{closeGarage();mode='drive';updateCamera=()=>{};document.activeElement?.blur();},
 recover:()=>recoverInPlace(),restart:()=>restartAtSpawn(),
 light:()=>cycleHeadlights(),brake:on=>{handling.brakeForceInput=on?1:0;handling.gear=on?0:1;},
 phase:()=>{const start=indicatorState.serverAt??indicatorState.startedAt;const now=indicatorState.serverAt!==null?multiplayerSession.client.getServerTime():performance.now();return (now-start)%800;},
 disposeRace:async()=>{const remote=[...multiplayerSession.remotes.values()][0];let release;const original=remote.createVehicleModel;remote.createVehicleModel=async id=>{await new Promise(r=>release=r);return original(id);};remote._initVehicle('prado');remote.dispose();release();while(remote.isLoadingVehicle)await new Promise(requestAnimationFrame);return {disposed:remote.disposed,attached:!!remote.car?.parent};},
 reconnect:()=>multiplayerSession.client.ws.close(),
 moving:on=>{mode='drive';if(on)keys.add('KeyW');else keys.clear();},
 distant:()=>{mode='pause';keys.clear();const pos=car.position.clone().add(new THREE.Vector3(0,500,0));resetCar(false,false,{position:pos,heading:handling.heading});multiplayerSession.sendImmediateState();return pos.toArray();},
 stop:()=>exitToMenu(),
};`;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const report={errors:[],shaders:[],scenarios:[],multiplayer:[]};
const settle=(p,n=8)=>p.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame);},n);
const sample=p=>p.evaluate(()=>__signals.sample());
async function pageIn(context){const p=await context.newPage();p.on('pageerror',e=>report.errors.push(String(e)));p.on('console',m=>{if(/THREE.WebGLProgram|Shader Error|INVALID_OPERATION/i.test(m.text()))report.shaders.push(m.text());});await p.route('**/src/main.js*',async r=>{const response=await r.fetch();const body=(await response.text()).replace('indicatorState.startedAt, performance.now());','indicatorState.startedAt, window.__indicatorFreeze ?? performance.now());');await r.fulfill({response,body:body+'\n'+instrumentation});});await p.route('**/src/net/RemotePlayer.js*',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.getServerTime?.() ?? Date.now() + this.serverTimeOffsetMs);','window.__indicatorRemoteFreeze ?? (this.getServerTime?.() ?? Date.now() + this.serverTimeOffsetMs));')});});await p.goto(`${url}/?server=${encodeURIComponent(server)}`,{timeout:180000});await p.waitForFunction(()=>window.__signals?.ready(),null,{timeout:240000});return p;}
async function press(p,key,expected){await p.evaluate(()=>__signals.drive());await p.keyboard.press(key);await settle(p,2);assert.equal((await sample(p)).mode,expected);}
async function join(p,nick){await p.evaluate(()=>__signals.stop());await p.locator('#multiplayer-button').click();await p.locator('#mp-nick-input').fill(nick);await p.locator('#mp-join-button').click();await p.waitForFunction(()=>__signals.sample().id,null,{timeout:20000});await p.evaluate(()=>__signals.prepare());console.log(`${nick}: joined local relay`);}
try {
 const context=await browser.newContext({viewport:{width:960,height:600},deviceScaleFactor:1});const p=await pageIn(context);await p.evaluate(()=>__signals.prepare());
 assert.equal(await p.locator('.event-chip').count(),0,'only requested badge is removed');assert.equal(await p.locator('#minimap').count(),1);
 for(const id of (process.env.INDICATOR_MP_ONLY==='1'?[]:(process.env.INDICATOR_TEST_VEHICLES?.split(',')??['ferrari','elantra','amg','prado']))) {
  await p.evaluate(id=>__signals.select(id),id);await settle(p);
  for(const [key,expected]of [[',','left'],[',','off'],['.','right'],[',','left'],['/','hazard'],['.','right'],['/','hazard'],['/','off']])await press(p,key,expected);
  await p.keyboard.down(',');await p.keyboard.down(',');await p.keyboard.down(',');await p.keyboard.up(',');assert.equal((await sample(p)).mode,'left','held key repeats do not toggle');await press(p,',','off');
  await p.evaluate(()=>{const input=document.createElement('input');input.id='signal-typing';document.body.appendChild(input);input.focus();});await p.keyboard.type(',./');assert.equal((await sample(p)).mode,'off');assert.equal(await p.locator('#signal-typing').inputValue(),',./');await p.locator('#signal-typing').evaluate(e=>e.remove());
  await press(p,'/','hazard');for(const preset of ['sunny','overcast','wet','rain','snow'])for(const night of [false,true]) {
    await p.evaluate(args=>__signals.atmosphere(...args),[preset,night]);await settle(p,8);
    await p.evaluate(()=>__signals.photograph(true));
    for(const side of ['front','rear']) {await p.evaluate(side=>__signals.view(side),side);await settle(p,2);const pixels=await p.screenshot({path:`${out}/${id}-${preset}-${night?'night':'day'}-${side}.png`});
      const amber=async bytes=>{const {data}=await sharp(bytes).extract({left:220,top:200,width:420,height:245}).removeAlpha().raw().toBuffer({resolveWithObject:true});let count=0;for(let i=0;i<data.length;i+=3)if(data[i]>140&&data[i+1]>45&&data[i]-data[i+1]>20&&data[i+1]-data[i+2]>20)count++;return count;};
      const lit=await amber(pixels);assert.ok(lit>4,`${id}/${preset}/${night}/${side}: visible amber lamp pixels`);
      if(preset==='sunny'){await p.evaluate(()=>__signals.photograph(false));await settle(p,2);const off=await amber(await p.screenshot({path:`${out}/${id}-${night?'night':'day'}-${side}-off.png`}));assert.ok(lit-off>4,`${id}/${night}/${side}: amber appears only during on phase (${lit} vs ${off})`);await p.evaluate(()=>__signals.photograph(true));}
    }
    await p.evaluate(()=>__signals.unfreeze());
    report.scenarios.push({id,preset,night,...await sample(p)});
  }
  await p.evaluate(()=>__signals.atmosphere('sunny',false));await p.evaluate(()=>__signals.paused());const rev=(await sample(p)).revision;await p.keyboard.press('.');assert.equal((await sample(p)).revision,rev);await p.evaluate(()=>__signals.resumed());
  if(id==='elantra') {
    // Each crop covers one rear lamp; front/mirror signals cannot satisfy it.
    await p.evaluate(()=>__signals.rearLampView());
    const areas=await p.evaluate(()=>__signals.rearLampAreas());
    const counts=async bytes=>Promise.all(areas.map(async area=>{const {data}=await sharp(bytes).extract(area).removeAlpha().raw().toBuffer({resolveWithObject:true});let n=0;for(let i=0;i<data.length;i+=3)if(data[i]>140&&data[i+1]>45&&data[i]-data[i+1]>20&&data[i+1]-data[i+2]>20)n++;return n;}));
    for(const night of [false,true]) {
      await p.evaluate(night=>__signals.atmosphere('sunny',night),night);
      await p.evaluate(()=>__signals.photograph(false));await settle(p,4);const baseline=await counts(await p.screenshot());
      for(const [key,expected]of [[',','left'],['.','right'],['/','hazard']]) {
        await press(p,key,expected);await p.evaluate(()=>__signals.photograph(true));await settle(p,4);
        const lit=await counts(await p.screenshot({path:`${out}/elantra-rear-${expected}-${night?'night':'day'}.png`}));
        for(let side=0;side<2;side++){const enabled=expected==='hazard'||expected===(side?'right':'left');assert.ok(enabled?lit[side]-baseline[side]>8:Math.abs(lit[side]-baseline[side])<5,`Elantra ${expected}/${night}: rear ${side?'right':'left'} lamp alone responds (${lit[side]} vs ${baseline[side]})`);}
      }
      await p.evaluate(()=>__signals.photograph(false));await settle(p,4);const off=await counts(await p.screenshot());assert.ok(off.every((n,i)=>Math.abs(n-baseline[i])<5),'both rear lamps extinguish during blink off phase');
    }
    await p.evaluate(()=>__signals.unfreeze());
  }
  await p.evaluate(()=>__signals.garage());await settle(p);assert.equal((await sample(p)).mode,'hazard');await p.evaluate(()=>__signals.garageExit());
  await p.evaluate(()=>__signals.recover());await p.evaluate(()=>__signals.restart());assert.equal((await sample(p)).mode,'hazard');
  for(let i=0;i<3;i++){await p.evaluate(()=>__signals.light());await settle(p);assert.equal((await sample(p)).mode,'hazard');}
  const before=(await sample(p)).memory;for(let i=0;i<20;i++){await press(p,',','left');await press(p,'.','right');await press(p,'/','hazard');}const after=(await sample(p)).memory;assert.deepEqual(after,before,'mode changes do not allocate textures or geometry');
  console.log(`${id}: input transitions, ten weather/time cases, garage/pause/reset/headlights and memory passed`);
 }
 if(process.env.INDICATOR_VISUAL_ONLY!=='1') {
 await p.evaluate(()=>__signals.atmosphere('sunny',false));await p.evaluate(()=>__signals.select('ferrari'));await join(p,'Indicator driver');await press(p,'/','hazard');
 const observerContext=await browser.newContext({viewport:{width:640,height:480}});
 await observerContext.addInitScript(serverUrl=>{
   const originalNow=Date.now;Date.now=()=>originalNow()+6*3600000;
   const BaseSocket=WebSocket;
   window.WebSocket=class extends BaseSocket {
     constructor(url,...args){super(url,...args);this.signalLag=String(url)===serverUrl;}
     send(data){if(this.signalLag)setTimeout(()=>{if(this.readyState===BaseSocket.OPEN)super.send(data);},90);else super.send(data);}
     set onmessage(fn){super.onmessage=this.signalLag?event=>setTimeout(()=>fn(event),90):fn;}
     get onmessage(){return super.onmessage;}
   };
 },server);
 const observer=await pageIn(observerContext);await join(observer,'Indicator observer');
 await observer.waitForFunction(()=>__signals.sample().remotes.some(r=>r.ready&&r.mode==='hazard'),null,{timeout:30000});
 const own=(await sample(p)).id;
 for(const [key,expected] of [[',','left'],['.','right'],['/','hazard'],['/','off'],['/','hazard']]) {
  await press(p,key,expected);await observer.waitForFunction(expected=>__signals.sample().remotes.some(r=>r.ready&&r.mode===expected),expected,{timeout:10000});
  const a=await sample(p),b=await sample(observer),r=b.remotes.find(r=>r.id===own);assert.equal(r.at,a.serverAt);report.multiplayer.push({mode:expected,reference:r.at});
 }
 await p.waitForFunction(()=>__signals.phase()>80&&__signals.phase()<250);assert.deepEqual((await sample(p)).levels,(await sample(observer)).remotes.find(r=>r.id===own).levels,'driver and observer share phase');
 for(const id of ['elantra','amg','prado']){await p.evaluate(id=>__signals.select(id),id);await observer.waitForFunction(id=>__signals.sample().remotes.some(r=>r.ready&&r.car===id&&r.mode==='off'),id,{timeout:30000});await press(p,'/','hazard');await observer.waitForFunction(()=>__signals.sample().remotes.some(r=>r.ready&&r.mode==='hazard'));
   if(id==='elantra') {
     await observer.evaluate(id=>__signals.rearLampView(id),own);
     const areas=await observer.evaluate(id=>__signals.rearLampAreas(id),own);
     const counts=async bytes=>Promise.all(areas.map(async area=>{const {data}=await sharp(bytes).extract(area).removeAlpha().raw().toBuffer({resolveWithObject:true});let n=0;for(let i=0;i<data.length;i+=3)if(data[i]>140&&data[i+1]>45&&data[i]-data[i+1]>20&&data[i+1]-data[i+2]>20)n++;return n;}));
     for(const night of [false,true]) {
       await observer.evaluate(night=>__signals.atmosphere('sunny',night),night);
       await observer.evaluate(id=>__signals.remotePhotograph(id,false),own);await settle(observer,5);const off=await counts(await observer.screenshot());
       await observer.evaluate(id=>__signals.remotePhotograph(id,true),own);await settle(observer,5);const lit=await counts(await observer.screenshot({path:`${out}/elantra-remote-rear-${night?'night':'day'}.png`}));
       assert.ok(lit.every((n,i)=>n-off[i]>8),'each remote Elantra rear lamp visibly flashes independently of its front/mirror indicators');
     }
     await observer.evaluate(()=>__signals.unfreeze());
   }
 }
 await p.evaluate(()=>__signals.moving(true));await settle(p,45);await p.evaluate(()=>__signals.moving(false));assert.equal((await sample(observer)).remotes[0].mode,'hazard','signals survive movement');
 await p.evaluate(()=>__signals.distant());await settle(observer,15);assert.equal((await sample(observer)).remotes[0].mode,'hazard','signals continue on a distant stationary vehicle');
 // Delay a model load until after disposal to exercise asynchronous cleanup.
 const race=await observer.evaluate(()=>__signals.disposeRace());assert.ok(race.disposed&&!race.attached);
 await observer.evaluate(()=>__signals.reconnect());await observer.waitForFunction(()=>__signals.sample().remotes.length===1&&__signals.sample().remotes[0].ready&&!__signals.sample().remotes[0].disposed,null,{timeout:30000});assert.equal((await sample(observer)).remotes[0].mode,'hazard');
 await p.evaluate(()=>__signals.stop());await observer.waitForFunction(()=>__signals.sample().remotes.length===0,null,{timeout:10000});
 await observerContext.close();
 }
 await context.close();
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaders,[]);
 console.log(`Browser: ${report.scenarios.length} weather/time cases and ${report.multiplayer.length} replicated mode transitions passed without page/shader errors.`);
} finally {writeFileSync(`${out}/results.json`,JSON.stringify(report,null,2));await browser.close();}
