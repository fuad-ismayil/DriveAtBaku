import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createElantraCaliper } from '../src/elantraAlloys.js';
import { prepareElantraWheel } from '../src/elantraWheel.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { createCarModel, animateCarModel } from '../src/carModel.js';
import { createSky } from '../src/sky.js';
import { createSurfaceDetail } from '../src/surfaceDetail.js';
import { createWeather, WEATHER_PRESETS } from '../src/weather.js';
import { StreetScenePass, StreetAOPass } from '../src/streetAOPass.js';

const wheelFile = readFileSync(new URL('../public/assets/vehicles/elantra-wheel.glb', import.meta.url));
const wheelAsset = await new GLTFLoader().parseAsync(wheelFile.buffer.slice(wheelFile.byteOffset, wheelFile.byteOffset + wheelFile.byteLength), '');
const wheel = prepareElantraWheel(wheelAsset.scene);
const wheelBounds = new THREE.Box3().setFromObject(wheel);
assert.equal(wheel.children.length, 4, 'the supplied wheel retains all four authored primitives');
assert.ok(wheelBounds.min.x > -.12 && wheelBounds.max.x < .12, 'supplied wheel fits within the existing tire width');
assert.ok(Math.abs(wheelBounds.getSize(new THREE.Vector3()).y - .68 * .95) < .00001, 'supplied wheel is visually 5% smaller');
assert.ok(wheelBounds.getCenter(new THREE.Vector3()).length() < .00001, 'spinning axle passes through the wheel center');
const leftWheel = wheel.clone(); leftWheel.rotation.y = Math.PI; leftWheel.updateMatrix();
assert.equal(leftWheel.children[0].geometry, wheel.children[0].geometry, 'all corners share supplied geometry');
assert.ok(leftWheel.matrix.determinant() > 0, 'left-side fitting does not invert normals');
wheel.traverse(mesh => {
  if (!mesh.isMesh) return;
  for (const value of mesh.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value), 'rim geometry remains finite');
  const normals = mesh.geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) assert.ok(new THREE.Vector3().fromBufferAttribute(normals, i).length() > .9, 'beveled spokes have valid normals');
});
const caliper = createElantraCaliper();
assert.ok(!wheel.children.includes(caliper), 'caliper attaches to steering/suspension rather than spinning with the rim');
const ferrari = createCarModel({ scene: new THREE.Group() });
assert.equal(ferrari.children.length, 1, 'Ferrari model adds no separate ground-shadow rectangle');
const glassFixture = new THREE.Group();
const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
windowMesh.name = 'glass'; glassFixture.add(windowMesh);
createCarModel({ scene: glassFixture });
assert.equal(windowMesh.material.depthWrite, false, 'Ferrari glass does not become an opaque AO occluder');
assert.equal(windowMesh.castShadow, false, 'transparent Ferrari glass does not cast a solid shadow');

// The real GLB uses a separate "brakes" mesh for the two circular rear lenses.
const ferrariBytes = readFileSync(new URL('../public/assets/vehicles/ferrari-458.glb', import.meta.url));
const ferrariJson = JSON.parse(ferrariBytes.subarray(20, 20 + ferrariBytes.readUInt32LE(12)));
const circleNode = ferrariJson.nodes.find(n => n.name === 'brakes');
assert.ok(circleNode && ferrariJson.meshes[circleNode.mesh].primitives.every(p => ferrariJson.materials[p.material].name === 'Taillight_Glass'));
const lampFixture = new THREE.Group();
const circle = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshStandardMaterial()); circle.name = 'brakes';
const markers = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); markers.name = 'lights_red';
const trim = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); trim.name = 'unchanged trim';
const trimMaterial = trim.material; lampFixture.add(circle, markers, trim);
const litFerrari = createCarModel({ scene: lampFixture });
assert.equal(trim.material, trimMaterial, 'adding circular brake lights preserves other finishes');
assert.ok(litFerrari.userData.brakeLights.includes(circle.material));
assert.ok(!litFerrari.userData.reverseLightMaterials.includes(circle.material), 'red circles remain separate from the existing reverse markers');
const lampState = { wheels: [], staticCompression: 0, gear: 1, brakeForceInput: 1, handbrake: false };
animateCarModel(litFerrari, lampState, 1);
assert.ok(circle.material.emissiveIntensity > 3.59, 'circular rear lenses illuminate under braking');
lampState.brakeForceInput = 0; lampState.gear = 0; animateCarModel(litFerrari, lampState, 1);
assert.ok(Math.abs(circle.material.emissiveIntensity - .3) < .00001, 'circles return to their red resting level after braking');
assert.equal(circle.material.emissive.getHex(), 0xff1722);

