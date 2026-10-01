import * as THREE from 'three';
import { repairMissingNormals } from './elantraModel.js';

// Bake the export transforms before fitting. Both supplied bodies are Y-up and
// nose +Z; the existing animation rig is Y-up/nose -Z inside a Z-up car group.
function bakedMeshes(source, include = () => true) {
  source.updateMatrixWorld(true);
  const meshes = [];
  source.traverse(object => {
    if (!object.isMesh || !include(object)) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    else repairMissingNormals(geometry);
    meshes.push({ object, geometry });
  });
  return meshes;
}

function finishMaterial(source, role, paints, headlights, brakes, reverse, settings, scale, bodyCenter) {
  if (role === 'paint') {
    const material = new THREE.MeshPhysicalMaterial({
      name: source.name, color: source.color, map: source.map,
      normalMap: source.normalMap, metalness: .5, roughness: .28,
      clearcoat: .85, clearcoatRoughness: .16, envMapIntensity: .75,
      side: source.side,
    });
    paints.push(material); return material;
  }
  const material = source.clone();
  if (role === 'glass' || role === 'reverse-cover' || role === 'mirror-indicator') {
    material.metalness = .05; material.roughness = .14;
    material.transparent = true; material.depthWrite = false;
    material.opacity = Math.min(material.opacity, .65);
    material.envMapIntensity = .65;
    // Use the same inexpensive transparent-glass approach as the existing cars.
    if (material.isMeshPhysicalMaterial) material.transmission = 0;
    if (role === 'mirror-indicator') material.emissiveIntensity = 0;
  } else if (role === 'headlight-cover' || role === 'headlight-inner-lens') {
    // The authored chrome bowls/projectors are behind these lens meshes.
    // Keep the covers clear and unlit rather than filling the whole lamp white.
    material.color.setHex(0xd5e0e7); material.metalness = .02;
    material.roughness = .08; material.transparent = true;
    material.opacity = role === 'headlight-cover' ? .14 : .22;
    material.depthWrite = false; material.side = THREE.FrontSide;
    material.envMapIntensity = .55; material.emissiveIntensity = 0;
    if (material.isMeshPhysicalMaterial) material.transmission = 0;
  } else if (role === 'rubber') {
    material.color.setHex(0x171a1d); material.metalness = 0; material.roughness = .94; material.envMapIntensity = .12;
  } else if (role === 'chrome' || role === 'rim' || role === 'reverse-reflector' || role === 'high-beam-bulb') {
    material.metalness = .82; material.roughness = role === 'rim' ? .3 : .22; material.envMapIntensity = .65;
    if (role === 'rim') material.color.setHex(0x777e85);
  } else {
    material.metalness = Math.min(material.metalness, .15);
    material.roughness = Math.max(material.roughness, .55);
  }
  if (role === 'high-beam-bulb') {
    // Object_44 also contains other chrome trim. Illuminate only the two
    // larger, outer circular bulbs, leaving their reflector detail intact.
    const height = settings.modelFit.bodyHeightOffset;
    const offset = settings.modelFit.bodyLongitudinalOffset;
    material.emissive.setHex(0xe8f4ff); material.emissiveIntensity = 0;
    material.userData.headlightScale = .7;
    material.userData.highBeamOnly = true;
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 pradoHighBeamPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\npradoHighBeamPosition = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 pradoHighBeamPosition;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float bulbRadius = length(vec2(abs(pradoHighBeamPosition.x) - ${.78619 * scale},
            pradoHighBeamPosition.y - ${1.10809 * scale + height}));
          float highBeamBulb = (1.0 - smoothstep(${.076 * scale}, ${.080 * scale}, bulbRadius))
            * step(${(bodyCenter.z - 2.08) * scale + offset}, pradoHighBeamPosition.z)
            * step(pradoHighBeamPosition.z, ${(bodyCenter.z - 1.98) * scale + offset});
          totalEmissiveRadiance *= highBeamBulb;
        `);
    };
    material.customProgramCacheKey = () => 'prado-high-beam-bulbs';
    headlights.push(material);
  }
  if (role === 'headlight' || role === 'brake' || role === 'reverse') {
    material.metalness = .08; material.roughness = .2;
    material.transparent = false; material.depthWrite = true;
    if (settings.id === 'prado' && role === 'headlight') {
      // Match the larger chrome bulb when unlit, including full opacity.
      material.metalness = .82; material.roughness = .22;
      material.envMapIntensity = .65; material.opacity = 1;
    }
    material.emissive.setHex(role === 'brake' ? 0xf31912 : 0xe8f4ff);
    material.emissiveIntensity = role === 'brake' ? .3 : 0;
    if (role === 'headlight') { material.userData.headlightScale = .7; headlights.push(material); }
    if (role === 'brake') brakes.push(material);
    if (role === 'reverse') reverse.push(material);
    // The AMG exporter combines front and rear bulbs in shared meshes.
    // Gate their emission by fitted body position so braking cannot light the nose.
    if (settings.id === 'amg' && role !== 'reverse') {
      const direction = role === 'headlight' ? -1 : 1;
      material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vehicleLampZ;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvehicleLampZ = position.z;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vehicleLampZ;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= step(${settings.dims.length * .3}, vehicleLampZ * ${direction}.0);`);
      };
      material.customProgramCacheKey = () => `amg-lamp-${role}`;
    }
  }
  if (role === 'reverse-cover' || role === 'reverse-reflector') {
    // Source inspection locates the two reverse bulbs below the amber sections
    // at Y=1.15..1.20. Only this clear band emits; red brake lenses are untouched.
    const level = { value: 0 }, height = settings.modelFit.bodyHeightOffset;
    material.userData.reverseLightLevel = level;
    material.onBeforeCompile = shader => {
      shader.uniforms.reverseLightLevel = level;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 pradoLampPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\npradoLampPosition = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 pradoLampPosition;\nuniform float reverseLightLevel;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float reverseBand = smoothstep(${1.14 * scale + height}, ${1.15 * scale + height}, pradoLampPosition.y)
            * (1.0 - smoothstep(${1.198 * scale + height}, ${1.208 * scale + height}, pradoLampPosition.y))
            * step(${.74 * scale}, abs(pradoLampPosition.x)) * step(${2 * scale}, pradoLampPosition.z);
          totalEmissiveRadiance += vec3(2.4, 2.75, 3.1) * reverseBand * reverseLightLevel;
        `);
    };
    material.customProgramCacheKey = () => `prado-reverse-${role}`;
    reverse.push(material);
  }
  return material;
}

function materialRole(name, vehicleId, objectName) {
  if (vehicleId === 'prado') {
    if (objectName === 'Object_68' && name === 'Car_front_glass') return 'mirror-indicator';
    if (objectName === 'Object_44' && name === 'Car_chrome') return 'high-beam-bulb';
    if (objectName === 'Object_72' && name === 'Car_front_glass') return 'headlight-cover';
    if (objectName === 'Object_114' && name === 'Car_Glass_all') return 'headlight-inner-lens';
    if (objectName === 'Object_74' && name === 'Car_Glass_all') return 'reverse-cover';
    if (objectName === 'Object_46' && name === 'Car_Chrome_int') return 'reverse-reflector';
  }
  if ((vehicleId === 'amg' && name === 'body') || name === 'Car_paint') return 'paint';
  if (/tyre|tires/i.test(name)) return 'rubber';
  if (/rim|silver/i.test(name)) return 'rim';
  if (/chrome|metallic/i.test(name)) return 'chrome';
  if (name === 'bulb_red' || name === 'Car_Back_glass') return 'brake';
  if (name === 'bulb' || name === 'Car_front_glass') return 'headlight';
  if (name === 'rear_bulb') return 'reverse';
  if (/glass/i.test(name)) return 'glass';
  return 'trim';
}

export function createImportedVehicle(bodySource, wheelSource, settings) {
  const vehicle = new THREE.Group(); vehicle.name = settings.name; vehicle.rotation.order = 'ZXY';
  const visual = new THREE.Group(); visual.rotation.x = Math.PI / 2; vehicle.add(visual);
  const paints = [], headlights = [], brakes = [], reverse = [];
  const materials = new Map();
  const body = new THREE.Group(); body.name = `${settings.id} supplied body`; visual.add(body);
  const adjustments = settings.modelFit.adjustments ?? {};
  body.position.set(0, adjustments.bodyHeight ?? 0, adjustments.bodyLongitudinalOffset ?? 0);
  const parts = bakedMeshes(bodySource), bodyBounds = new THREE.Box3();
  for (const { geometry } of parts) { geometry.computeBoundingBox(); bodyBounds.union(geometry.boundingBox); }
  const bodySize = bodyBounds.getSize(new THREE.Vector3()), bodyCenter = bodyBounds.getCenter(new THREE.Vector3());
  if (!Number.isFinite(bodySize.z) || bodySize.z <= 0) throw new Error(`${settings.id}: body geometry is missing`);
  const scale = settings.dims.length / bodySize.z;
  const finish = (source, object) => {
    const role = materialRole(source.name, settings.id, object.name);
    if (!materials.has(source)) materials.set(source, new Map());
    const variants = materials.get(source);
    if (!variants.has(role)) variants.set(role, finishMaterial(source, role, paints, headlights, brakes, reverse, settings, scale, bodyCenter));
    return variants.get(role);
  };
  for (const { object, geometry } of parts) {
    geometry.translate(-bodyCenter.x, 0, -bodyCenter.z).rotateY(Math.PI).scale(scale, scale, scale);
    geometry.translate(0, settings.modelFit.bodyHeightOffset, settings.modelFit.bodyLongitudinalOffset);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, Array.isArray(object.material) ? object.material.map(m => finish(m, object)) : finish(object.material, object));
    mesh.name = object.name;
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.castShadow = !meshMaterials.every(m => m.transparent); mesh.receiveShadow = true;
    body.add(mesh);
  }

  const template = new THREE.Group(); template.name = `${settings.id} supplied wheel`;
  // AMG_WHEEL contains wheel1..wheel4 in exactly the same exported position.
  // Select one authored assembly rather than superimposing four copies per axle.
  const wheelParts = bakedMeshes(wheelSource, object => settings.id !== 'amg' || /^wheel1_/i.test(object.name));
  const wheelBounds = new THREE.Box3();
  for (const { geometry } of wheelParts) { geometry.computeBoundingBox(); wheelBounds.union(geometry.boundingBox); }
  const wheelSize = wheelBounds.getSize(new THREE.Vector3()), center = wheelBounds.getCenter(new THREE.Vector3());
  if (!Number.isFinite(wheelSize.y) || wheelSize.y <= 0) throw new Error(`${settings.id}: wheel geometry is missing`);
  const wheelScale = settings.wheelRadius * 2 / Math.max(wheelSize.y, wheelSize.z);
  const stationary = new THREE.Group(); stationary.name = `${settings.id} stationary caliper`;
  for (const { object, geometry } of wheelParts) {
    geometry.translate(-center.x, -center.y, -center.z).scale(wheelScale, wheelScale, wheelScale);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, Array.isArray(object.material) ? object.material.map(m => finish(m, object)) : finish(object.material, object));
    mesh.name = object.name; mesh.castShadow = mesh.receiveShadow = true;
    // This is the Prado wheel's off-axis brake caliper, not a rotating spoke.
    (settings.id === 'prado' && object.name === 'Object_164' ? stationary : template).add(mesh);
  }
  const wheels = [];
  for (let index = 0; index < 4; index++) {
    const front = index < 2, side = index % 2 ? 1 : -1;
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.name = `${settings.id} axle ${index}`;
    pivot.position.set(side * (adjustments.trackM ?? settings.trackM) / 2, settings.wheelRadius, (front ? -1 : 1) * (adjustments.wheelbaseM ?? settings.wheelbaseM) / 2);
    const wheel = template.clone(), caliper = stationary.clone();
    // Both supplied rim faces point -X. Turn the right copy without mirroring normals.
    if (side > 0) { wheel.rotation.y = Math.PI; caliper.rotation.y = Math.PI; }
    spin.add(wheel); pivot.add(spin, caliper); visual.add(pivot);
    wheels.push({ steerPivot: pivot, spinPivot: spin, front, physicsIndex: index, baseY: pivot.position.y, spinDirection: -1 });
  }
  vehicle.userData.wheels = wheels;
  vehicle.userData.paintMaterials = paints;
  vehicle.userData.headlightMaterials = headlights;
  vehicle.userData.brakeLights = brakes;
  vehicle.userData.reverseLightMaterials = reverse;
  vehicle.userData.modelScale = scale;
  return vehicle;
}

export async function loadImportedVehicle(settings, loader) {
  const [body, wheel] = await Promise.all([loader(settings.asset), loader(settings.wheelAsset)]);
  const vehicle = createImportedVehicle(body.scene, wheel.scene, settings);
  const geometries = new Set(), materials = new Set();
  for (const source of [body.scene, wheel.scene]) source.traverse(mesh => {
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  return vehicle;
}
