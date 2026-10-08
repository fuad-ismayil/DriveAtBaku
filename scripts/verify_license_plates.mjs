import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { draco } from './lib/headlessDraco.mjs';
import { createCarModel, setHeadlightBulbs } from '../src/carModel.js';
import { createImportedVehicle } from '../src/importedVehicleModel.js';
import { createElantraModel } from '../src/elantraModel.js';
import { prepareElantraWheel } from '../src/elantraWheel.js';
import { VEHICLES } from '../src/vehicleCatalog.js';
import { PLATE_FITMENTS } from '../src/licensePlateFitments.js';
import { PLATE_LETTERS, PLATE_FORMATS, normalizePlateSettings, readPlateSettings, savePlateSettings, plateRegistration } from '../src/licensePlateSettings.js';
import { createAzerbaijaniPlate, updateLicensePlates } from '../src/licensePlates.js';

assert.equal(plateRegistration({}), '10-AA-001');
assert.equal(plateRegistration({ format: 'compact', hyphens: true }), '10 AA 001');
assert.equal(plateRegistration({ hyphens: false }), '10 AA 001');
assert.deepEqual(normalizePlateSettings({ region: '7', letters: 'az', serial: '9' }), { enabled: true, region: '07', letters: 'AZ', serial: '009', hyphens: true, format: 'long', identity: 'older' });
assert.equal(plateRegistration({ identity: 'new', hyphens: true }), '10 AA 001', 'new style always omits hyphens');
assert.equal(readPlateSettings({ getItem: () => JSON.stringify({ identity: 'modern' }) }, 'amg').identity, 'older', 'saved RFID style migrates');
assert.equal(readPlateSettings({ getItem: () => JSON.stringify({ identity: 'classic' }) }, 'amg').identity, 'new', 'saved plain AZ style migrates');
for (const bad of [null, 5, '', { region: '00', serial: '000', letters: 'IW', format: 'usa', identity: 'fiction' }]) {
  const s = normalizePlateSettings(bad); assert.match(s.region, /^\d{2}$/); assert.ok(Number(s.region) > 0);
  assert.match(s.serial, /^\d{3}$/); assert.ok(Number(s.serial) > 0); assert.ok([...s.letters].every(c => PLATE_LETTERS.includes(c)));
  assert.ok(Object.hasOwn(PLATE_FORMATS, s.format));
}
const stored = new Map(), storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
savePlateSettings(storage, 'ferrari', { region: '77', letters: 'XZ', serial: '777', enabled: false, format: 'compact' });
assert.equal(readPlateSettings(storage, 'ferrari').serial, '777'); assert.equal(readPlateSettings(storage, 'amg').serial, '001');
stored.set('baku-plate-amg', '{broken'); assert.equal(readPlateSettings(storage, 'amg').region, '10');
assert.equal(readPlateSettings({ getItem() { throw Error('unavailable'); } }, 'prado').letters, 'AA');

