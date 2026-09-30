import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { createCarModel, animateCarModel } from './carModel.js';
import { loadElantraModel } from './elantraModel.js';
import { createDynamicsState, stepDynamics, GEAR_LABELS } from './vehicleDynamics.js';
import { VEHICLES } from './vehicleCatalog.js';
import { EngineAudio } from './engineAudio.js';
import { drawMinimap } from './minimap.js';
import { createSky } from './sky.js';
import { accelerationPullback, chaseCameraOffset } from './cameraTuning.js';
import { DriveCameraControls } from './driveCameraControls.js';
import './style.css';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const ui = Object.fromEntries(['loading','menu','garage','controls','pause','hud','progress-bar','loading-copy','drive-button','garage-button','time-toggle','pause-time-toggle','route-time','garage-ferrari','garage-elantra','elantra-availability','garage-status','garage-back','paint-name','custom-paint','pause-garage','pause-controls','engine-volume','controls-button','close-controls','resume','restart','exit','speed','gear','rpm','transmission','headlight-mode','aid-abs','aid-tcs','aid-esc','susp-0','susp-1','susp-2','susp-3','minimap','toast'].map(id => [id, document.getElementById(id)]));
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
renderer.setClearColor(0x9cbfd1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xa8c4cc, 0.00018);
const sky = createSky();
scene.add(sky);
const environment = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = environment.fromScene(room, 0.035).texture;
room.dispose();
environment.dispose();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, 6000);
camera.up.set(0, 0, 1);
const clock = new THREE.Clock();
const draco = new DRACOLoader().setDecoderPath('/draco/');
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(draco);
const keys = new Set();
let route, car, handling, collisionMeshes = [], mode = 'loading', cameraMode = 0, lastSafe;
let packedAssets = {};
let physicsAccumulator = 0, safeTimer = 0;
let physicsPosition, previousBodyPosition, previousBodyQuaternion;
const interpolatedBody = new THREE.Vector3(), interpolatedQuaternion = new THREE.Quaternion();
let pendingShiftUp = false, pendingShiftDown = false;
let padShiftUpHeld = false, padShiftDownHeld = false;
let padCameraHeld = false, padTransmissionHeld = false;
let activeVehicle = VEHICLES.ferrari;
const engineAudio = new EngineAudio();
let garageOrigin = 'menu';
let controlsOrigin = 'menu';
const availableVehicles = new Set(['ferrari']);
const carCache = new Map();
const shadowCandidates = [];
const nightMaterials = [];
let selectingVehicle = false;
const cameraLook = new THREE.Vector3();
const followCameraPosition = new THREE.Vector3(), followCameraLook = new THREE.Vector3();
const cameraPositionVelocity = new THREE.Vector3(), cameraLookVelocity = new THREE.Vector3();
const cameraTrackedCarPosition = new THREE.Vector3();
let cameraAcceleration = 0, cameraPullback = 0;
let cameraReady = false, garageOrbit = 0, cameraTransition = null, pointerSeen = false, pointerLockLostAt = -Infinity;
let pointerEdgeX = 0, pointerEdgeY = 0;
const driveCamera = new DriveCameraControls();
let audioMuted = false, headlightMode = 0;
let nightMode = false, shadowUpdateTimer = 0;
const DEFAULT_PAINT = { ferrari: '#a80719', elantra: '#b9c3ca' };
const paintSelections = { ...DEFAULT_PAINT };
for (const vehicleId of Object.keys(DEFAULT_PAINT)) {
  try {
    const saved = localStorage.getItem(`baku-paint-${vehicleId}`);
    if (/^#[0-9a-f]{6}$/i.test(saved ?? '')) paintSelections[vehicleId] = saved.toLowerCase();
  } catch { /* storage is optional */ }
}
const FIXED_STEP = 1 / 120;

const hemisphere = new THREE.HemisphereLight(0xcbe9ff, 0x6d6657, 0.88);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffefcf, 3.35);
sun.position.set(-800, -400, 1100); sun.castShadow = true;
sun.shadow.mapSize.set(3072, 3072); sun.shadow.camera.near = 10; sun.shadow.camera.far = 2500;
sun.shadow.camera.left = -80; sun.shadow.camera.right = 80; sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.008;
sun.shadow.radius = 1.5;
scene.add(sun, sun.target);
const shadowAnchor = new THREE.Vector3();
const shadowOffset = new THREE.Vector3(450, 165, 145);

function addHeadlights(vehicle) {
  if (vehicle.userData.headlights) return;
  const lights = [];
  const nose = activeVehicle.dims.length * 0.43;
  for (const x of [-0.55, 0.55]) {
    const lamp = new THREE.SpotLight(0xe8f2ff, 0, 28, 0.42, 0.75, 1.35);
    lamp.position.set(x, nose, activeVehicle.id === 'elantra' ? 0.77 : 0.6);
    lamp.castShadow = false;
    const target = new THREE.Object3D();
    target.position.set(x * 0.4, 22, 0.04);
    vehicle.add(lamp, target);
    lamp.target = target;
    lights.push(lamp);
  }
  vehicle.userData.headlights = lights;
  const key = new THREE.PointLight(0xd8e9ff, 100, 13, 2);
  key.position.set(-3, 2, 4.5);
  const rim = new THREE.PointLight(0xffdbbd, 75, 12, 2);
  rim.position.set(3, -2, 3.5);
  key.visible = rim.visible = false;
  vehicle.add(key, rim);
  vehicle.userData.garageLights = [key, rim];
  applyHeadlightMode(vehicle);
}

