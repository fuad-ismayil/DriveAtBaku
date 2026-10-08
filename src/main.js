import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { createCarModel, animateCarModel, setHeadlightBulbs } from './carModel.js';
import { loadElantraModel } from './elantraModel.js';
import { loadImportedVehicle } from './importedVehicleModel.js';
import { createDynamicsState, stepDynamics, GEAR_LABELS } from './vehicleDynamics.js';
import { VEHICLES } from './vehicleCatalog.js';
import { updateLicensePlates } from './licensePlates.js';
import { PLATE_FORMATS, readPlateSettings, savePlateSettings } from './licensePlateSettings.js';
import { createLicensePlateControls } from './licensePlateControls.js';
import { EngineAudio } from './engineAudio.js';
import { createMinimap, drawMinimap } from './minimap.js';
import { createSky } from './sky.js';
import { createGraphics, createSkyEnvironments } from './graphics.js';
import { accelerationPullback, chaseCameraOffset } from './cameraTuning.js';
import { DriveCameraControls } from './driveCameraControls.js';
import { BarrierCollision } from './barrierCollision.js';
import { isTrackBoundary, createShadowCandidate, updateShadowCandidates } from './trackBoundaries.js';
import { partitionMesh, canCullBackfaces, WorldOptimization, freezeStaticWorld } from './worldOptimization.js';
import { createSurfaceDetail } from './surfaceDetail.js';
import { createLocalReflections } from './localReflections.js';
import { createGraphicsDiagnostics } from './graphicsDiagnostics.js';
import { createWeather } from './weather.js';
import { createTireEffects } from './tireEffects.js';
import { loadingScreen } from './loadingScreen.js';
import { fetchAssetBytes } from './assetTransfer.js';
import './style.css';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const ui = Object.fromEntries(['loading','menu','garage','controls','pause','hud','progress-bar','loading-copy','drive-button','garage-button','time-toggle','pause-time-toggle','route-time','garage-ferrari','garage-elantra','elantra-availability','garage-status','garage-back','paint-name','custom-paint','pause-garage','pause-controls','engine-volume','controls-button','close-controls','resume','restart','exit','speed','gear','rpm','transmission','headlight-mode','aid-abs','aid-tcs','aid-esc','susp-0','susp-1','susp-2','susp-3','minimap','toast'].map(id => [id, document.getElementById(id)]));
const garageChoices = new Map([...document.querySelectorAll('[data-vehicle]')].map(button => [button.dataset.vehicle, button]));
const canvas = document.getElementById('game');
loadingScreen.stage('Preparing your graphics…', 'STARTING UP', 'Setting the scene for your drive.');
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
const garageEnvironment = environment.fromScene(room, 0.035);
const skyEnvironments = createSkyEnvironments(renderer, sky);
scene.environment = skyEnvironments.day.texture;
room.dispose();
environment.dispose();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, 6000);
camera.up.set(0, 0, 1);
const graphicsOptions = new URLSearchParams(location.search);
const worldOptimization = new WorldOptimization(camera, { occlusion: graphicsOptions.get('occlusion') !== 'off' });
const multiDrawSupported = renderer.extensions.has('WEBGL_multi_draw');
const surfaceDetail = createSurfaceDetail();
surfaceDetail.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const localReflections = createLocalReflections(renderer, scene, sky);
const weather = createWeather(scene, sky);
const tireEffects = createTireEffects(scene);
const clock = new THREE.Clock();
const draco = new DRACOLoader().setDecoderPath('/draco/');
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(draco);
const keys = new Set();
let route, minimap, car, handling, collisionMeshes = [], mode = 'loading', cameraMode = 0, lastSafe;
let isMultiplayer = false, multiplayerSession = null, baseCarAssetScene = null;

