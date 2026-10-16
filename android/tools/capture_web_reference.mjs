import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const output='artifacts/android/web-reference';mkdirSync(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:5199,strictPort:true,hmr:false}});
let browser;
const instrumentation=`
window.__nativeReference={ready:()=>mode!=='loading', view:(night,preset,lights)=>{
 mode='pause';keys.clear();updateCamera=()=>{};
 for(const id of ['menu','hud','pause','garage','loading','controls'])ui[id]?.classList.add('hidden');
 setNightMode(night,false);setWeather(preset,false);
 graphics.setQuality('balanced');localReflections.setQuality('balanced');weather.setQuality('balanced');
 headlightMode=lights;applyHeadlightMode(car);
 car.position.set(681.197388,479.707794,.34);
 const offset=new THREE.Vector3(0,-5.6,2.4).applyQuaternion(car.quaternion);
 camera.position.copy(car.position).add(offset);camera.lookAt(car.position.clone().add(new THREE.Vector3(0,0,.8)));
 camera.fov=75;camera.updateProjectionMatrix();scene.updateMatrixWorld(true);localReflections.invalidate();
 }, house:()=>{camera.position.set(650,480,10);camera.lookAt(new THREE.Vector3(680,625,24));camera.updateProjectionMatrix();},
 info:()=>({headlightMode,nightMode,weather:weather.mode,camera:camera.position.toArray(),car:car.position.toArray(),renderer:renderer.info.render})};`;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const page=await browser.newPage({viewport:{width:1480,height:720},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/src/main.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\n'+instrumentation});});
 await page.goto('http://127.0.0.1:5199/',{timeout:180000});
 await page.waitForFunction(()=>window.__nativeReference?.ready(),null,{timeout:240000});
 for(const [name,night,preset,lights]of [['day',false,'sunny',0],['night_off',true,'sunny',0],['night_low',true,'sunny',1],['night_high',true,'sunny',2],['night_rain',true,'rain',2]]){
  await page.evaluate(args=>__nativeReference.view(...args),[night,preset,lights]);
  await page.waitForTimeout(name==='night_rain'?15000:2500);
  await page.screenshot({path:`${output}/${name}.png`});
 }
 await page.evaluate(()=>__nativeReference.house());await page.waitForTimeout(1500);await page.screenshot({path:`${output}/house_night_rain.png`});
 writeFileSync(`${output}/report.json`,JSON.stringify({errors,state:await page.evaluate(()=>__nativeReference.info())},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('WEB_REFERENCE_CAPTURE_PASS daylight, nighttime beams, rain and Government House.');
}finally{await browser?.close();await server.close();}
