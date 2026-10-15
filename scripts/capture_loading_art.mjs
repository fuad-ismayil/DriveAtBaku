// Capture the current game renderer, with no shipped debug hooks or synthetic art.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.env.GAME_URL ?? 'http://127.0.0.1:5188';
const preview = process.argv.includes('--preview');
const output = resolve(preview ? 'artifacts/liquid-glass/scenes' : 'public/assets/loading');
mkdirSync(output, { recursive: true });
const scenes = [
  { name: 'city', point: 0, vehicle: 'ferrari', distance: 9, side: -6, height: 2.5, bias: 3.6 },
  { name: 'night', point: 0, vehicle: 'ferrari', night: true, distance: -8, side: 5, height: 2.2, bias: -3 },
  { name: 'weather', point: 5, vehicle: 'amg', weatherMode: 'wet', distance: 8, side: -5.5, height: 2.2, bias: 3 },
  { name: 'garage', point: 10, vehicle: 'prado', distance: 9, side: -6, height: 2.8, bias: 3.5 },
];
const instrumentation = `
const originalCaptureCamera = updateCamera;
let captureLocked = false;
updateCamera = dt => { if (!captureLocked) originalCaptureCamera(dt); };
window.__artCapture = {
  ready: () => mode !== 'loading' && !loadingScreen.active,
  async prepare({point, vehicle, night=false, weatherMode='sunny', distance, side, height, bias}) {
    await selectVehicle(vehicle);
    if (activeVehicle.id !== vehicle) throw new Error('Capture vehicle unavailable: ' + vehicle);
    const p = route.checkpoints[point], next = route.checkpoints[(point + 1) % route.checkpoints.length];
    const angle = Math.atan2(-(next[0] - p[0]), next[1] - p[1]);
    resetCar(false, false, { position: new THREE.Vector3(...p), heading: angle });
    mode='pause'; captureLocked=true; keys.clear();
    for (const el of document.querySelectorAll('.screen,.modal,#hud,#loading,#toast')) el.classList.add('hidden');
    graphics.setQuality('cinematic'); graphics.setRenderingResolution('native');
    localReflections.setQuality('cinematic'); weather.setQuality('cinematic');
    worldOptimization.setDistances({renderDistance:6000, propsDistance:3000});
    setNightMode(night,false); setWeather(weatherMode,false);
    headlightMode=night?1:0; applyHeadlightMode(car);
    const forward=new THREE.Vector3(-Math.sin(angle),Math.cos(angle),0),right=new THREE.Vector3(forward.y,-forward.x,0);
    camera.position.copy(car.position).addScaledVector(forward,distance).addScaledVector(right,side);camera.position.z+=height;
    cameraLook.copy(car.position).addScaledVector(right,bias);cameraLook.z+=.85;
    camera.lookAt(cameraLook);camera.fov=48;camera.updateProjectionMatrix();
    scene.updateMatrixWorld(true);worldOptimization.update();localReflections.invalidate();
    return {car:car.position.toArray(),camera:camera.position.toArray(),target:cameraLook.toArray(),vehicle:activeVehicle.id};
  },
  size:()=>{const size=new THREE.Vector2();renderer.getDrawingBufferSize(size);return size.toArray();},
};`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const report = { capturedAt: new Date().toISOString(), resolution: preview ? [1920,1080] : [3840,2160], source: 'Current Three.js game renderer, Cinematic preset, native resolution', scenes: [] };
try {
  const page = await browser.newPage({ viewport: { width: report.resolution[0], height: report.resolution[1] }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error(error));
  await page.routeWebSocket('**/*', socket => socket.close());
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.route('**/src/main.js*', async route => { const response=await route.fetch(); await route.fulfill({response,body:await response.text()+'\n'+instrumentation}); });
  await page.goto(origin, {timeout:180000});
  console.log('Game opened; preparing current city assets…');
  await page.waitForFunction(()=>window.__artCapture?.ready(),null,{timeout:240000});
  for (const scene of scenes) {
    const state=await page.evaluate(scene=>window.__artCapture.prepare(scene),scene);
    await page.evaluate(async()=>{for(let i=0;i<45;i++)await new Promise(requestAnimationFrame);});
    const buffer = await page.screenshot({ timeout: 120000 });
    const file=resolve(output,`${scene.name}.${preview?'png':'webp'}`);
    if(preview) writeFileSync(file,buffer);
    else await sharp(buffer).webp({quality:96,effort:6,smartSubsample:true}).toFile(file);
    report.scenes.push({...scene,...state,drawingBuffer:await page.evaluate(()=>window.__artCapture.size()),file:`${scene.name}.${preview?'png':'webp'}`});
    console.log(`Captured ${scene.name} at ${report.resolution.join(' × ')}`);
  }
  writeFileSync(resolve(output,'captures.json'),JSON.stringify(report,null,2)+'\n');
} finally { await browser.close(); }