function attachVehicleNetHooks(vehicle) {
  if (!vehicle) return;
  vehicle.getNetState = () => {
    const wheels = [];
    for (let i = 0; i < 4; i++) {
      const w = handling?.wheels[i];
      if (!w) continue;
      const isSkidding = (w.grounded && w.load >= 150 && w.normal.z >= 0.45 && w.surfaceMu >= 0.9 && w.slideSpeed >= 2.5) ? 1 : 0;
      const smokeIntensity = THREE.MathUtils.clamp((w.slideSpeed - 4.5) / 12, 0, 1);
      wheels.push({
        st: w.steer || 0,
        rot: w.spinAngle || 0,
        sl: w.slideSpeed || 0,
        sk: isSkidding,
        sm: smokeIntensity,
        c: w.grounded ? 1 : 0,
        cp: w.grounded && w.contact ? [w.contact.x, w.contact.y, w.contact.z] : null,
      });
    }
    const isBraking = Boolean(handling && (handling.brakeForceInput > 0.1 || handling.handbrake));
    const isReverse = Boolean(handling && handling.gear === 0);
    return {
      p: [vehicle.position.x, vehicle.position.y, vehicle.position.z],
      q: [vehicle.quaternion.x, vehicle.quaternion.y, vehicle.quaternion.z, vehicle.quaternion.w],
      v: handling ? [handling.velocity.x, handling.velocity.y, handling.velocity.z] : [0, 0, 0],
      av: handling ? [handling.angularVelocity.x, handling.angularVelocity.y, handling.angularVelocity.z] : [0, 0, 0],
      spd: handling ? Math.hypot(handling.velocity.x, handling.velocity.y) * 3.6 : 0,
      in: {
        th: handling?.throttle ?? 0,
        br: handling?.braking ?? 0,
        st: handling?.steer ?? 0,
        hb: handling?.handbrake ? 1 : 0,
        rev: isReverse ? 1 : 0,
      },
      li: {
        head: headlightMode,
        brake: isBraking ? 1 : 0,
        rev: isReverse ? 1 : 0,
      },
      w: wheels,
    };
  };
  vehicle.setWorldTransform = (pos, heading) => {
    resetCar(false, false, { position: new THREE.Vector3(...pos), heading });
  };
}
let packedAssets = {};
let assetFileBytes = {};
let physicsAccumulator = 0, safeTimer = 0;
let physicsPosition, previousBodyPosition, previousBodyQuaternion;
const interpolatedBody = new THREE.Vector3(), interpolatedQuaternion = new THREE.Quaternion();
const minimapForward = new THREE.Vector3();
let pendingShiftUp = false, pendingShiftDown = false;
let padShiftUpHeld = false, padShiftDownHeld = false;
let padCameraHeld = false, padTransmissionHeld = false;
let activeVehicle = VEHICLES.ferrari;
const engineAudio = new EngineAudio();
let garageOrigin = 'menu';
let garagePlateView = 'car';
let controlsOrigin = 'menu';
const availableVehicles = new Set(['ferrari']);
const carCache = new Map();
const shadowCandidates = [];
const barrierCollision = new BarrierCollision();
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
const DEFAULT_PAINT = { ferrari: '#a80719', elantra: '#b9c3ca', amg: '#b9c3ca', prado: '#f4f1e9' };
const paintSelections = { ...DEFAULT_PAINT };
for (const vehicleId of Object.keys(DEFAULT_PAINT)) {
  try {
    const saved = localStorage.getItem(`baku-paint-${vehicleId}`);
    if (/^#[0-9a-f]{6}$/i.test(saved ?? '')) paintSelections[vehicleId] = saved.toLowerCase();
  } catch { /* storage is optional */ }
}
const FIXED_STEP = 1 / 120;
const plateSelections = {};
for (const id of Object.keys(VEHICLES)) {
  try { plateSelections[id] = readPlateSettings(localStorage, id); }
  catch { plateSelections[id] = readPlateSettings(null, id); }
}
const plateControls = createLicensePlateControls(ui.garage, {
  getSettings: () => plateSelections[activeVehicle.id],
  onChange: settings => {
    plateSelections[activeVehicle.id] = settings;
    try { savePlateSettings(localStorage, activeVehicle.id, settings); } catch { /* optional storage */ }
    if (car) updateLicensePlates(car, settings);
  },
  onInspect: view => {
    garagePlateView = view;
    ui.garage.classList.toggle('garage-plate-inspect', view !== 'car');
    if (view === 'car') plateControls.resetView();
  },
});
plateControls.render();

const hemisphere = new THREE.HemisphereLight(0xcbe9ff, 0x6d6657, 0.88);
hemisphere.position.set(0, 0, 1); // The circuit uses Z-up, including its sky illumination.
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xfff7ee, 2.75);
sun.position.set(-800, -400, 1100); sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096); sun.shadow.camera.near = 10; sun.shadow.camera.far = 2500;
sun.shadow.camera.left = -100; sun.shadow.camera.right = 100; sun.shadow.camera.top = 100; sun.shadow.camera.bottom = -100;
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.008;
scene.add(sun, sun.target);
const shadowAnchor = new THREE.Vector3();
const shadowOffset = new THREE.Vector3(450, 165, 310);
const graphics = createGraphics(renderer, scene, camera, sun);
const graphicsQuality = document.getElementById('graphics-quality');
let savedQuality = 'cinematic';
try { savedQuality = localStorage.getItem('baku-graphics-quality') ?? 'cinematic'; } catch { /* storage is optional */ }
graphicsQuality.value = graphics.setQuality(savedQuality);
localReflections.setQuality(graphics.quality);
weather.setQuality(graphics.quality);
const weatherSelectors = [document.getElementById('menu-weather'), document.getElementById('pause-weather')];
const aoControl = document.getElementById('ambient-occlusion');
const scaleControl = document.getElementById('render-scale');
const precipitationControl = document.getElementById('precipitation-intensity');
const precipitationAmount = document.getElementById('precipitation-amount');
try {
  weather.setMode(localStorage.getItem('baku-weather') ?? 'sunny');
  weather.setIntensity(localStorage.getItem('baku-precipitation-intensity') ?? 1);
  aoControl.checked = localStorage.getItem('baku-ambient-occlusion') !== 'false';
  scaleControl.value = String(graphics.setRenderScale(localStorage.getItem('baku-render-scale') ?? 1));
} catch { /* storage is optional */ }
precipitationControl.value = String(weather.intensity * 100);
precipitationAmount.value = `${Math.round(weather.intensity * 100)}%`;
precipitationControl.oninput = () => {
  const intensity = weather.setIntensity(Number(precipitationControl.value) / 100);
  precipitationAmount.value = `${Math.round(intensity * 100)}%`;
  try { localStorage.setItem('baku-precipitation-intensity', String(intensity)); } catch { /* storage is optional */ }
};
graphics.setAO(aoControl.checked);
aoControl.disabled = !graphics.aoAvailable;
for (const selector of weatherSelectors) {
  selector.value = weather.mode;
  selector.onchange = () => setWeather(selector.value);
}
aoControl.onchange = () => {
  graphics.setAO(aoControl.checked);
  try { localStorage.setItem('baku-ambient-occlusion', String(aoControl.checked)); } catch { /* storage is optional */ }
};
scaleControl.onchange = () => {
  scaleControl.value = String(graphics.setRenderScale(scaleControl.value));
  try { localStorage.setItem('baku-render-scale', scaleControl.value); } catch { /* storage is optional */ }
};
const graphicsDiagnostics = createGraphicsDiagnostics(renderer, worldOptimization, localReflections, graphics, graphicsOptions.has('graphicsDebug'));
graphicsQuality.onchange = () => {
  graphicsQuality.value = graphics.setQuality(graphicsQuality.value);
  localReflections.setQuality(graphics.quality);
  weather.setQuality(graphics.quality);
  aoControl.disabled = !graphics.aoAvailable;
  try { localStorage.setItem('baku-graphics-quality', graphicsQuality.value); } catch { /* storage is optional */ }
};