function applyHeadlightMode(vehicle) {
  for (const lamp of vehicle.userData.headlights ?? []) {
    lamp.intensity = headlightMode === 0 ? 0 : headlightMode === 1 ? 320 : 780;
    lamp.distance = headlightMode === 2 ? 72 : 22;
    lamp.angle = headlightMode === 2 ? 0.22 : 0.48;
    lamp.decay = headlightMode === 2 ? 1.05 : 1.5;
    lamp.target.position.y = headlightMode === 2 ? 60 : 18;
    lamp.target.position.z = headlightMode === 2 ? -0.8 : -1.5;
  }
  for (const material of vehicle.userData.headlightMaterials ?? []) {
    material.emissiveIntensity = (headlightMode === 0 ? 0 : headlightMode === 1 ? 3.2 : 5.2)
      * (material.userData.headlightScale ?? 1);
  }
}

function cycleHeadlights() {
  headlightMode = (headlightMode + 1) % 3;
  for (const vehicle of carCache.values()) applyHeadlightMode(vehicle);
  ui['headlight-mode'].textContent = ['LIGHTS OFF', 'LOW BEAM', 'HIGH BEAM'][headlightMode];
  toast(['HEADLIGHTS OFF', 'LOW BEAM', 'HIGH BEAM'][headlightMode]);
}

function updatePaintUI() {
  const color = paintSelections[activeVehicle.id];
  let name = 'CUSTOM COLOR';
  for (const button of document.querySelectorAll('.paint-swatch')) {
    const selected = button.dataset.paint === color;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    if (selected) name = button.dataset.name;
  }
  ui['paint-name'].textContent = name;
  ui['custom-paint'].value = color;
}

function applyPaint(vehicle, vehicleId) {
  for (const material of vehicle.userData.paintMaterials ?? []) material.color.set(paintSelections[vehicleId]);
}

function choosePaint(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  paintSelections[activeVehicle.id] = color.toLowerCase();
  applyPaint(car, activeVehicle.id);
  updatePaintUI();
  try { localStorage.setItem(`baku-paint-${activeVehicle.id}`, color.toLowerCase()); } catch { /* storage is optional */ }
}

function setNightMode(enabled, save = true) {
  nightMode = Boolean(enabled);
  sky.material.uniforms.night.value = nightMode ? 1 : 0;
  scene.fog.color.set(nightMode ? 0x19263d : 0x9bc8df);
  scene.fog.density = nightMode ? 0.0003 : 0.00018;
  hemisphere.color.set(nightMode ? 0x8aa8d2 : 0xcbe9ff);
  hemisphere.groundColor.set(nightMode ? 0x293448 : 0x6d6657);
  hemisphere.intensity = nightMode ? 0.35 : 0.88;
  sun.color.set(nightMode ? 0x9dbbff : 0xffefcf);
  sun.intensity = nightMode ? 0.32 : 3.35;
  shadowOffset.set(nightMode ? 270 : 450, nightMode ? 190 : 165, nightMode ? 590 : 145);
  sky.material.uniforms.sunDirection.value.copy(shadowOffset).normalize();
  scene.environmentIntensity = nightMode ? 0.22 : 1;
  renderer.toneMappingExposure = nightMode ? 0.78 : 0.84;
  for (const toggle of [ui['time-toggle'], ui['pause-time-toggle']]) {
    toggle.textContent = nightMode ? '☾ NIGHT MODE' : '☀ DAY MODE';
    toggle.setAttribute('aria-pressed', String(nightMode));
  }
  ui['route-time'].textContent = `6.003 KM · ${nightMode ? 'NIGHT' : 'DAY'}`;
  for (const material of nightMaterials) material.emissiveIntensity = nightMode ? 0.13 : 0;
  if (save) try { localStorage.setItem('baku-night-mode', String(nightMode)); } catch { /* storage is optional */ }
}

function progress(value, copy) { ui['progress-bar'].style.width = `${value}%`; ui['loading-copy'].textContent = copy; }
async function loadGLB(url, onProgress) {
  const name = url.match(/\/generated\/(baku|buildings)\.glb$/)?.[1];
  const packed = name && packedAssets[name];
  if (!packed) return new Promise((resolve, reject) => loader.load(url, resolve, onProgress, reject));
  let loaded = 0;
  const chunks = await Promise.all(packed.parts.map(async filename => {
    const response = await fetch(`/generated/${filename}`);
    if (!response.ok) throw new Error(`Map asset ${filename} could not be loaded (${response.status}).`);
    const chunk = await response.arrayBuffer();
    loaded += chunk.byteLength;
    onProgress?.({ loaded, total: packed.compressedBytes });
    return chunk;
  }));
  const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  if (buffer.byteLength !== packed.originalBytes) throw new Error(`Map asset ${name} was incomplete.`);
  return new Promise((resolve, reject) => loader.parse(buffer, '/generated/', resolve, reject));
}

