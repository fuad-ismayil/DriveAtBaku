import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {fittedDisplay} from '../src/display.js';
import {markerAngle,MapNavigation} from '../src/mapView.js';
const url=process.env.GAME_URL||'http://localhost:5196';const out='artifacts/desktop-parity/web';mkdirSync(out,{recursive:true});
for(const [w,h] of [[1920,1080],[1920,1200],[2560,1080],[1280,720]]){
 assert.deepEqual(fittedDisplay(w,h),{width:w,height:h,left:0,top:0});
 for(const a of ['16:9','16:10','21:9','4:3']){const f=fittedDisplay(w,h,a);assert.ok(f.width<=w+1&&f.height<=h+1);}
}
assert.equal(markerAngle(Math.PI/2,0),-Math.PI/2);assert.equal(markerAngle(Math.PI/2,Math.PI/2),0);
const nav=new MapNavigation(),bounds={minX:-1000,minY:-1000,maxX:1000,maxY:1000};
nav.locate({x:300,y:-200},800,600,bounds);assert.deepEqual(nav.view(800,600,bounds).project({x:300,y:-200}),[400,300]);nav.zoomBy(100);assert.equal(nav.zoom,6);nav.reset();assert.equal(nav.zoom,1);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling']});
const errors=[];let heartbeat;
try{
 for(const [name,ua,viewport] of [['android','Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',{width:390,height:844}],['ipad','Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',{width:1024,height:768}]]){
  const page=await browser.newPage({userAgent:ua,viewport,isMobile:true,hasTouch:true});const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.goto(url);await page.locator('#mobile-download').waitFor({state:'visible'});await page.waitForTimeout(1500);
  assert.equal(await page.locator('#mobile-download [data-version]').textContent(),'v1.0.0');
  const heavy=requests.filter(u=>/main\.js|three|generated|\.glb|\.webp|\.ogg|\.mp3|draco|loadingScreen/.test(u));assert.deepEqual(heavy,[],`${name} must not load game assets`);
  await page.screenshot({path:`${out}/${name}-download.png`});await page.close();
 }
 const page=await browser.newPage({viewport:{width:1600,height:900}});page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
 await page.route('**/src/main.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`\nwindow.__parity={get mode(){return mode},get car(){return car},pause,resume,openFullMap,closeFullMap,mapNavigation};`});});
 console.log('Loading desktop');await page.goto(url);heartbeat=setInterval(async()=>{try{console.log('STATUS',await page.evaluate(()=>({mode:window.__parity?.mode,loading:document.getElementById('loading-copy')?.textContent,detail:document.getElementById('loading-detail')?.textContent})));}catch{}},15000);await page.waitForFunction(()=>window.__parity?.mode==='menu',null,{timeout:180000});clearInterval(heartbeat);
 await page.waitForTimeout(1500);await page.screenshot({path:`${out}/main-menu.png`});
 console.log('Desktop loaded');const nameplate=await page.evaluate(async()=>{
  const {RemotePlayer}=await import('/src/net/RemotePlayer.js');const THREE=await import('/node_modules/.vite/deps/three.js');
  const p=Object.create(RemotePlayer.prototype);p.nick='Test Driver';p.scene=new THREE.Scene();p.currentPosition=new THREE.Vector3(10,20,3);p._initNameplate();
  const c=p.nameplateTexture.image,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let opaque=0,colored=0;
  for(let i=0;i<d.length;i+=4){if(d[i+3]){opaque++;if(d[i]!==d[i+1]||d[i+1]!==d[i+2])colored++;}}
  p._updateNameplate(new THREE.Vector3(10,20,3));const near=p.nameplate.material.opacity,z=p.nameplate.position.z;
  p._updateNameplate(new THREE.Vector3(10,155,3));const mid=p.nameplate.material.opacity;
  p._updateNameplate(new THREE.Vector3(10,171,3));
  return {colored,opaque,corner:d[3],near,mid,far:p.nameplate.visible,z,scale:p.nameplate.scale.x,expected:c.width*.008,toneMapped:p.nameplate.material.toneMapped};
 });
 assert.equal(nameplate.colored,0);assert.ok(nameplate.opaque>100);assert.equal(nameplate.corner,0);assert.equal(nameplate.near,1);assert.ok(nameplate.mid>0&&nameplate.mid<1);assert.equal(nameplate.far,false);assert.equal(nameplate.z,5.2);assert.equal(nameplate.scale,nameplate.expected);assert.equal(nameplate.toneMapped,false);
 await page.locator('#drive-button').click();await page.waitForFunction(()=>window.__parity.mode==='drive');await page.waitForTimeout(1200);
 assert.equal(await page.locator('#hud-pause').isVisible(),false);
 const hud=await page.locator('.telemetry-panel').evaluate(e=>({background:getComputedStyle(e).backgroundColor,width:e.getBoundingClientRect().width}));assert.equal(hud.background,'rgba(0, 0, 0, 0)');assert.equal(hud.width,264);assert.equal(await page.locator('#rpm').evaluate(e=>getComputedStyle(e).fontSize),'15px');assert.equal(await page.locator('#aid-abs svg').isVisible(),false);assert.equal(await page.locator('#gear').evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
 const mapGeometry=await page.locator('#minimap-button').evaluate(button=>{const canvas=button.querySelector('canvas'),a=button.getBoundingClientRect(),b=canvas.getBoundingClientRect(),s=getComputedStyle(canvas);return {outer:[a.width,a.height],inner:[b.width,b.height],dx:(b.x+b.width/2)-(a.x+a.width/2),dy:(b.y+b.height/2)-(a.y+a.height/2),border:s.borderTopWidth,top:s.marginTop};});assert.deepEqual(mapGeometry.outer,[176,176]);assert.deepEqual(mapGeometry.inner,[168,168]);assert.ok(Math.abs(mapGeometry.dx)<.1&&Math.abs(mapGeometry.dy)<.1);assert.equal(mapGeometry.border,'0px');console.log('Driving HUD and centered minimap verified');await page.screenshot({path:`${out}/driving.png`});await page.locator('#minimap-button').screenshot({path:`${out}/minimap-detail.png`});
 await page.evaluate(()=>window.__parity.openFullMap());await page.locator('#full-map').waitFor({state:'visible'});assert.equal(await page.locator('#hud').isVisible(),false);
 await page.locator('#map-zoom-in').click();assert.ok(await page.evaluate(()=>window.__parity.mapNavigation.zoom>1));await page.locator('#map-locate').click();assert.ok(await page.evaluate(()=>window.__parity.mapNavigation.zoom>=3));
 await page.screenshot({path:`${out}/full-map.png`});await page.locator('#map-fit').click();assert.equal(await page.evaluate(()=>window.__parity.mapNavigation.zoom),1);
 await page.evaluate(()=>{window.__parity.closeFullMap();window.__parity.pause();});
 await page.screenshot({path:`${out}/pause-settings.png`});
 for(const size of [{width:1920,height:1200},{width:2560,height:1080},{width:1280,height:720}]){await page.setViewportSize(size);await page.waitForTimeout(200);const r=await page.locator('#app').boundingBox();assert.equal(r.width,size.width);assert.equal(r.height,size.height);}
 await page.locator('#desktop-aspect').selectOption('4:3');await page.waitForTimeout(200);const r=await page.locator('#app').boundingBox();assert.ok(Math.abs(r.width/r.height-4/3)<.003);await page.locator('#desktop-aspect').selectOption('auto');
 await page.locator('#exit').click();await page.waitForFunction(()=>window.__parity.mode==='menu');assert.equal(await page.locator('#menu [data-download]').isVisible(),true);assert.equal(await page.locator('#drive-button').evaluate(e=>e===document.activeElement),true);assert.deepEqual(errors,[]);writeFileSync(`${out}/report.json`,JSON.stringify({passed:true,nameplate,errors},null,2));console.log('DESKTOP_WEB_PASS: desktop layout, maps, mobile zero-asset gate, neutral transparent nameplates, versions, aspect ratios.');
}finally{clearInterval(heartbeat);await browser.close();}