function addHeadlights(vehicle) {
  if (vehicle.userData.headlights) return;
  const lights = [];
  const nose = activeVehicle.dims.length * 0.43;
  for (const x of [-0.55, 0.55]) {
    const lamp = new THREE.SpotLight(0xe8f2ff, 0, 28, 0.42, 0.75, 1.35);
    lamp.position.set(x, nose, activeVehicle.headlightHeight ?? (activeVehicle.id === 'elantra' ? 0.77 : 0.6));
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
  setHeadlightBulbs(vehicle, headlightMode);
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
  applyWeatherLighting();
  shadowOffset.set(nightMode ? 270 : 450, nightMode ? 190 : 165, nightMode ? 590 : 310);
  renderer.toneMappingExposure = nightMode ? 1.1 : 0.97;
  graphics.setNight(nightMode);
  localReflections.invalidate();
  for (const toggle of [ui['time-toggle'], ui['pause-time-toggle']]) {
    toggle.textContent = nightMode ? '☾ NIGHT MODE' : '☀ DAY MODE';
    toggle.setAttribute('aria-pressed', String(nightMode));
  }
  ui['route-time'].textContent = `6.003 KM · ${nightMode ? 'NIGHT' : 'DAY'} · ${weather.preset.label.toUpperCase()}`;
  for (const material of nightMaterials) material.emissiveIntensity = nightMode ? 0.42 : 0;
  if (save) try { localStorage.setItem('baku-night-mode', String(nightMode)); } catch { /* storage is optional */ }
}

function applyWeatherLighting() {
  const preset = weather.preset;
  scene.fog.color.set(nightMode ? 0x263b56 : preset.fogColor);
  scene.fog.density = preset.fog * (nightMode ? 1.25 : 1);
  hemisphere.color.set(nightMode ? 0x99b9ee : 0xd6e3ee);
  hemisphere.groundColor.set(nightMode ? 0x343e54 : 0x79817e);
  hemisphere.intensity = (nightMode ? 0.46 : 0.65) + preset.clouds * (nightMode ? .1 : .42);
  sun.color.set(nightMode ? 0xb4ccff : 0xfff7ee);
  sun.intensity = (nightMode ? 0.60 : 2.75) * preset.sun;
  scene.environment = skyEnvironments.get(nightMode, preset.clouds).texture;
  scene.environmentIntensity = nightMode ? 1.4 : 0.85 + preset.clouds * .25;
}

function setWeather(value, save = true) {
  weather.setMode(value);
  for (const selector of weatherSelectors) selector.value = weather.mode;
  applyWeatherLighting();
  localReflections.invalidate();
  ui['route-time'].textContent = `6.003 KM · ${nightMode ? 'NIGHT' : 'DAY'} · ${weather.preset.label.toUpperCase()}`;
  if (save) try { localStorage.setItem('baku-weather', weather.mode); } catch { /* storage is optional */ }
}

const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function reportAsset(url, event) {
  loadingScreen.bytes(url, event.loaded, event.total);
  if (event.complete) loadingScreen.downloaded(url, event.loaded);
}
async function loadGLB(url, onProgress) {
  const name = url.match(/\/generated\/(baku|buildings)\.glb$/)?.[1];
  const packed = name && packedAssets[name];
  let buffer;
  if (!packed) {
    const bytes = await fetchAssetBytes(url, event => { reportAsset(url, event); onProgress?.(event); }, { expectedBytes: assetFileBytes[url] });
    buffer = bytes.buffer;
  } else {
    const controller = new AbortController();
    const partBytes = packed.parts.map(() => 0);
    let chunks;
    try {
      chunks = await Promise.all(packed.parts.map((filename, index) => fetchAssetBytes(`/generated/${filename}`, event => {
        partBytes[index] = event.loaded;
        const combined = { loaded: partBytes.reduce((sum, bytes) => sum + bytes, 0), total: packed.compressedBytes };
        reportAsset(url, combined); onProgress?.(combined);
      }, { signal: controller.signal })));
    } catch (error) { controller.abort(); throw error; }
    const received = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    if (received !== packed.compressedBytes) throw new Error(`Map asset ${name} was incomplete.`);
    loadingScreen.downloaded(url, received);
    loadingScreen.stage(name === 'baku' ? 'Unpacking Baku streets…' : 'Unpacking the city skyline…', name === 'baku' ? '01 / 05 · THE STREETS' : '02 / 05 · THE SKYLINE', 'Preparing geometry and textures for the city.');
    await nextPaint();
    const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'));
    buffer = await new Response(stream).arrayBuffer();
    if (buffer.byteLength !== packed.originalBytes) throw new Error(`Map asset ${name} was incomplete.`);
  }
  return loader.parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1));
}