function tuneMap(root) {
  scene.add(root);
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    o.castShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.envMapIntensity = 0.22;
      if (m.alphaTest > 0) m.alphaTest = /tree|hedge|grass_bridge/i.test(m.name) ? 0.38 : 10 / 255;
      if (/water/i.test(m.name)) { m.roughness = 0.16; m.metalness = 0.18; m.envMapIntensity = 0.55; }
      if (/road|track|asphalt/i.test(m.name) && !/line|decal|board/i.test(m.name)) { m.roughness = 0.88; m.metalness = 0; }
      if (/window|glass/i.test(m.name)) { m.roughness = 0.22; m.metalness = 0.24; m.envMapIntensity = 0.62; }
      if (/window|building.*lights/i.test(m.name) && m.emissive && !m.transparent) {
        m.emissive.set(0xffd7a3);
        m.emissiveIntensity = nightMode ? 0.13 : 0;
        nightMaterials.push(m);
      }
      for (const tex of [m.map, m.normalMap, m.roughnessMap]) if (tex) tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    }
    if (mats.some(m => /tree|hedge|building|wall|fence/i.test(m.name)) && !mats.some(m => m.transparent && m.alphaTest === 0)) {
      o.geometry.computeBoundingSphere();
      const sphere = o.geometry.boundingSphere;
      const scale = o.getWorldScale(new THREE.Vector3());
      const radius = sphere.radius * Math.max(scale.x, scale.y, scale.z);
      if (radius < 85) shadowCandidates.push({ mesh: o, center: sphere.center.clone().applyMatrix4(o.matrixWorld), radius });
    }
  });
}

async function boot() {
  try {
    try { setNightMode(localStorage.getItem('baku-night-mode') === 'true', false); } catch { setNightMode(false, false); }
    const packedResponse = await fetch('/generated/asset-manifest.json');
    if (packedResponse.ok) packedAssets = (await packedResponse.json()).assets ?? {};
    progress(8, 'Reading the circuit route…'); route = await fetch('/generated/route.json').then(r => { if(!r.ok) throw new Error('Converted route not found'); return r.json(); });
    progress(16, 'Loading Baku streets…'); const map = await loadGLB('/generated/baku.glb', e => e.total && progress(16 + (e.loaded/e.total)*38, 'Loading Baku streets…')); tuneMap(map.scene);
    progress(58, 'Loading the city skyline…'); const buildings = await loadGLB('/generated/buildings.glb', e => e.total && progress(58 + (e.loaded/e.total)*25, 'Loading the city skyline…')); tuneMap(buildings.scene);
    progress(85, 'Preparing road contact…'); const collision = await loadGLB('/generated/collision.glb'); collision.scene.traverse(o=>{if(o.isMesh){o.visible=false;o.geometry.computeBoundsTree({targetLeafSize:20});collisionMeshes.push(o);}}); scene.add(collision.scene);
    progress(93, 'Preparing your car…');
    const carAsset = await loadGLB('/assets/vehicles/ferrari-458.glb');
    car = createCarModel(carAsset); carCache.set('ferrari', car); scene.add(car); addHeadlights(car); applyPaint(car, 'ferrari'); updatePaintUI(); scene.updateMatrixWorld(true); resetCar(false, false);
    const elantraResponse = await fetch(VEHICLES.elantra.asset, { method: 'HEAD' });
    if (elantraResponse.ok) {
      availableVehicles.add('elantra');
      ui['garage-elantra'].disabled = false;
      ui['elantra-availability'].textContent = 'Front-wheel drive · four-cylinder';
    }
    let savedVehicle;
    try { savedVehicle = localStorage.getItem('baku-selected-car'); } catch { /* storage is optional */ }
    if (savedVehicle && availableVehicles.has(savedVehicle)) {
      progress(96, 'Loading your garage car…');
      await selectVehicle(savedVehicle);
    }
    progress(100, 'Welcome to Baku'); await new Promise(r=>setTimeout(r,450)); ui.loading.classList.add('hidden'); ui.menu.classList.remove('hidden'); mode='menu';
  } catch(err) { progress(100, 'Map conversion required — run npm run convert-map'); console.error(err); }
}