const scene = new THREE.Scene(), sky = createSky(), camera = new THREE.PerspectiveCamera();
const weather = createWeather(scene, sky), detail = createSurfaceDetail();
const road = new THREE.MeshStandardMaterial({ name: 'ROAD_AZER-0' });
assert.ok(detail.apply(road)); assert.ok(weather.apply(road));
assert.equal(weather.apply(road), false, 'weather callback is installed only once');
const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
  fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>' };
road.onBeforeCompile(shader, {});
assert.ok(shader.uniforms.streetDetail && shader.uniforms.weatherWetness && shader.uniforms.weatherSnow, 'weather preserves the road detail shader');
assert.ok(shader.vertexShader.includes('batchingMatrix * weatherWorld'), 'batched surfaces use world-space weather masks');
assert.ok(shader.fragmentShader.includes('streetGrain') && shader.fragmentShader.includes('settledSnow'), 'both shader patches survive composition');
assert.equal(road.roughness, .97, 'dry road starts with a matte finish');
assert.ok(shader.fragmentShader.includes('roadSheen=mix(.28,1.0,weatherWetness)'), 'wet modes restore their full specular response');
const transparent = new THREE.MeshPhysicalMaterial({ transparent: true });
assert.equal(weather.apply(transparent), false, 'glass is not whitened by opaque snow shading');
const fence = new THREE.MeshStandardMaterial({ alphaTest: .04, side: THREE.DoubleSide });
weather.apply(fence);
assert.equal(fence.alphaTest, .04); assert.equal(fence.side, THREE.DoubleSide, 'cutout visibility is preserved');
const version = road.version;
for (const [id, preset] of Object.entries(WEATHER_PRESETS)) {
  weather.setMode(id); weather.update(.016, camera);
  assert.equal(shader.uniforms.weatherWetness.value, preset.wet);
  assert.equal(shader.uniforms.weatherSnow.value, preset.snow);
  assert.equal(sky.material.uniforms.cloudCover.value, preset.clouds);
  assert.equal(scene.getObjectByName('weather rain').visible, id === 'rain');
  assert.equal(scene.getObjectByName('weather snow').visible, id === 'snow');
  weather.update(.016, camera, false);
  assert.equal(scene.getObjectByName('weather rain').visible, false, 'garage excludes precipitation');
  assert.equal(scene.getObjectByName('weather snow').visible, false);
}
assert.equal(road.version, version, 'weather transitions change uniforms without recompiling every map material');
weather.setMode('unknown'); assert.equal(weather.mode, 'sunny');
weather.setQuality('performance');
assert.equal(scene.getObjectByName('weather rain').geometry.drawRange.count, 1120);
const rain = scene.getObjectByName('weather rain'), snow = scene.getObjectByName('weather snow');
const rainPositions = rain.geometry.getAttribute('position'), snowPositions = snow.geometry.getAttribute('position');
for (const [quality, density] of [['performance', .35], ['balanced', .65], ['cinematic', 1]]) {
  weather.setQuality(quality);
  for (const intensity of [0, .25, 1, 2]) for (const mode of ['rain', 'snow']) {
    weather.setMode(mode); weather.setIntensity(intensity); weather.update(.016, camera);
    assert.equal(weather.intensity, intensity);
    assert.equal(rain.geometry.drawRange.count, Math.floor(1600 * density * intensity) * 2);
    assert.equal(snow.geometry.drawRange.count, Math.floor(1200 * density * intensity));
    assert.equal(rain.visible, mode === 'rain' && intensity > 0);
    assert.equal(snow.visible, mode === 'snow' && intensity > 0);
    assert.equal(shader.uniforms.weatherWetness.value, WEATHER_PRESETS[mode].wet, 'amount does not change wetness');
    assert.equal(shader.uniforms.weatherSnow.value, WEATHER_PRESETS[mode].snow, 'amount does not change snow cover');
    assert.equal(sky.material.uniforms.cloudCover.value, WEATHER_PRESETS[mode].clouds, 'amount does not change lighting');
  }
}
assert.equal(rain.geometry.getAttribute('position'), rainPositions, 'density changes reuse rain buffers');
assert.equal(snow.geometry.getAttribute('position'), snowPositions, 'density changes reuse snow buffers');
weather.setIntensity(.25); weather.setQuality('balanced');
assert.equal(weather.intensity, .25, 'quality switches preserve the chosen amount');
assert.equal(weather.setIntensity(-1), 0); assert.equal(weather.setIntensity(3), 2);
assert.equal(weather.setIntensity(NaN), 1);