for (const format of Object.keys(PLATE_FORMATS)) for (const identity of ['older', 'new']) {
  const plate = createAzerbaijaniPlate({ format, identity, region: '90', letters: 'XY', serial: '987' });
  const glyph = plate.getObjectByName('Raised black registration'), shoulder = plate.getObjectByName('Stamped character shoulders');
  shoulder.geometry.computeBoundingBox();
  assert.ok(Math.abs(shoulder.geometry.boundingBox.max.z - .0015) < 1e-7, 'characters have real 1.5 mm geometry');
  assert.ok(shoulder.geometry.getAttribute('position').count > 100, 'stamp bevels are geometry');
  const shell = plate.getObjectByName('Pressed aluminium plate'); shell.geometry.computeBoundingBox();
  const d = PLATE_FORMATS[format], bounds = shell.geometry.boundingBox;
  assert.ok(Math.abs(bounds.max.x - bounds.min.x - d.width) < 1e-6);
  assert.ok(Math.abs(bounds.max.y - bounds.min.y - d.height) < 1e-6);
  assert.ok(bounds.max.z - bounds.min.z < .002 && bounds.min.z < -.001, 'subtle sheet-metal thickness');
  assert.ok(plate.getObjectByName('Embossed plate border')); assert.ok(plate.getObjectByName('Eight-pointed flag star'));
  assert.equal(Boolean(plate.getObjectByName('RFID laminate inset')), identity === 'older');
  for (const stripe of plate.children.filter(o => o.name === 'Azerbaijani flag stripe')) {
    assert.equal(stripe.geometry.getAttribute('position').count, 4, 'both plate ages use a straight rectangular flag');
  }
  assert.equal(shell.material[0].emissiveIntensity, 1); assert.equal(shell.material[0].emissive.getHex(), 0, 'reflective sheeting never glows');
  const shader = { fragmentShader: '#include <lights_physical_pars_fragment>' }; shell.material[0].onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('RE_Direct_Physical(light') && shader.fragmentShader.includes('light.color'), 'retroreflection uses shadowed direct illumination');
  assert.ok(!shader.fragmentShader.includes('totalEmissiveRadiance'));
  assert.ok(glyph.castShadow && glyph.receiveShadow);
  plate.traverse(o => { if (!o.isMesh) return; const p = o.geometry.getAttribute('position'), n = o.geometry.getAttribute('normal');
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i) + n.getX(i) + n.getY(i) + n.getZ(i)), 'finite stamped geometry');
  });
}
// A's white counter must survive both flat AZ printing and real embossing.
// Cast through the counter and then through its crossbar as a positive control.
for (const format of ['long', 'compact']) for (const identity of ['older', 'new']) {
  const plate = createAzerbaijaniPlate({ format, identity, letters: 'AA' }); plate.updateMatrixWorld(true);
  const azA = plate.children.find(o => o.name === 'AZ country marking');
  const ray = new THREE.Raycaster();
  const hit = (mesh, x, y) => {
    ray.set(mesh.localToWorld(new THREE.Vector3(x, y, .02)), new THREE.Vector3(0, 0, -1));
    return ray.intersectObject(mesh, false).length;
  };
  assert.equal(hit(azA, 0, .025 * (.48 - .5)), 0, 'AZ A has an open inner counter');
  assert.ok(hit(azA, 0, .025 * (.30 - .5)) > 0, 'AZ A retains its black crossbar');
  const ink = plate.getObjectByName('Raised black registration'), h = format === 'long' ? .077 : .050;
  const x = format === 'long' ? -.0205 : -.091, y = format === 'long' ? 0 : -.034;
  assert.equal(hit(ink, x, y + h * (.48 - .5)), 0, 'stamped A has an open inner counter');
  assert.ok(hit(ink, x, y + h * (.30 - .5)) > 0, 'stamped A retains its crossbar');
}
// Eight has two white counters. Verify both openings and the solid waist at
// every numeric position, on both the enamel tops and the pressed shoulders.
for (const format of ['long', 'compact']) for (const identity of ['older', 'new']) {
  const plate = createAzerbaijaniPlate({ format, identity, region: '88', serial: '888' }); plate.updateMatrixWorld(true);
  const h = format === 'long' ? .077 : .050;
  const digits = format === 'long' ? [-.1475, -.0955, .1065, .1585, .2105].map(x => [x, 0])
    : [[-.0215, .033], [.0155, .033], [.014, -.034], [.051, -.034], [.088, -.034]];
  const ray = new THREE.Raycaster();
  for (const name of ['Raised black registration', 'Stamped character shoulders']) {
    const mesh = plate.getObjectByName(name);
    const hit = (x, y) => {
      ray.set(mesh.localToWorld(new THREE.Vector3(x, y, .02)), new THREE.Vector3(0, 0, -1));
      return ray.intersectObject(mesh, false).length;
    };
    for (const [x, y] of digits) {
      assert.equal(hit(x, y + h * (.28 - .5)), 0, `${format} ${name}: eight's lower counter stays open`);
      assert.equal(hit(x, y + h * (.72 - .5)), 0, `${format} ${name}: eight's upper counter stays open`);
      // The shoulders contain bevels/sides only; the solid front cap is enamel.
      if (name === 'Raised black registration') assert.ok(hit(x, y + h * (.515 - .5)) > 0, `${format}: eight retains its solid waist`);
    }
  }
}
// Decode the actual supplied Ferrari/AMG/Prado and Elantra geometry, including
// the shipped Draco binary, without relying on browser-only image decoders.
const loader = new GLTFLoader().setDRACOLoader(draco).register(() => ({ name: 'headless-images', loadTexture: () => Promise.resolve(null) }));
async function load(asset) { const b = readFileSync(new URL(`../public${asset}`, import.meta.url)); return (await loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene; }
const reports = [];
for (const id of Object.keys(VEHICLES)) {
  const s = VEHICLES[id];
  const car = id === 'ferrari' ? createCarModel({ scene: await load(s.asset) })
    : id === 'elantra' ? createElantraModel(JSON.parse(gunzipSync(readFileSync(new URL(`../public${s.asset}`, import.meta.url)))), prepareElantraWheel(await load('/assets/vehicles/elantra-wheel.glb')))
    : createImportedVehicle(await load(s.asset), await load(s.wheelAsset), s);
  for (const name of PLATE_FITMENTS[id].remove) assert.equal(car.getObjectByName(name).visible, false, 'supplied foreign/branded plates never render');
  for (const area of PLATE_FITMENTS[id].removeFaces ?? []) assert.ok(car.getObjectByName(area.mesh).geometry.userData.removedPlateHardwareTriangles > 0, 'old holder is removed from its shared mesh');
  for (const format of ['long', 'compact']) {
    updateLicensePlates(car, { format }); car.updateMatrixWorld(true);
    const state = car.userData.licensePlates;
    for (const [index, rig] of state.rigs.entries()) {
      const side = index ? 'rear' : 'front', fit = rig.userData.fitment;
      assert.ok(fit.surfaceSamples > 0, `${id} ${side} ${format}: face samples hit actual bumper`);
      assert.ok(fit.anchorContacts.every(x => x !== null && Number.isFinite(x)), `${id} ${side} ${format}: both mounting brackets contact actual body`);
      assert.ok(Math.max(...fit.anchorContacts.map(z => fit.outward - z)) < .09, `${id} ${side}: realistic bracket depth`);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.quaternion);
      assert.ok((index ? -1 : 1) * normal.y > .98, 'front/rear faces point outward');
      const surfaces = []; car.traverse(o => { if (o.isMesh && o.visible && !o.parent.name.includes('plate') && !o.name.includes('plate') && !o.name.includes('Stamp') && !o.name.includes('registration') && !o.name.includes('Mounting') && !o.name.includes('Bumper mounting') && !o.name.includes('Screw')) {
        let p = o.parent, plate = false; while (p && p !== car) { if (state.rigs.includes(p)) plate = true; p = p.parent; } if (!plate) surfaces.push(o);
      } });
      const ray = new THREE.Raycaster(); ray.far = .6;
      for (const x of [-.45, -.30, -.15, 0, .15, .30, .45]) for (const y of [-.43, -.28, -.14, 0, .14, .28, .43]) {
        const origin = new THREE.Vector3(x * PLATE_FORMATS[format].width, y * PLATE_FORMATS[format].height, .20).applyMatrix4(rig.matrixWorld);
        ray.set(origin, normal.clone().negate()); const hit = ray.intersectObjects(surfaces, false)[0];
        if (hit) assert.ok(hit.distance > .198, `${id} ${side} ${format}: plate face is outside ${hit.object.name} at ${x}, ${y} (${hit.distance})`);
      }
      reports.push(`${id} ${side} ${format}: ${fit.surfaceSamples} surface samples, two connected anchors`);
    }
    const poses = state.rigs.map(rig => rig.position.clone());
    updateLicensePlates(car, { format, enabled: false }); assert.ok(state.rigs.every(rig => !rig.visible));
    updateLicensePlates(car, { format, enabled: true }); assert.ok(state.rigs.every(rig => rig.visible));
    assert.ok(state.rigs.every((rig, i) => rig.position.equals(poses[i])), 'ON/OFF preserves fitted geometry');
    for (const mode of [1, 2, 0]) {
      setHeadlightBulbs(car, mode);
      const lamps = []; state.rigs[1].traverse(o => { if (o.name === 'Rear registration lamp') lamps.push(o); });
      assert.equal(lamps.length, 2); assert.ok(lamps.every(l => (l.intensity > 0) === (mode > 0)), 'rear registration lamps follow driving lights');
      if (mode > 0) {
        const [left, right] = lamps;
        assert.ok(left.position.x * right.position.x < 0, 'registration LEDs straddle the plate centre');
        assert.ok(Math.abs(left.position.x) > PLATE_FORMATS[format].width * .25, 'registration LEDs reach toward both plate edges');
        assert.ok(Math.abs(left.target.position.x) < Math.abs(left.position.x), 'each registration LED aims inward for overlapping full-width coverage');
      }
    }
  }
  // A number/format edit while driving/paused must stay attached to a moved,
  // rotated car rather than taking measurements in the wrong coordinate frame.
  updateLicensePlates(car, { format: 'long', serial: '123', letters: 'BC', identity: 'new' });
  const localPlatePositions = car.userData.licensePlates.rigs.map(rig => rig.position.clone());
  car.position.set(200, -75, 2); car.rotation.set(.04, -.03, 1.2);
  updateLicensePlates(car, { format: 'long', serial: '456', letters: 'CD', identity: 'new' });
  assert.ok(car.userData.licensePlates.rigs.every(r => r.userData.fitment.anchorContacts.every(x => x !== null)));
  assert.ok(car.userData.licensePlates.rigs.every((rig, index) => rig.position.distanceTo(localPlatePositions[index]) < 1e-8),
    `${id}: plate mounts retain their vehicle-local pose after a multiplayer position update`);
}
console.log(reports.join('\n'));
console.log('Passed: Azerbaijani groups, saved-style migration, per-car persistence, both real plate sizes, open A and both 8 counters, older/new identity, straight flags, non-emissive retroreflection, every car/side/format fit, bumper clearance, connected anchors, ON/OFF, and moved-car edits.');