async function tuneMap(root) {
  scene.add(root);
  root.updateMatrixWorld(true);
  const meshes = [], backfaceMaterials = new Map();
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  let yieldedAt = performance.now();
  for (const o of meshes) {
    o.receiveShadow = true;
    o.castShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.envMapIntensity = 0.38;
      if (m.alphaTest > 0) m.alphaTest = /tree|hedge|grass_bridge/i.test(m.name) ? 0.38 : 10 / 255;
      if (m.alphaTest > 0) m.alphaToCoverage = true;
      if (/water/i.test(m.name)) { m.roughness = 0.16; m.metalness = 0.18; m.envMapIntensity = 0.55; }
      surfaceDetail.apply(m);
      weather.apply(m);
      if (/window|glass/i.test(m.name)) { m.roughness = 0.22; m.metalness = 0.24; m.envMapIntensity = 0.62; }
      if (/window|building.*lights/i.test(m.name) && m.emissive && !m.transparent && !nightMaterials.includes(m)) {
        m.emissive.set(0xffd7a3);
        m.emissiveMap = m.map;
        m.emissiveIntensity = nightMode ? 0.42 : 0;
        nightMaterials.push(m);
      }
      for (const tex of [m.map, m.normalMap, m.roughnessMap]) if (tex) tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    }
    if (!Array.isArray(o.material)) backfaceMaterials.set(o.material, (backfaceMaterials.get(o.material) ?? true) && canCullBackfaces(o));
    if (performance.now() - yieldedAt > 20) { await nextPaint(); yieldedAt = performance.now(); }
  }
  for (const [material, eligible] of backfaceMaterials) {
    if (eligible) {
      material.side = THREE.FrontSide;
      material.shadowSide = THREE.DoubleSide; // Supplied facades may be thin planes.
      material.needsUpdate = true; worldOptimization.stats.singleSided++;
    }
  }
  for (const o of meshes) {
    worldOptimization.addOccluders(o);
    // Preserve the original barrier geometry/BVH for physics, independently of
    // render chunks and their camera-specific draw ranges.
    if (isTrackBoundary(o)) barrierCollision.addMesh(o);
    const chunks = partitionMesh(o, multiDrawSupported ? 96 : 256);
    if (chunks[0] !== o) {
      if (multiDrawSupported && !o.material.transparent) o.parent.add(worldOptimization.addBatchedMesh(chunks));
      else for (const chunk of chunks) { o.parent.add(chunk); worldOptimization.addMesh(chunk); }
      if (isTrackBoundary(o)) o.visible = false;
      else { o.removeFromParent(); o.geometry.dispose(); }
    } else worldOptimization.addMesh(o);
    for (const chunk of chunks) {
      const candidate = createShadowCandidate(chunk);
      if (candidate) shadowCandidates.push(candidate);
    }
    if (performance.now() - yieldedAt > 20) { await nextPaint(); yieldedAt = performance.now(); }
  }
  freezeStaticWorld(root);
}

