import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLATE_GLYPHS, PLATE_GLYPH_METRICS } from './plateGlyphs.js';
import { PLATE_FORMATS, normalizePlateSettings, plateRegistration } from './licensePlateSettings.js';
import { PLATE_FITMENTS } from './licensePlateFitments.js';

const THICKNESS = .0011, EMBOSS = .0015;
const glyphCache = new Map();
let finishes;
function materials() {
  if (finishes) return finishes;
  const data = new Uint8Array(64 * 64 * 4); let seed = 599;
  for (let i = 0; i < data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = data[i + 1] = data[i + 2] = 115 + (seed % 25); data[i + 3] = 255;
  }
  const grain = new THREE.DataTexture(data, 64, 64); grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(12, 4); grain.magFilter = grain.minFilter = THREE.LinearFilter; grain.needsUpdate = true;
  const white = new THREE.MeshPhysicalMaterial({ name: 'AZ retroreflective white sheeting', color: 0xf0f0e9,
    metalness: .06, roughness: .36, clearcoat: .25, clearcoatRoughness: .32,
    bumpMap: grain, bumpScale: .000015, envMapIntensity: .65 });
  // Add a bounded retroreflective lobe to actual direct-light irradiance. It uses
  // the light's post-shadow colour and view/light alignment, never emission.
  white.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `
      #include <lights_physical_pars_fragment>
      void RE_Direct_AZ(const in IncidentLight light, const in vec3 p, const in vec3 n,
        const in vec3 v, const in vec3 cn, const in PhysicalMaterial m, inout ReflectedLight r) {
        RE_Direct_Physical(light, p, n, v, cn, m, r);
        float incidence = max(0.0, dot(n, light.direction));
        float alignment = pow(max(0.0, dot(v, light.direction)), 48.0);
        r.directDiffuse += light.color * m.diffuseColor * incidence * alignment * 0.45;
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_AZ
    `);
  };
  white.customProgramCacheKey = () => 'az-reflective-sheet-v1';
  finishes = {
    white,
    metal: new THREE.MeshStandardMaterial({ name: 'Pressed aluminium edges', color: 0xbac1c4, metalness: .84, roughness: .38 }),
    black: new THREE.MeshPhysicalMaterial({ name: 'Black stamped character enamel', color: 0x090b0d, metalness: .02, roughness: .57, clearcoat: .06 }),
    shoulder: new THREE.MeshStandardMaterial({ name: 'White enamel stamp shoulders', color: 0xc3c5c0, metalness: .24, roughness: .43 }),
    holder: new THREE.MeshStandardMaterial({ name: 'Vehicle plate carrier ABS', color: 0x17191b, metalness: .02, roughness: .78 }),
    bracket: new THREE.MeshStandardMaterial({ name: 'Galvanized mounting brackets', color: 0x484c50, metalness: .75, roughness: .52 }),
    seal: new THREE.MeshStandardMaterial({ name: 'RFID laminate', color: 0xe0e2df, metalness: .12, roughness: .48 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x00a3d6, roughness: .48 }),
    red: new THREE.MeshStandardMaterial({ color: 0xed2939, roughness: .48 }),
    green: new THREE.MeshStandardMaterial({ color: 0x009c57, roughness: .48 }),
    flagWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .48 }),
  };
  return finishes;
}
function rectangle(w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2), x = -w / 2, y = -h / 2;
  const s = new THREE.Shape(); s.moveTo(x + r, y); s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y); return s;
}
function ring(w, h, radius, line) {
  const s = rectangle(w, h, radius), hole = rectangle(w - line * 2, h - line * 2, Math.max(.001, radius - line));
  s.holes.push(hole); return s;
}
function extrusion(shape, depth, bevel = .0002) {
  return new THREE.ExtrudeGeometry(shape, { depth, steps: 1, curveSegments: 12,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3 });
}
function addMesh(group, geometry, material, name, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function glyphGeometry(character, w, h, raised = true) {
  // Preserve the DIN character's proportions. Forcing every contour into the
  // same box made the rounded digits wide and the registration look generic.
  w = Math.min(w, h * PLATE_GLYPH_METRICS[character].ratio);
  const key = `${character}:${w}:${h}:${raised}`;
  if (glyphCache.has(key)) return glyphCache.get(key);
  const path = new THREE.ShapePath();
  for (const [op, ...v] of PLATE_GLYPHS[character]) {
    const p = v.map((n, i) => n * (i % 2 ? h : w));
    if (op === 'm') path.moveTo(...p);
    else if (op === 'l') path.lineTo(...p);
    else if (op === 'q') path.quadraticCurveTo(...p);
    else if (op === 'c') path.bezierCurveTo(...p);
    else path.currentPath.closePath();
  }
  // Font contours may interleave holes and outlines (8: hole, outline, hole).
  // ShapePath's holes-first grouping drops holes after the final solid outline.
  // Put all solids first so every counter is assigned to its containing shape.
  const ccw = PLATE_GLYPH_METRICS[character].ccw, solids = [], holes = [];
  for (const contour of path.subPaths) {
    (THREE.ShapeUtils.isClockWise(contour.getPoints()) !== ccw ? solids : holes).push(contour);
  }
  path.subPaths = [...solids, ...holes];
  const shapes = path.toShapes(ccw);
  const g = raised ? new THREE.ExtrudeGeometry(shapes, { depth: .0004, bevelEnabled: true,
    bevelThickness: .00055, bevelSize: .00035, bevelSegments: 3, curveSegments: 12, steps: 1 })
    : new THREE.ShapeGeometry(shapes, 12);
  g.translate(-w / 2, -h / 2, raised ? .00055 : 0);
  // Keep tops/shoulders separate when batching; their materials differ.
  glyphCache.set(key, g); return g;
}
function characters(group, layout, settings) {
  const f = materials(), parts = [];
  const line = (text, positions, y, w, h) => {
    for (let i = 0; i < text.length; i++) {
      parts.push(glyphGeometry(text[i], w, h).clone().translate(positions[i], y, 0));
    }
  };
  if (layout === 'long') {
    line(settings.region, [-.1475, -.0955], 0, .045, .077);
    line(settings.letters, [-.0205, .0315], 0, .045, .077);
    line(settings.serial, [.1065, .1585, .2105], 0, .045, .077);
    if (settings.hyphens) line('--', [-.0585, .0695], -.001, .015, .010);
  } else {
    // AZS Type III: region on the top row; two letters + three digits below.
    // No hyphens on the compact plate. Its RFID label is at the upper right.
    line(settings.region, [-.0215, .0155], .033, .029, .050);
    line(settings.letters, [-.091, -.047], -.034, .036, .050);
    line(settings.serial, [.014, .051, .088], -.034, .029, .050);
  }
  // ExtrudeGeometry groups are per shape. Merge into two material batches.
  const batches = [[], []];
  for (const part of parts) {
    const positions = part.getAttribute('position'), normals = part.getAttribute('normal'), uv = part.getAttribute('uv');
    for (const category of [0, 1]) {
      const vertices = [], ns = [], uvs = [];
      for (const span of part.groups.filter(g => g.materialIndex === category)) {
        for (let i = span.start; i < span.start + span.count; i++) {
          vertices.push(positions.getX(i), positions.getY(i), positions.getZ(i));
          ns.push(normals.getX(i), normals.getY(i), normals.getZ(i)); uvs.push(uv.getX(i), uv.getY(i));
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      batches[category].push(g);
    }
    part.dispose();
  }
  batches.forEach((list, i) => { addMesh(group, mergeGeometries(list), i ? f.shoulder : f.black, i ? 'Stamped character shoulders' : 'Raised black registration'); list.forEach(g => g.dispose()); });
}
function identity(group, format, style) {
  const f = materials(), long = format === 'long', x = long ? -.214 : -.112;
  const flagY = long ? .0275 : .0485;
  // Printed enamel flag, with the crescent and eight-pointed star at plate scale.
  for (let stripe = 0; stripe < 3; stripe++) {
    addMesh(group, new THREE.PlaneGeometry(.042, .007), [f.blue, f.red, f.green][stripe],
      'Azerbaijani flag stripe', x, flagY + .007 - stripe * .007, .00008);
  }
  // Join the two intersecting circular arcs into one outline. An overlapping
  // circle used as a hole would extend outside the flag crescent's outer contour.
  const outerRadius = .0031, innerRadius = .00255, offset = .00105;
  const intersectionX = (outerRadius ** 2 - innerRadius ** 2 + offset ** 2) / (2 * offset);
  const intersectionY = Math.sqrt(outerRadius ** 2 - intersectionX ** 2);
  const outerAngle = Math.atan2(intersectionY, intersectionX);
  const innerAngle = Math.atan2(intersectionY, intersectionX - offset);
  const crescent = new THREE.Shape();
  crescent.absarc(0, 0, outerRadius, outerAngle, Math.PI * 2 - outerAngle, false);
  crescent.absarc(offset, 0, innerRadius, -innerAngle, innerAngle, true); crescent.closePath();
  addMesh(group, new THREE.ShapeGeometry(crescent, 24), f.flagWhite, 'Flag crescent', x - .0015, flagY, .0001);
  const star = new THREE.Shape();
  for (let i = 0; i < 16; i++) { const a = Math.PI / 2 + i * Math.PI / 8, r = i % 2 ? .00115 : .0022;
    const p = [Math.cos(a) * r, Math.sin(a) * r]; i ? star.lineTo(...p) : star.moveTo(...p); }
  star.closePath(); addMesh(group, new THREE.ShapeGeometry(star), f.flagWhite, 'Eight-pointed flag star', x + .004, flagY, .00011);
  const azY = long ? -.024 : .008;
  if (style === 'older') {
    const rx = long ? x : .109, ry = long ? -.022 : .032;
    addMesh(group, extrusion(rectangle(.058, .044, .009), .00035, .00015), f.seal, 'RFID laminate inset', rx, ry, .00006);
    addMesh(group, extrusion(ring(.054, .040, .008, .00055), .00015, .00007), f.metal, 'RFID rectangular perimeter', rx, ry, .0004);
    addMesh(group, extrusion(ring(.043, .030, .004, .0004), .00005, 0), f.shoulder, 'RFID inner window', rx, ry, .00043);
  }
  for (const [i, char] of [...'AZ'].entries()) addMesh(group, glyphGeometry(char, .018, .025, false), f.black, 'AZ country marking', x + (i ? .0105 : -.0105), azY, style === 'older' && long ? .0006 : .00013);
}
export function createAzerbaijaniPlate(value) {
  const settings = normalizePlateSettings(value), d = PLATE_FORMATS[settings.format], f = materials();
  const plate = new THREE.Group(); plate.name = `Azerbaijani registration ${plateRegistration(settings)}`;
  const shell = extrusion(rectangle(d.width - .0004, d.height - .0004, d.radius), THICKNESS, .0002);
  shell.translate(0, 0, -THICKNESS - .0002);
  addMesh(plate, shell, [f.white, f.metal], 'Pressed aluminium plate');
  const border = extrusion(ring(d.width - .006, d.height - .006, d.radius - .003, .003), .0008, .0004);
  addMesh(plate, border, [f.black, f.shoulder], 'Embossed plate border', 0, 0, .0004);
  characters(plate, settings.format, settings); identity(plate, settings.format, settings.identity);
  plate.userData = { settings, dimensions: { ...d }, thickness: THICKNESS, embossHeight: EMBOSS };
  return plate;
}
function pose(side, profile) {
  const sign = side === 'front' ? 1 : -1;
  const matrix = new THREE.Matrix4().makeBasis(new THREE.Vector3(-sign, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, sign, 0));
  const group = new THREE.Group(); group.quaternion.setFromRotationMatrix(matrix);
  group.rotateX(profile.pitch); group.position.set(...profile.position); return group;
}
function measureCarrier(vehicle, vehicleId, side, format) {
  const sideFit = PLATE_FITMENTS[vehicleId][side], profile = sideFit[format];
  // Fit against the untouched, neutral vehicle exactly once. Re-running this
  // world-space ray cast while a remote car is interpolating can produce a
  // different clearance result on another client for the same fixed mount.
  const rig = pose(side, profile);
  vehicle.add(rig); vehicle.updateMatrixWorld(true);
  const surfaces = []; vehicle.traverse(o => { if (o.isMesh && sideFit.surface.includes(o.name)) surfaces.push(o); });
  const ray = new THREE.Raycaster(); ray.near = 0; ray.far = .8;
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(rig.matrixWorld);
  const inverse = rig.matrixWorld.clone().invert();
  const contact = (x, y) => {
    const origin = new THREE.Vector3(x, y, .45).applyMatrix4(rig.matrixWorld);
    ray.set(origin, normal.clone().negate());
    const hit = ray.intersectObjects(surfaces, false)[0];
    return hit ? hit.point.clone().applyMatrix4(inverse).z : null;
  };
  // Sample the whole face to keep its rim outside curved bumper surfaces.
  // The anchors are separately sampled, producing supports that reach the body.
  const samples = [];
  for (const x of [-.48, -.24, 0, .24, .48]) for (const y of [-.46, 0, .46]) {
    const z = contact(x * profile.frame[0], y * profile.frame[1]); if (z !== null) samples.push(z);
  }
  // Measured local protrusions can lie between the regular face samples, such
  // as the AMG's small central trim wedge above its lowered long plate.
  for (const [x, y] of profile.clearancePoints ?? []) {
    const z = contact(x, y); if (z !== null) samples.push(z);
  }
  const anchorContacts = profile.anchors.map(([x, y]) => contact(x, y));
  const outward = Math.max(...samples, ...anchorContacts.filter(z => z !== null), samples.length ? -Infinity : 0) + .006;
  rig.removeFromParent();
  return { anchorContacts, surfaceSamples: samples.length, outward };
}
function carrier(vehicle, vehicleId, side, settings, calibration) {
  const sideFit = PLATE_FITMENTS[vehicleId][side], profile = sideFit[settings.format], f = materials();
  const rig = pose(side, profile); rig.name = `${vehicleId} ${side} ${settings.format} plate mounting`;
  vehicle.add(rig);
  const fitment = calibration ?? measureCarrier(vehicle, vehicleId, side, settings.format);
  const { anchorContacts, surfaceSamples, outward } = fitment;
  rig.position.add(new THREE.Vector3(0, 0, outward).applyQuaternion(rig.quaternion));
  const holder = extrusion(rectangle(...profile.frame, .013), .0035, .0004); holder.translate(0, 0, -.0052);
  addMesh(rig, holder, f.holder, `${sideFit.carrier} carrier`);
  // Two steel stand-offs connect the carrier to the actual sampled bumper.
  profile.anchors.forEach(([x, y], i) => {
    const z = anchorContacts[i] ?? 0;
    const length = Math.max(.002, outward - z - .004);
    addMesh(rig, new THREE.BoxGeometry(.024, .022, length), f.bracket, 'Bumper mounting stand-off', x, y, -.004 - length / 2);
    if (Math.abs(y) > profile.frame[1] / 2) {
      addMesh(rig, new THREE.BoxGeometry(.018, Math.abs(y) + .022, .0018), f.bracket, 'Bumper bridge fixing tab', x, y / 2, -.0052);
    }
  });
  const plate = createAzerbaijaniPlate(settings); rig.add(plate);
  const d = PLATE_FORMATS[settings.format];
  for (const x of [-1, 1]) {
    const sx = x * (settings.format === 'long' ? .180 : .105), sy = d.height / 2 - .007;
    const screw = new THREE.CylinderGeometry(.0025, .0025, .0012, 16); screw.rotateX(Math.PI / 2);
    addMesh(rig, screw, f.metal, 'Mounting screw', sx, sy, .00055);
    addMesh(rig, new THREE.BoxGeometry(.0032, .00065, .00015), f.black, 'Screw slot', sx, sy, .0012);
  }
  if (side === 'rear') {
    // Place each LED over its half of the registration plate and aim it
    // inward.  The broad, overlapping cones keep the outer characters as
    // legible as the centre instead of concentrating both beams on the middle.
    for (const sideSign of [-1, 1]) {
      const lamp = new THREE.SpotLight(0xeef3ff, vehicle.userData.plateLightsEnabled ? .009 : 0, .45, 1.26, .72, 2);
      lamp.name = 'Rear registration lamp';
      lamp.position.set(sideSign * d.width * .32, d.height / 2 + .018, .13);
      lamp.target.position.set(sideSign * d.width * .10, -d.height * .16, 0);
      rig.add(lamp, lamp.target);
    }
  }
  rig.userData.fitment = { vehicleId, side, format: settings.format, carrier: sideFit.carrier,
    anchorContacts, surfaceSamples, clearance: .006, outward };
  return rig;
}
function disposeRig(rig) {
  const shared = new Set(glyphCache.values());
  rig.traverse(o => { if (o.isMesh && !shared.has(o.geometry)) o.geometry.dispose(); });
  rig.removeFromParent();
}
export function installLicensePlates(vehicle, vehicleId, value) {
  if (!PLATE_FITMENTS[vehicleId]) throw new Error(`No individual Azerbaijani plate fitment for ${vehicleId}`);
  if (vehicle.userData.licensePlates) return updateLicensePlates(vehicle, value);
  for (const name of PLATE_FITMENTS[vehicleId].remove) {
    const supplied = vehicle.getObjectByName(name); if (supplied) supplied.visible = false;
  }
  vehicle.updateMatrixWorld(true);
  for (const area of PLATE_FITMENTS[vehicleId].removeFaces ?? []) {
    const mesh = vehicle.getObjectByName(area.mesh); if (!mesh) continue;
    const positions = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    const box = new THREE.Box3(new THREE.Vector3(...area.min), new THREE.Vector3(...area.max));
    const toCar = vehicle.matrixWorld.clone().invert().multiply(mesh.matrixWorld), point = new THREE.Vector3();
    const keep = []; let removed = 0;
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const vertices = [0, 1, 2].map(n => index ? index.getX(i + n) : i + n);
      if (vertices.every(v => box.containsPoint(point.fromBufferAttribute(positions, v).applyMatrix4(toCar)))) removed++;
      else keep.push(...vertices);
    }
    mesh.geometry.setIndex(keep); mesh.geometry.clearGroups();
    mesh.geometry.userData.removedPlateHardwareTriangles = removed;
  }
  // These are fixed mechanical mount measurements, not customisation data.
  // Cache every format while the factory model is at its neutral transform so
  // owners and remote observers always use the exact same plate pose.
  const calibrations = {};
  for (const side of ['front', 'rear']) {
    calibrations[side] = {};
    for (const format of Object.keys(PLATE_FORMATS)) {
      calibrations[side][format] = measureCarrier(vehicle, vehicleId, side, format);
    }
  }
  vehicle.userData.licensePlates = { vehicleId, rigs: [], settings: null, calibrations };
  return updateLicensePlates(vehicle, value);
}
export function setLicensePlateLighting(vehicle, enabled) {
  vehicle.userData.plateLightsEnabled = enabled;
  for (const rig of vehicle.userData.licensePlates?.rigs ?? []) rig.traverse(o => {
    if (o.name === 'Rear registration lamp') o.intensity = enabled ? .012 : 0;
  });
}
export function updateLicensePlates(vehicle, value) {
  const state = vehicle.userData.licensePlates;
  if (!state) throw new Error('Install individual plate fitments before updating');
  const settings = normalizePlateSettings(value), previous = state.settings;
  if (previous && ['region', 'letters', 'serial', 'hyphens', 'format', 'identity'].every(k => previous[k] === settings[k])) {
    state.settings = settings; state.rigs.forEach(rig => { rig.visible = settings.enabled; }); return state;
  }
  state.rigs.forEach(disposeRig);
  state.rigs = ['front', 'rear'].map(side => carrier(vehicle, state.vehicleId, side, settings,
    state.calibrations?.[side]?.[settings.format]));
  state.settings = settings; state.rigs.forEach(rig => { rig.visible = settings.enabled; }); return state;
}