const grainMap = new THREE.DataTexture(new Uint8Array(16), 2, 2);
const grainRoad = new THREE.MeshStandardMaterial({ name: 'ROADA_MAIN-material', map: grainMap });
detail.apply(grainRoad); weather.apply(grainRoad);
const grainShader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
  fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>' };
grainRoad.onBeforeCompile(grainShader, {});
assert.ok(grainShader.fragmentShader.includes('textureLod(map, vMapUv, streetMapMip)'), 'main road filters baked aggregate specks');
assert.ok(grainShader.fragmentShader.includes('streetGrainWeight'), 'unresolved procedural grain fades with pixel footprint');
assert.ok(grainShader.fragmentShader.includes('roadSheen=mix(.28,1.0,weatherWetness)'), 'filter preserves wet specular shader');
for (const name of ['ROAD_WHITELINE_A-material', 'BAK_ROAD_MARKINGS_A-material', 'PITROAD_ALLIANZ-material']) {
  assert.equal(detail.apply(new THREE.MeshStandardMaterial({ name, map: grainMap })), false, 'painted markings and advertising remain sharp');
}
const atlasRoad = new THREE.MeshStandardMaterial({ name: 'ROADA_2-material', map: grainMap });
detail.apply(atlasRoad);
const atlasShader = { uniforms: {}, vertexShader: '#include <common>', fragmentShader: '#include <common>\n#include <map_fragment>' };
atlasRoad.onBeforeCompile(atlasShader, {});
assert.ok(!atlasShader.uniforms.streetMapSize, 'numbered atlas textures retain their filtering');
grainMap.dispose();

const scenePass = new StreetScenePass(scene, camera, 4);
const ao = new StreetAOPass(scene, camera, scenePass.target.depthTexture);
scenePass.setSize(1920, 1080); ao.setSize(1920, 1080);
assert.equal(ao.gtaoMaterial.uniforms.tDepth.value, scenePass.target.depthTexture, 'AO uses the beauty pass depth with actual fence openings');
assert.equal(ao._renderGBuffer, false, 'AO does not render a solid normal override over cutouts');
assert.deepEqual([ao.width, ao.height], [960, 540], 'composer resize preserves half-resolution AO');
assert.equal(scenePass.target.samples, 4);
let releasedAO = 0;
ao.gtaoMaterial.addEventListener('dispose', () => releasedAO++);
ao.blendMaterial.addEventListener('dispose', () => releasedAO++);
ao.dispose(); assert.equal(releasedAO, 2, 'quality switches release the extra GTAO shader materials');
scenePass.dispose(); weather.dispose(); detail.dispose();
assert.equal(scene.getObjectByName('weather rain'), undefined, 'weather cleanup removes particle objects');
console.log('Realism: wheel bounds/normals, Ferrari grounding, weather transitions and shader composition, cutout depth AO, resize and cleanup passed.');
