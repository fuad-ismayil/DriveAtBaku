import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createImportedVehicle } from '../src/importedVehicleModel.js';
import { animateCarModel, setHeadlightBulbs } from '../src/carModel.js';
import { createDynamicsState, stepDynamics } from '../src/vehicleDynamics.js';
import { VEHICLES } from '../src/vehicleCatalog.js';

// Geometry/material checks run without a DOM image decoder. Embedded image
// decoding is checked separately in the browser. The supplied AMG plate is hidden.
const loader = new GLTFLoader().register(() => ({
  name: 'verification-image-placeholder', loadTexture: () => Promise.resolve(null),
}));
async function load(asset) {
  const bytes = readFileSync(new URL(`../public${asset}`, import.meta.url));
  return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
}
const meshes = object => { const result = []; object.traverse(o => { if (o.isMesh) result.push(o); }); return result; };
const dt = 1 / 120, reports = [];
for (const id of ['amg', 'prado']) {
  const settings = VEHICLES[id], [body, wheel] = await Promise.all([load(settings.asset), load(settings.wheelAsset)]);
  const model = createImportedVehicle(body, wheel, settings);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model.children.find(child => !model.userData.licensePlates.rigs.includes(child)));
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - settings.dims.length) < .00001, `${id}: normalized body length`);
  const mountedBounds = new THREE.Box3().setFromObject(model);
  assert.ok(mountedBounds.getSize(new THREE.Vector3()).y < settings.dims.length + .04, 'mounted plate thickness adds at most a small bumper projection');
  assert.ok(bounds.min.z > -.001 && bounds.min.z < .001, `${id}: tires rest on the ground`);
  assert.ok(Math.abs(bounds.max.z - settings.dims.height) < .08, `${id}: roof matches the collision/camera height`);
  assert.equal(model.userData.wheels.length, 4);
  if (id === 'amg') {
    assert.deepEqual(settings.modelFit.adjustments, { bodyHeight: 0, wheelbaseM: 2.75, trackM: 1.74, bodyLongitudinalOffset: -.015 }, 'saved fitting-page values match the user screenshot');
    const fittedBody = model.getObjectByName('amg supplied body');
    assert.equal(fittedBody.position.y, 0);
    assert.equal(fittedBody.position.z, -.015, 'fitting-page body offset is applied after export normalization');
    assert.equal(settings.trackM, 1.64, 'visual wheel adjustment leaves driving track unchanged');
  }
  const state = createDynamicsState(0, settings);
  for (const [index, rig] of model.userData.wheels.entries()) {
    const hp = state.wheels[index].hp;
    assert.equal(rig.physicsIndex, index);
    assert.equal(rig.front, index < 2);
    assert.equal(rig.steerPivot.position.x, (index % 2 ? 1 : -1) * (settings.modelFit.adjustments?.trackM ?? settings.trackM) / 2);
    assert.equal(rig.steerPivot.position.z, -hp.y, 'visual axles agree with the physical contact positions');
    assert.equal(rig.baseY, settings.wheelRadius);
    assert.ok(rig.steerPivot.matrixWorld.determinant() > 0, 'right rims are turned without inverting face normals');
    const spinning = meshes(rig.spinPivot);
    assert.equal(spinning.length, id === 'amg' ? 3 : 7, 'one complete wheel assembly at each corner');
    const first = meshes(model.userData.wheels[0].spinPivot);
    spinning.forEach((mesh, i) => {
      assert.equal(mesh.geometry, first[i].geometry, 'four corners share GPU geometry');
      assert.equal(mesh.material, first[i].material, 'four corners share material programs');
    });
    if (id === 'amg') assert.ok(spinning.every(mesh => /^wheel1_/.test(mesh.name)), 'overlapping exported duplicates are removed');
    if (id === 'prado') {
      assert.ok(!spinning.some(mesh => mesh.name === 'Object_164'), 'caliper does not rotate with the tire');
      assert.equal(meshes(rig.steerPivot).filter(mesh => mesh.name === 'Object_164').length, 1);
    }
  }
  for (const mesh of new Set(meshes(model))) {
    const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal');
    assert.ok(n && p.count === n.count, `${id}: complete surface normals`);
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)), 'finite fitted geometry');
      const length = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      assert.ok(Number.isFinite(length) && length > .9 && length < 1.1, 'valid normalized shading');
    }
  }
  assert.ok(model.userData.paintMaterials.length > 0, 'garage recoloring has a body paint target');
  assert.ok(model.userData.paintMaterials.every(m => m.isMeshPhysicalMaterial && !m.transparent));
  assert.ok(model.userData.headlightMaterials.length > 0 && model.userData.brakeLights.length > 0, 'authored lamps are connected');
  const tailLamps = Array.isArray(model.userData.brakeLights) ? model.userData.brakeLights : [model.userData.brakeLights];
  setHeadlightBulbs(model, 1);
  assert.ok(tailLamps.every(material => Math.abs(material.emissiveIntensity - .72) < 1e-9), 'headlights enable one-fifth-brightness tail lamps');
  setHeadlightBulbs(model, 0);
  assert.ok(tailLamps.every(material => Math.abs(material.emissiveIntensity - .3) < 1e-9), 'tail lamps return to their unlit resting level');
  if (id === 'prado') {
    const cover = model.getObjectByName('Object_72'), innerLens = model.getObjectByName('Object_114');
    assert.ok(cover.material.transparent && !cover.material.depthWrite && cover.material.opacity < .2, 'front covers reveal the authored headlight structure');
    assert.ok(innerLens.material.transparent && innerLens.material.opacity < .25, 'inner lenses do not obscure reflector bowls');
    assert.ok(!model.userData.headlightMaterials.includes(cover.material) && !model.userData.headlightMaterials.includes(innerLens.material), 'headlight switches illuminate bulbs rather than whole covers');
    assert.ok(model.getObjectByName('Object_42') && model.getObjectByName('Object_44'), 'authored reflector/projector meshes are retained');
    const mirror = model.getObjectByName('Object_68').material;
    const lowBulbs = model.getObjectByName('Object_62').material;
    const highBulbs = model.getObjectByName('Object_44').material;
    assert.notEqual(mirror, lowBulbs, 'mirror indicator lens does not share headlight emission');
    assert.ok(!model.userData.headlightMaterials.includes(mirror), 'L does not control mirror indicators');
    assert.ok(highBulbs.userData.highBeamOnly && model.userData.headlightMaterials.includes(highBulbs));
    for (const mode of [0, 1, 2, 1, 0]) {
      setHeadlightBulbs(model, mode);
      assert.equal(lowBulbs.emissiveIntensity > 0, mode > 0, 'low beam lights the first circle');
      assert.equal(highBulbs.emissiveIntensity > 0, mode === 2, 'high beam additionally lights the second circle');
      assert.equal(mirror.emissiveIntensity, 0, 'mirror indicators stay unlit in every headlight mode');
    }
    const highShader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    highBulbs.onBeforeCompile(highShader);
    assert.ok(highShader.fragmentShader.includes('totalEmissiveRadiance *= highBeamBulb') && highShader.fragmentShader.includes('bulbRadius'), 'emission is confined to circular bulbs within shared chrome trim');
    assert.equal(model.userData.reverseLightMaterials.length, 2, 'both clear reverse lens and its reflector respond');
    const red = model.userData.brakeLights[0], redColor = red.color.getHex(), redEmission = red.emissive.getHex();
    assert.ok(!model.userData.reverseLightMaterials.includes(red), 'reverse does not recolor the working red brake lenses');
    for (const material of model.userData.reverseLightMaterials) {
      const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
      material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.reverseLightLevel, material.userData.reverseLightLevel);
      assert.ok(shader.fragmentShader.includes('reverseBand * reverseLightLevel') && shader.fragmentShader.includes('abs(pradoLampPosition.x)'), 'only the two lower white lamp bands emit in reverse');
    }
    state.gear = 0; state.brakeForceInput = 1; animateCarModel(model, state, 1);
    assert.ok(model.userData.reverseLightMaterials.every(m => m.userData.reverseLightLevel.value > .99));
    assert.ok(red.emissiveIntensity > 3.59, 'braking and reverse illuminate independently');
    assert.equal(red.color.getHex(), redColor); assert.equal(red.emissive.getHex(), redEmission);
    state.gear = 1; state.brakeForceInput = 0; animateCarModel(model, state, 1);
    assert.ok(model.userData.reverseLightMaterials.every(m => m.userData.reverseLightLevel.value < .00001), 'leaving R extinguishes reverse lamps');
    assert.ok(Math.abs(red.emissiveIntensity - .3) < .00001, 'existing brake-light resting level is preserved');
  }
  if (id === 'amg') for (const [role, materials] of [['headlight', model.userData.headlightMaterials], ['brake', model.userData.brakeLights]]) {
    const shader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    materials[0].onBeforeCompile(shader);
    assert.ok(shader.fragmentShader.includes(`vehicleLampZ * ${role === 'headlight' ? '-1' : '1'}.0`), 'front/rear emission is masked on the shared AMG lamp meshes');
  }
  state.wheels.forEach((w, i) => { w.spinAngle = .3; w.steer = i < 2 ? .25 : 0; w.compression += .02; });
  animateCarModel(model, state, 1);
  model.userData.wheels.forEach(rig => {
    assert.equal(rig.spinPivot.rotation.x, -.3, 'authored rim spins with road travel');
    assert.ok(Math.abs(rig.steerPivot.position.y - rig.baseY - .02) < 1e-9, 'wheel follows its suspension');
    assert.ok(rig.front ? rig.steerPivot.rotation.y > .24 : rig.steerPivot.rotation.y === 0, 'only front wheels steer');
  });
  const run = (s, seconds, input = {}) => { for (let i = 0; i < seconds / dt; i++) stepDynamics(s, input, dt, settings); };
  const drive = createDynamicsState(0, settings);
  let steps = 0;
  while (drive.longitudinalSpeed < 100 / 3.6 && steps < 3600) { stepDynamics(drive, { throttle: 1 }, dt, settings); steps++; }
  assert.ok(steps < 3600 && drive.gear >= 3, `${id}: launches and shifts up to 100 km/h`);
  const brakeStart = drive.position.y;
  run(drive, 8, { brake: 1 });
  assert.ok(drive.position.y - brakeStart < 100 && drive.longitudinalSpeed < 1, `${id}: brakes to a stop`);
  const turn = createDynamicsState(0, settings); run(turn, 3, { throttle: 1, steer: .4 });
  assert.ok(turn.heading > .1 && Number.isFinite(turn.velocity.length()), `${id}: steering turns the chassis`);
  const reverse = createDynamicsState(0, settings); reverse.autoTransmission = false; reverse.gear = 0;
  run(reverse, 3, { throttle: 1 });
  assert.ok(reverse.longitudinalSpeed < -1 && reverse.wheels.every(w => w.omega < 0), `${id}: powered reverse follows the selected gear`);
  reports.push(`${id}: ${(steps * dt).toFixed(2)} s to 100 km/h, ${meshes(model).length} fitted mesh parts`);
}
console.log('Garage: supplied geometry, saved AMG fit, ground contact, shared wheels, normals, calipers, paint, low/high bulbs, unlit mirror indicators, reverse/brake lamps, suspension/steering/spin and forward/reverse/braking passed.');
console.log(reports.join('; '));