const groundRay = new THREE.Raycaster();
groundRay.firstHitOnly = true;
function sampleGround(origin, direction, maxDistance) {
  groundRay.set(origin, direction);
  groundRay.near = 0;
  groundRay.far = maxDistance;
  let best = null;
  for (const mesh of collisionMeshes) {
    const hit = groundRay.intersectObject(mesh, false)[0];
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  if (!best) return null;
  const normal = best.face?.normal?.clone().transformDirection(best.object.matrixWorld) ?? new THREE.Vector3(0, 0, 1);
  if (normal.z < 0) normal.negate();
  const material = Array.isArray(best.object.material) ? best.object.material[0] : best.object.material;
  const name = `${best.object.name} ${material?.name ?? ''}`;
  const mu = /grass|dirt|sand/i.test(name) ? 0.65 : /gravel/i.test(name) ? 0.75 : 1;
  return { distance: best.distance, point: best.point, normal, mu, rr: mu < 1 ? 0.045 : 0.013 };
}
function groundHeight(x, y, from = 8) {
  return sampleGround(new THREE.Vector3(x, y, from), new THREE.Vector3(0, 0, -1), 16)?.point.z;
}
function resetCar(notify = true, useLastSafe = true, override = null) {
  const marker = override ?? (useLastSafe && lastSafe ? lastSafe : { position: new THREE.Vector3(...route.spawn), heading: route.heading });
  const previous = handling;
  physicsPosition = marker.position.clone();
  const road = groundHeight(physicsPosition.x, physicsPosition.y, physicsPosition.z + 6);
  if (road !== undefined) physicsPosition.z = road;
  car.position.copy(physicsPosition);
  handling = createDynamicsState(marker.heading, activeVehicle, physicsPosition);
  if (previous) {
    handling.autoTransmission = previous.autoTransmission;
    handling.aids = { ...previous.aids };
  }
  previousBodyPosition = handling.position.clone();
  previousBodyQuaternion = handling.quaternion.clone();
  car.quaternion.copy(handling.quaternion);
  physicsAccumulator = 0;
  lastSafe = { position: physicsPosition.clone(), heading: handling.heading };
  safeTimer = 0;
  if (notify) toast('VEHICLE RESET TO ROAD');
}
function recoverInPlace() {
  if (!car || !handling) return;
  resetCar(false, false, { position: car.position.clone(), heading: handling.heading });
  cameraAcceleration = 0;
  cameraPullback = 0;
  toast('CAR UPRIGHT · SAME LOCATION');
}
function restartAtSpawn() {
  if (!car || !route) return;
  resetCar(false, false, { position: new THREE.Vector3(...route.spawn), heading: route.heading });
  cameraReady = false;
  cameraTransition = null;
  driveCamera.reset();
  cameraAcceleration = 0;
  cameraPullback = 0;
  toast('RETURNED TO START');
}
function toast(text){ui.toast.textContent=text;ui.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>ui.toast.classList.remove('show'),1700);}
function captureDrivePointer() {
  document.body.classList.add('is-driving');
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.().catch(() => {});
}
function releaseDrivePointer() {
  document.body.classList.remove('is-driving');
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
}
function startDrive(){mode='drive';driveCamera.reset();cameraReady=false;cameraTransition=null;pointerSeen=false;pointerEdgeX=pointerEdgeY=0;ui.menu.classList.add('hidden');ui.hud.classList.remove('hidden');captureDrivePointer();engineAudio.activate().catch(console.warn);clock.getDelta();}
function pause(){if(mode!=='drive')return;mode='pause';keys.clear();driveCamera.setRearHeld(false);pointerSeen=false;pointerEdgeX=pointerEdgeY=0;ui.pause.classList.remove('hidden');releaseDrivePointer();}
function resume(){if(mode!=='pause')return;mode='drive';ui.pause.classList.add('hidden');captureDrivePointer();engineAudio.activate().catch(console.warn);clock.getDelta();}
function exitToMenu(){mode='menu';keys.clear();driveCamera.setRearHeld(false);ui.pause.classList.add('hidden');ui.hud.classList.add('hidden');ui.menu.classList.remove('hidden');releaseDrivePointer();}
function openControls() {
  controlsOrigin = mode;
  if (controlsOrigin === 'pause') ui.pause.classList.add('hidden');
  ui.controls.classList.remove('hidden');
}
function closeControls() {
  ui.controls.classList.add('hidden');
  if (controlsOrigin === 'pause') ui.pause.classList.remove('hidden');
}
function openGarage(){
  garageOrigin = mode;
  mode = 'garage';
  releaseDrivePointer();
  keys.clear();
  ui.menu.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.hud.classList.add('hidden');
  ui.garage.classList.remove('hidden');
  ui['garage-status'].textContent = activeVehicle.description;
}
function closeGarage(){
  ui.garage.classList.add('hidden');
  mode = garageOrigin;
  cameraReady = false;
  cameraTransition = null;
  if (garageOrigin === 'menu') ui.menu.classList.remove('hidden');
  if (garageOrigin === 'pause') { ui.pause.classList.remove('hidden'); ui.hud.classList.remove('hidden'); }
  clock.getDelta();
}
async function selectVehicle(id){
  if (!availableVehicles.has(id) || selectingVehicle) return;
  if (activeVehicle.id !== id) {
    selectingVehicle = true;
    ui['garage-status'].textContent = 'Preparing your car…';
    try {
      const marker = { position: physicsPosition.clone(), heading: handling.heading };
      const newCar = carCache.get(id) ?? (id === 'elantra' ? await loadElantraModel() : createCarModel(await loadGLB(VEHICLES[id].asset)));
      carCache.set(id, newCar);
      scene.remove(car);
      car = newCar;
      scene.add(car);
      activeVehicle = VEHICLES[id];
      addHeadlights(car);
      applyPaint(car, id);
      resetCar(false, false, marker);
      cameraReady = false;
      try { localStorage.setItem('baku-selected-car', id); } catch { /* storage is optional */ }
    } catch (error) {
      ui['garage-status'].textContent = 'This car could not be loaded.';
      console.error(error);
      return;
    } finally {
      selectingVehicle = false;
    }
  }
  for (const vehicleId of ['ferrari', 'elantra']) ui[`garage-${vehicleId}`].classList.toggle('selected', vehicleId === id);
  updatePaintUI();
  ui['garage-status'].textContent = activeVehicle.description;
}