async function boot() {
  try {
    try { setNightMode(localStorage.getItem('baku-night-mode') === 'true', false); } catch { setNightMode(false, false); }
    const packedResponse = await fetch('/generated/asset-manifest.json');
    if (packedResponse.ok) {
      const manifest = await packedResponse.json();
      packedAssets = manifest.assets ?? {};
      assetFileBytes = manifest.files ?? {};
    }
    let savedVehicle;
    try { savedVehicle = localStorage.getItem('baku-selected-car'); } catch { /* storage is optional */ }
    const savedSettings = VEHICLES[savedVehicle];
    const vehicleFiles = savedSettings && savedVehicle !== 'ferrari' ? [savedSettings.asset, savedSettings.wheelAsset ?? (savedVehicle === 'elantra' ? '/assets/vehicles/elantra-wheel.glb' : null)].filter(Boolean) : [];
    loadingScreen.plan(Object.fromEntries([
      ['/generated/route.json', assetFileBytes['/generated/route.json']],
      ['/generated/baku.glb', packedAssets.baku?.compressedBytes],
      ['/generated/buildings.glb', packedAssets.buildings?.compressedBytes],
      ['/generated/collision.glb', assetFileBytes['/generated/collision.glb']],
      [VEHICLES.ferrari.asset, assetFileBytes[VEHICLES.ferrari.asset]],
      ...vehicleFiles.map(file => [file, assetFileBytes[file]]),
    ]));
    loadingScreen.stage('Reading your route…', '01 / 05 · THE STREETS', 'Finding your starting point.');
    const routeBytes = await fetchAssetBytes('/generated/route.json', event => reportAsset('/generated/route.json', event), { expectedBytes: assetFileBytes['/generated/route.json'] });
    route = JSON.parse(new TextDecoder().decode(routeBytes));
    loadingScreen.stage('Loading Baku streets…', '01 / 05 · THE STREETS', 'Downloading the streets and their textures.', true);
    const map = await loadGLB('/generated/baku.glb');
    loadingScreen.stage('Mapping Baku streets…', '01 / 05 · THE STREETS', 'Tracing the circuit and its surrounding roads.');
    minimap = await createMinimap(map.scene);
    await tuneMap(map.scene);
    loadingScreen.stage('Loading the city skyline…', '02 / 05 · THE SKYLINE', 'Bringing the city into view.', true);
    const buildings = await loadGLB('/generated/buildings.glb'); await tuneMap(buildings.scene);
    loadingScreen.stage('Preparing road contact…', '03 / 05 · THE ROAD', 'Downloading the road surface.', true);
    const collision = await loadGLB('/generated/collision.glb');
    loadingScreen.stage('Preparing road contact…', '03 / 05 · THE ROAD', 'Building the surfaces your tires will meet.');
    const roadMeshes = [];
    collision.scene.traverse(o => { if (o.isMesh) roadMeshes.push(o); });
    await nextPaint();
    let roadYieldedAt = performance.now();
    for (const o of roadMeshes) {
      o.visible = false; o.geometry.computeBoundsTree({ targetLeafSize: 20 }); collisionMeshes.push(o);
      if (performance.now() - roadYieldedAt > 20) { await nextPaint(); roadYieldedAt = performance.now(); }
    }
    scene.add(collision.scene);
    collision.scene.updateMatrixWorld(true);
    for (const mesh of collisionMeshes) barrierCollision.addMesh(mesh);
    freezeStaticWorld(collision.scene);
    loadingScreen.stage('Preparing your car…', '04 / 05 · YOUR CAR', 'Downloading your first ride.', true);
    const carAsset = await loadGLB('/assets/vehicles/ferrari-458.glb');
    baseCarAssetScene = carAsset.scene.clone(true);
    car = createCarModel(carAsset); updateLicensePlates(car, plateSelections.ferrari); carCache.set('ferrari', car); scene.add(car); addHeadlights(car); applyPaint(car, 'ferrari'); updatePaintUI(); scene.updateMatrixWorld(true); resetCar(false, false);
    attachVehicleNetHooks(car);
    await Promise.all(Object.values(VEHICLES).filter(vehicle => vehicle.id !== 'ferrari').map(async vehicle => {
      const files = [vehicle.asset, vehicle.wheelAsset].filter(Boolean);
      const responses = await Promise.allSettled(files.map(file => fetch(file, { method: 'HEAD' })));
      const available = responses.every(response => response.status === 'fulfilled' && response.value.ok);
      const choice = garageChoices.get(vehicle.id);
      choice.disabled = !available;
      choice.querySelector('span').textContent = available ? vehicle.subtitle : 'Model unavailable';
      if (available) availableVehicles.add(vehicle.id);
    }));
    if (savedVehicle && availableVehicles.has(savedVehicle)) {
      loadingScreen.stage('Loading your garage car…', '04 / 05 · YOUR CAR', 'Bringing your saved ride back to the city.', true);
      await selectVehicle(savedVehicle);
    }
    if (activeVehicle.id !== savedVehicle) for (const file of vehicleFiles) loadingScreen.omit(file);
    loadingScreen.stage('Preparing city lighting…', '05 / 05 · THE ATMOSPHERE', 'Finishing shaders, reflections, and the first view.');
    await nextPaint();
    updateCamera(1 / 60); scene.updateMatrixWorld(true); updateSceneLighting(1 / 60); worldOptimization.update();
    await renderer.compileAsync(scene, camera);
    ui.menu.inert = true;
    ui.menu.classList.remove('hidden'); mode = 'menu';
    // Two presented frames warm the post-processing targets before the dissolve.
    await nextPaint();
    const loadingHadFocus = ui.loading.contains(document.activeElement);
    await loadingScreen.finish();
    ui.menu.inert = false;
    if (loadingHadFocus) ui['drive-button'].focus({ preventScroll: true });
  } catch(err) { loadingScreen.fail(err); console.error(err); }
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
  tireEffects.reset();
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
function exitToMenu(){
  if (isMultiplayer && multiplayerSession) {
    multiplayerSession.stop();
    multiplayerSession = null;
    isMultiplayer = false;
  }
  mode='menu';keys.clear();driveCamera.setRearHeld(false);ui.pause.classList.add('hidden');ui.hud.classList.add('hidden');ui.menu.classList.remove('hidden');releaseDrivePointer();
}
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
  ui.garage.classList.remove('garage-plate-inspect');
  garagePlateView = 'car'; plateControls.resetView(); plateControls.render();
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
      const settings = VEHICLES[id];
      const newCar = carCache.get(id) ?? (id === 'elantra' ? await loadElantraModel((url, event) => reportAsset(url, event))
        : settings.wheelAsset ? await loadImportedVehicle(settings, loadGLB)
        : createCarModel(await loadGLB(settings.asset)));
      carCache.set(id, newCar);
      scene.remove(car);
      car = newCar;
      scene.add(car);
      activeVehicle = VEHICLES[id];
      addHeadlights(car);
      applyPaint(car, id);
      updateLicensePlates(car, plateSelections[id]);
      attachVehicleNetHooks(car);
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
  for (const [vehicleId, button] of garageChoices) button.classList.toggle('selected', vehicleId === id);
  updatePaintUI();
  plateControls.render();
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

function updateCar(dt) {
  if (mode !== 'drive') return;
  physicsAccumulator = Math.min(physicsAccumulator + dt, FIXED_STEP * 8);
  while (physicsAccumulator >= FIXED_STEP) {
    previousBodyPosition.copy(handling.position);
    previousBodyQuaternion.copy(handling.quaternion);
    stepDynamics(handling, drivingInput(), FIXED_STEP, activeVehicle, sampleGround);
    barrierCollision.resolve(handling, previousBodyPosition, previousBodyQuaternion, activeVehicle);
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
  minimapForward.set(0, 1, 0).applyQuaternion(car.quaternion);
  drawMinimap(ui.minimap, minimap, route, car.position, Math.atan2(-minimapForward.x, minimapForward.y), Math.hypot(handling.velocity.x, handling.velocity.y));
}

function updateSceneLighting(dt) {
  if (!car) return;
  scene.environment = mode === 'garage' ? garageEnvironment.texture : skyEnvironments.get(nightMode, weather.preset.clouds).texture;
  scene.environmentIntensity = mode === 'garage' ? 0.85 : nightMode ? 1.4 : 0.85 + weather.preset.clouds * .25;
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
    updateShadowCandidates(shadowCandidates, car.position);
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
    if (garagePlateView !== 'car' && car.userData.licensePlates?.settings.enabled) {
      car.updateMatrixWorld(true);
      const rig = car.userData.licensePlates.rigs[garagePlateView === 'front' ? 0 : 1];
      const plateCenter = rig.getWorldPosition(new THREE.Vector3());
      const outward = new THREE.Vector3(0, 0, 1).transformDirection(rig.matrixWorld);
      const plateRight = new THREE.Vector3(1, 0, 0).transformDirection(rig.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(rig.matrixWorld);
      const narrow = innerWidth < 700;
      const panel = ui.garage.querySelector('.garage-panel').getBoundingClientRect();
      const width = narrow ? innerWidth : Math.max(100, innerWidth - panel.right);
      const height = narrow ? Math.max(100, panel.top) : innerHeight;
      const dimensions = PLATE_FORMATS[car.userData.licensePlates.settings.format];
      const halfFov = Math.tan(THREE.MathUtils.degToRad(47 / 2));
      const distance = Math.max(1.05,
        (dimensions.width + .08) * innerHeight / (2 * halfFov * Math.max(80, width - 32)),
        (dimensions.height + .10) * innerHeight / (2 * halfFov * Math.max(80, height - 32)));
      const desired = plateCenter.clone().addScaledVector(outward, distance).addScaledVector(plateRight, -.08).addScaledVector(up, .13);
      camera.position.lerp(desired, 1 - Math.exp(-dt * 5));
      cameraLook.copy(plateCenter);
      // Shift the projection into the unobscured area without moving the camera
      // sideways into the bumper or sending the registration beyond the viewport.
      camera.setViewOffset(innerWidth, innerHeight, narrow ? 0 : -panel.right / 2,
        narrow ? (innerHeight - height) / 2 : 0, innerWidth, innerHeight);
      camera.lookAt(cameraLook); camera.fov = THREE.MathUtils.damp(camera.fov, 47, 5, dt);
      camera.updateProjectionMatrix(); return;
    }
    if (camera.view?.enabled) camera.clearViewOffset();
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
  if (camera.view?.enabled) camera.clearViewOffset();
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
  const hood = activeVehicle.hoodCamera ?? (activeVehicle.id === 'elantra' ? { height: 1.15, forward: 1.3 } : { height: 0.88, forward: 1.22 });
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
  if (mode !== 'drive' && e.target.matches?.('input, select, textarea, button') && e.code !== 'Escape') return;
  // Let the precipitation slider use its native arrow-key adjustment while paused.
  if (mode !== 'drive' && e.target === precipitationControl && e.code !== 'Escape') return;
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
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();graphics.resize();});
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
ui['drive-button'].onclick=startDrive;ui['garage-button'].onclick=openGarage;ui['time-toggle'].onclick=()=>setNightMode(!nightMode);ui['pause-time-toggle'].onclick=()=>setNightMode(!nightMode);ui['pause-garage'].onclick=openGarage;ui['garage-back'].onclick=closeGarage;ui['controls-button'].onclick=openControls;ui['pause-controls'].onclick=openControls;ui['close-controls'].onclick=closeControls;ui.resume.onclick=resume;ui.restart.onclick=()=>{recoverInPlace();resume()};ui.exit.onclick=exitToMenu;ui['engine-volume'].oninput=e=>engineAudio.setVolume(e.target.value);
for (const [id, button] of garageChoices) button.onclick = () => selectVehicle(id);
for (const swatch of document.querySelectorAll('.paint-swatch')) swatch.onclick=()=>choosePaint(swatch.dataset.paint);
ui['custom-paint'].oninput=e=>choosePaint(e.target.value);
for (const aid of ['abs','tcs','esc']) ui[`aid-${aid}`].onclick=()=>toggleAid(aid);

const mpUi = {
  btn: document.getElementById('multiplayer-button'),
  panel: document.getElementById('mp-menu-panel'),
  mainActions: document.getElementById('menu-main-actions'),
  nickInput: document.getElementById('mp-nick-input'),
  serverInput: document.getElementById('mp-server-input'),
  joinBtn: document.getElementById('mp-join-button'),
  backBtn: document.getElementById('mp-back-button'),
  advToggle: document.getElementById('mp-advanced-toggle'),
  serverField: document.getElementById('mp-server-field'),
  statusMsg: document.getElementById('mp-connect-status'),
};

if (mpUi.btn) {
  let resolvedUrl = '';
  mpUi.btn.onclick = async () => {
    mpUi.mainActions?.classList.add('hidden');
    mpUi.panel?.classList.remove('hidden');
    let savedNick = '';
    try { savedNick = localStorage.getItem('dab_nick') || ''; } catch { /* ignore */ }
    if (mpUi.nickInput) {
      mpUi.nickInput.value = savedNick;
      mpUi.joinBtn.disabled = !savedNick.trim();
      mpUi.nickInput.focus();
    }
    try {
      const { NetClient } = await import('./net/NetClient.js');
      resolvedUrl = await NetClient.resolveServerUrl();
      if (mpUi.serverInput) {
        mpUi.serverInput.value = resolvedUrl;
      }
      if (resolvedUrl) {
        mpUi.serverField?.classList.add('hidden');
      } else {
        mpUi.serverField?.classList.remove('hidden');
      }
    } catch { /* ignore */ }
  };

  mpUi.backBtn.onclick = () => {
    mpUi.panel?.classList.add('hidden');
    mpUi.mainActions?.classList.remove('hidden');
    if (mpUi.statusMsg) mpUi.statusMsg.textContent = '';
  };

  mpUi.advToggle.onclick = () => {
    mpUi.serverField?.classList.toggle('hidden');
  };

  mpUi.nickInput.oninput = () => {
    const val = mpUi.nickInput.value.trim();
    mpUi.joinBtn.disabled = !val;
  };

  const handleJoin = async () => {
    const nick = mpUi.nickInput.value.trim();
    if (!nick) return;
    const url = mpUi.serverInput.value.trim() || resolvedUrl;
    try {
      localStorage.setItem('dab_nick', nick);
      if (url) localStorage.setItem('dab_server_url', url);
    } catch { /* ignore */ }

    if (mpUi.statusMsg) mpUi.statusMsg.textContent = 'Connecting…';
    mpUi.joinBtn.disabled = true;

    try {
      isMultiplayer = true;
      const { MultiplayerSession } = await import('./net/MultiplayerSession.js');
      startDrive();
      multiplayerSession = await MultiplayerSession.start({
        nick,
        serverUrl: url,
        scene,
        localVehicle: car,
        baseAssetScene: baseCarAssetScene,
        camera,
        onToast: toast,
      });
      mpUi.panel?.classList.add('hidden');
      mpUi.mainActions?.classList.remove('hidden');
      if (mpUi.statusMsg) mpUi.statusMsg.textContent = '';
    } catch (err) {
      console.error('Multiplayer start failed:', err);
      if (mpUi.statusMsg) mpUi.statusMsg.textContent = 'Failed to join: ' + err.message;
      mpUi.joinBtn.disabled = false;
      isMultiplayer = false;
    }
  };

  mpUi.joinBtn.onclick = handleJoin;
  mpUi.nickInput.onkeydown = e => {
    if (e.key === 'Enter' && !mpUi.joinBtn.disabled) handleJoin();
    if (e.key === 'Escape') mpUi.backBtn.click();
  };
  mpUi.serverInput.onkeydown = e => {
    if (e.key === 'Enter' && !mpUi.joinBtn.disabled) handleJoin();
    if (e.key === 'Escape') mpUi.backBtn.click();
  };
}

function frame() {
  requestAnimationFrame(frame);
  // The introduction has its own lightweight motion; don't render an unfinished city.
  if (mode === 'loading') return;
  graphicsDiagnostics.begin();
  const dt = Math.min(clock.getDelta(), 0.1);
  updateCar(dt); updateCamera(dt); updateSceneLighting(dt);
  sky.position.copy(camera.position); sky.material.uniforms.time.value += dt;
  weather.update(dt, camera, mode !== 'garage' && mode !== 'loading');
  engineAudio.update(handling, activeVehicle, mode === 'drive', dt);
  tireEffects.update(dt, handling, activeVehicle, weather.preset, mode === 'drive', mode !== 'garage' && mode !== 'loading');
  if (isMultiplayer && multiplayerSession) multiplayerSession.update(dt);
  worldOptimization.update();
  localReflections.update(dt, car, carCache.values(), mode === 'garage' || mode === 'loading');
  graphics.render(dt);
  graphicsDiagnostics.end();
}
boot(); frame();