function drivingInput() {
  const pad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
  const axis = Math.abs(pad?.axes?.[0] ?? 0) > 0.12 ? -pad.axes[0] : 0;
  const shiftUpPressed = Boolean(pad?.buttons?.[0]?.pressed);
  const shiftDownPressed = Boolean(pad?.buttons?.[2]?.pressed);
  const cameraPressed = Boolean(pad?.buttons?.[3]?.pressed);
  const transmissionPressed = Boolean(pad?.buttons?.[11]?.pressed);
  if (cameraPressed && !padCameraHeld) cycleCamera();
  if (transmissionPressed && !padTransmissionHeld) toggleTransmission();
  const input = {
    throttle: Math.max(keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0, pad?.buttons?.[7]?.value ?? 0),
    brake: Math.max(keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0, pad?.buttons?.[6]?.value ?? 0),
    steer: THREE.MathUtils.clamp((keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) + axis, -1, 1),
    handbrake: keys.has('Space') || Boolean(pad?.buttons?.[1]?.pressed),
    clutch: keys.has('KeyX') || Boolean(pad?.buttons?.[4]?.pressed),
    horn: keys.has('KeyH') || Boolean(pad?.buttons?.[10]?.pressed),
    shiftUp: pendingShiftUp || shiftUpPressed && !padShiftUpHeld,
    shiftDown: pendingShiftDown || shiftDownPressed && !padShiftDownHeld,
  };
  pendingShiftUp = pendingShiftDown = false;
  padShiftUpHeld = shiftUpPressed;
  padShiftDownHeld = shiftDownPressed;
  padCameraHeld = cameraPressed;
  padTransmissionHeld = transmissionPressed;
  return input;
}

function barrierAhead(travel) {
  const distance = Math.hypot(travel.x, travel.y);
  if (distance < 0.001) return false;
  const direction = new THREE.Vector3(travel.x / distance, travel.y / distance, 0);
  const ray = new THREE.Raycaster(handling.position.clone(), direction, 0, distance + 2.2);
  ray.firstHitOnly = true;
  for (const mesh of collisionMeshes) {
    const hit = ray.intersectObject(mesh, false)[0];
    if (hit && Math.abs(hit.face?.normal?.z ?? 1) < 0.65) return true;
  }
  return false;
}

function updateCar(dt) {
  if (mode !== 'drive') return;
  physicsAccumulator = Math.min(physicsAccumulator + dt, FIXED_STEP * 8);
  while (physicsAccumulator >= FIXED_STEP) {
    previousBodyPosition.copy(handling.position);
    previousBodyQuaternion.copy(handling.quaternion);
    stepDynamics(handling, drivingInput(), FIXED_STEP, activeVehicle, sampleGround);
    const travel = handling.position.clone().sub(previousBodyPosition);
    if (barrierAhead(travel)) {
      handling.position.x = previousBodyPosition.x;
      handling.position.y = previousBodyPosition.y;
      handling.velocity.x *= -0.12;
      handling.velocity.y *= -0.12;
      handling.angularVelocity.z *= 0.3;
    }
    physicsPosition.copy(handling.position).add(new THREE.Vector3(0, 0, -handling.comHeight).applyQuaternion(handling.quaternion));
    if (!handling.groundedWheels && handling.position.z < -4) { resetCar(); return; }
    if (handling.groundedWheels >= 3 && handling.velocity.length() < 34) {
      safeTimer += FIXED_STEP;
      if (safeTimer > 1.5) {
        lastSafe = { position: physicsPosition.clone(), heading: handling.heading };
        safeTimer = 0;
      }
    }
    physicsAccumulator -= FIXED_STEP;
  }
  const alpha = THREE.MathUtils.clamp(physicsAccumulator / FIXED_STEP, 0, 1);
  interpolatedBody.copy(previousBodyPosition).lerp(handling.position, alpha);
  interpolatedQuaternion.copy(previousBodyQuaternion).slerp(handling.quaternion, alpha);
  car.position.copy(interpolatedBody).add(new THREE.Vector3(0, 0, -handling.comHeight).applyQuaternion(interpolatedQuaternion));
  car.quaternion.copy(interpolatedQuaternion);
  animateCarModel(car, handling, dt);
  ui.speed.textContent = Math.round(Math.hypot(handling.velocity.x, handling.velocity.y) * 3.6);
  ui.gear.textContent = GEAR_LABELS[handling.gear] ?? '?';
  ui.rpm.textContent = Math.round(handling.rpm);
  ui.transmission.textContent = handling.autoTransmission ? 'AUTO' : 'MANUAL';
  for (const aid of ['abs', 'tcs', 'esc']) {
    ui[`aid-${aid}`].classList.toggle('active', handling.aids[aid]);
    ui[`aid-${aid}`].classList.toggle('working', handling[`${aid}Active`]);
  }
  for (let i = 0; i < 4; i++) ui[`susp-${i}`].style.height = `${Math.round(100 * THREE.MathUtils.clamp(handling.wheels[i].compression / activeVehicle.suspTravel, 0, 1))}%`;
  drawMinimap(ui.minimap, route, car.position, handling.heading, handling.velocity.length());
}

function updateSceneLighting(dt) {
  if (!car) return;
  for (const lamp of car.userData.garageLights ?? []) lamp.visible = nightMode && mode === 'garage';
  const texelSize = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  shadowAnchor.set(
    Math.round(car.position.x / texelSize) * texelSize,
    Math.round(car.position.y / texelSize) * texelSize,
    Math.round(car.position.z / texelSize) * texelSize,
  );
  sun.target.position.copy(shadowAnchor);
  sun.position.copy(shadowAnchor).add(shadowOffset);
  shadowUpdateTimer -= dt;
  if (shadowUpdateTimer <= 0) {
    shadowUpdateTimer = 0.2;
    for (const candidate of shadowCandidates) {
      const dx = candidate.center.x - car.position.x;
      const dy = candidate.center.y - car.position.y;
      candidate.mesh.castShadow = dx * dx + dy * dy < (115 + candidate.radius) ** 2;
    }
  }
}

function springCameraVector(current, velocity, target, frequency, dt) {
  const difference = current.clone().sub(target);
  const decay = Math.exp(-frequency * dt);
  current.copy(target)
    .addScaledVector(difference, (1 + frequency * dt) * decay)
    .addScaledVector(velocity, dt * decay);
  velocity.multiplyScalar(1 - frequency * dt)
    .addScaledVector(difference, -frequency * frequency * dt)
    .multiplyScalar(decay);
}

function beginCameraTransition() {
  if (!car) return;
  const inverse = car.quaternion.clone().invert();
  cameraTransition = {
    position: camera.position.clone().sub(car.position).applyQuaternion(inverse),
    look: cameraLook.clone().sub(car.position).applyQuaternion(inverse),
    elapsed: 0,
  };
}

function updateCamera(dt) {
  if (!car) return;
  if (mode === 'garage') {
    cameraReady = false;
    cameraTrackedCarPosition.copy(car.position);
    cameraPositionVelocity.set(0, 0, 0);
    cameraLookVelocity.set(0, 0, 0);
    garageOrbit += dt * 0.3;
    const heading = handling.heading;
    const forward = new THREE.Vector3(-Math.sin(heading), Math.cos(heading), 0);
    const right = new THREE.Vector3(forward.y, -forward.x, 0);
    const desired = car.position.clone().addScaledVector(forward, 6.1)
      .addScaledVector(right, -2.4 + Math.sin(garageOrbit) * 0.45);
    desired.z += 2.05;
    camera.position.lerp(desired, 1 - Math.exp(-dt * 3.7));
    cameraLook.copy(car.position).addScaledVector(right, 2.3);
    cameraLook.z += 0.8;
    camera.lookAt(cameraLook);
    camera.fov = THREE.MathUtils.damp(camera.fov, 58, 3, dt);
    camera.updateProjectionMatrix();
    return;
  }
  const pad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
  const camX = Math.abs(pad?.axes?.[2] ?? 0) > 0.12 ? pad.axes[2] : 0;
  const camY = Math.abs(pad?.axes?.[3] ?? 0) > 0.12 ? pad.axes[3] : 0;
  const speedKmh = Math.hypot(handling.velocity.x, handling.velocity.y) * 3.6;
  const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(car.quaternion);
  forward.z = 0;
  forward.normalize();
  // Reverse keeps the chassis-relative chase rig; it never whips 180 degrees
  // just because the car changes direction. Manual orbit/look-back still works.
  const forwardSpeedKmh = Math.max(0, handling.longitudinalSpeed * 3.6);
  if (mode === 'drive' && document.pointerLockElement !== canvas && cameraMode === 0) {
    driveCamera.edgeMove(pointerEdgeX, pointerEdgeY, dt, forwardSpeedKmh);
  }
  const controls = driveCamera.update(dt, forwardSpeedKmh, camX, camY);
  const viewForward = forward.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), controls.yaw);
  cameraAcceleration = THREE.MathUtils.damp(cameraAcceleration, THREE.MathUtils.clamp(handling.acceleration, -10, 12), 4, dt);
  const kick = accelerationPullback(cameraAcceleration, speedKmh);
  cameraPullback = THREE.MathUtils.damp(cameraPullback, kick, kick > cameraPullback ? 5 : 1.6, dt);
  const offset = chaseCameraOffset(driveCamera.rearHeld ? 0 : cameraPullback, activeVehicle.id, speedKmh, handling.yawRate);
  const desiredFollow = car.position.clone().addScaledVector(viewForward, -offset.distance);
  desiredFollow.z = car.position.z + offset.height + Math.sin(controls.pitch) * offset.distance;
  const road = groundHeight(desiredFollow.x, desiredFollow.y, desiredFollow.z + 6);
  if (road !== undefined) desiredFollow.z = Math.max(desiredFollow.z, road + 1.2);
  const viewAngle = Math.abs(Math.atan2(Math.sin(controls.yaw), Math.cos(controls.yaw)));
  const travelLook = handling.longitudinalSpeed < -1.3 ? -0.45 : 1.45;
  const lookAhead = THREE.MathUtils.lerp(travelLook, -0.25, THREE.MathUtils.smoothstep(viewAngle, 0.35, 2.6));
  const desiredLook = car.position.clone().addScaledVector(forward, lookAhead);
  desiredLook.z += 1.08 + 0.25 * controls.pitch;

  if (cameraReady) {
    const movement = car.position.clone().sub(cameraTrackedCarPosition);
    if (movement.length() < 25) {
      followCameraPosition.x += movement.x;
      followCameraPosition.y += movement.y;
      followCameraPosition.z += movement.z * 0.68;
      followCameraLook.x += movement.x;
      followCameraLook.y += movement.y;
      followCameraLook.z += movement.z * 0.82;
    } else cameraReady = false;
  }
  cameraTrackedCarPosition.copy(car.position);
  if (!cameraReady || followCameraPosition.distanceTo(desiredFollow) > 45) {
    followCameraPosition.copy(desiredFollow);
    followCameraLook.copy(desiredLook);
    cameraPositionVelocity.set(0, 0, 0);
    cameraLookVelocity.set(0, 0, 0);
    cameraReady = true;
  } else {
    springCameraVector(followCameraPosition, cameraPositionVelocity, desiredFollow, 12, dt);
    springCameraVector(followCameraLook, cameraLookVelocity, desiredLook, 16, dt);
  }

  // The hood rig is fixed to the body. It never uses speed or acceleration pullback.
  const hood = activeVehicle.id === 'elantra' ? { height: 1.15, forward: 1.3 } : { height: 0.88, forward: 1.22 };
  const bodyForward = new THREE.Vector3(0, 1, 0).applyQuaternion(car.quaternion);
  const bodyUp = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
  const hoodPosition = car.position.clone().addScaledVector(bodyForward, hood.forward).addScaledVector(bodyUp, hood.height);
  const hoodLook = hoodPosition.clone().addScaledVector(bodyForward, 12).addScaledVector(bodyUp, 0.4);
  const showHood = cameraMode === 1 && !driveCamera.rearHeld;
  const targetPosition = showHood ? hoodPosition : followCameraPosition;
  const targetLook = showHood ? hoodLook : followCameraLook;
  if (cameraTransition) {
    cameraTransition.elapsed += dt;
    const t = THREE.MathUtils.clamp(cameraTransition.elapsed / 0.42, 0, 1);
    const blend = t * t * (3 - 2 * t);
    const fromPosition = cameraTransition.position.clone().applyQuaternion(car.quaternion).add(car.position);
    const fromLook = cameraTransition.look.clone().applyQuaternion(car.quaternion).add(car.position);
    camera.position.lerpVectors(fromPosition, targetPosition, blend);
    cameraLook.lerpVectors(fromLook, targetLook, blend);
    if (t >= 1) cameraTransition = null;
  } else {
    camera.position.copy(targetPosition);
    cameraLook.copy(targetLook);
  }
  camera.lookAt(cameraLook);
  camera.fov = THREE.MathUtils.damp(camera.fov, showHood ? 62 : offset.fov, 5, dt);
  camera.updateProjectionMatrix();
}
function toggleAid(aid) {
  if (!handling) return;
  handling.aids[aid] = !handling.aids[aid];
  ui[`aid-${aid}`].classList.toggle('active', handling.aids[aid]);
  toast(`${aid.toUpperCase()} ${handling.aids[aid] ? 'ON' : 'OFF'}`);
}
function cycleCamera() {
  beginCameraTransition();
  cameraMode = (cameraMode + 1) % 2;
  if (cameraMode === 0) driveCamera.reset();
  toast(cameraMode === 0 ? 'FOLLOW CAMERA' : 'HOOD CAMERA');
}
function toggleTransmission() {
  handling.autoTransmission = !handling.autoTransmission;
  toast(handling.autoTransmission ? 'AUTOMATIC GEARBOX' : 'MANUAL GEARBOX');
}
addEventListener('keydown',e=>{
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Escape' && !ui.controls.classList.contains('hidden')) { closeControls(); return; }
  if (e.code === 'Escape') { if (mode === 'drive') pause(); else if (mode === 'pause' && performance.now() - pointerLockLostAt > 500) resume(); else if (mode === 'garage') closeGarage(); }
  if (mode !== 'drive') return;
  if (e.code === 'KeyR') { if (e.shiftKey) restartAtSpawn(); else recoverInPlace(); }
  if (e.code === 'KeyL') cycleHeadlights();
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyT') toggleTransmission();
  if (e.code === 'KeyE') pendingShiftUp = true;
  if (e.code === 'KeyQ') pendingShiftDown = true;
  if (['Digit1','Digit2','Digit3'].includes(e.code)) toggleAid({ Digit1: 'abs', Digit2: 'tcs', Digit3: 'esc' }[e.code]);
  if (e.code === 'KeyM') { audioMuted = !audioMuted; engineAudio.setEnabled(!audioMuted && !document.hidden); toast(audioMuted ? 'SOUND MUTED' : 'SOUND ON'); }
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{keys.clear();pointerSeen=false;driveCamera.setRearHeld(false);});
document.addEventListener('pointerlockchange', () => {
  pointerSeen = false;
  if (mode === 'drive' && document.pointerLockElement !== canvas) {
    pointerLockLostAt = performance.now();
    pause();
  }
});
canvas.addEventListener('click', () => { if (mode === 'drive') captureDrivePointer(); });
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();pointerSeen=false;driveCamera.setRearHeld(false);}engineAudio.setEnabled(!document.hidden && !audioMuted);});
document.addEventListener('pointermove', e => {
  if (mode !== 'drive') { pointerSeen = false; return; }
  if (document.pointerLockElement !== canvas) {
    const margin = 48;
    pointerEdgeX = THREE.MathUtils.clamp((e.clientX - (innerWidth - margin)) / margin, 0, 1)
      - THREE.MathUtils.clamp((margin - e.clientX) / margin, 0, 1);
    pointerEdgeY = THREE.MathUtils.clamp((e.clientY - (innerHeight - margin)) / margin, 0, 1)
      - THREE.MathUtils.clamp((margin - e.clientY) / margin, 0, 1);
  } else pointerEdgeX = pointerEdgeY = 0;
  if (!pointerSeen) { pointerSeen = true; return; }
  if (cameraMode === 0 && !driveCamera.rearHeld) {
    const speedKmh = Math.hypot(handling.velocity.x, handling.velocity.y) * 3.6;
    driveCamera.move(e.movementX, e.movementY, Math.max(0, handling.longitudinalSpeed * 3.6));
  }
});
document.addEventListener('mousedown', e => {
  if (mode !== 'drive' || e.button !== 1) return;
  e.preventDefault();
  if (cameraMode === 1) beginCameraTransition();
  driveCamera.setRearHeld(true);
}, { capture: true });
document.addEventListener('mouseup', e => {
  if (e.button !== 1 || !driveCamera.rearHeld) return;
  e.preventDefault();
  if (cameraMode === 1) beginCameraTransition();
  driveCamera.setRearHeld(false);
}, { capture: true });
document.addEventListener('auxclick', e => { if (mode === 'drive' && e.button === 1) e.preventDefault(); });
ui['drive-button'].onclick=startDrive;ui['garage-button'].onclick=openGarage;ui['time-toggle'].onclick=()=>setNightMode(!nightMode);ui['pause-time-toggle'].onclick=()=>setNightMode(!nightMode);ui['pause-garage'].onclick=openGarage;ui['garage-back'].onclick=closeGarage;ui['garage-ferrari'].onclick=()=>selectVehicle('ferrari');ui['garage-elantra'].onclick=()=>selectVehicle('elantra');ui['controls-button'].onclick=openControls;ui['pause-controls'].onclick=openControls;ui['close-controls'].onclick=closeControls;ui.resume.onclick=resume;ui.restart.onclick=()=>{recoverInPlace();resume()};ui.exit.onclick=exitToMenu;ui['engine-volume'].oninput=e=>engineAudio.setVolume(e.target.value);
for (const swatch of document.querySelectorAll('.paint-swatch')) swatch.onclick=()=>choosePaint(swatch.dataset.paint);
ui['custom-paint'].oninput=e=>choosePaint(e.target.value);
for (const aid of ['abs','tcs','esc']) ui[`aid-${aid}`].onclick=()=>toggleAid(aid);

function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),0.1);updateCar(dt);updateCamera(dt);updateSceneLighting(dt);sky.position.copy(camera.position);sky.material.uniforms.time.value+=dt;engineAudio.update(handling,activeVehicle,mode==='drive',dt);renderer.render(scene,camera);} boot();frame();
