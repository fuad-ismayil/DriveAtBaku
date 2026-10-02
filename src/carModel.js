import * as THREE from 'three';
import { installLicensePlates, setLicensePlateLighting } from './licensePlates.js';

export function setHeadlightBulbs(vehicle, mode) {
  setLicensePlateLighting(vehicle, mode > 0);
  for (const material of vehicle.userData.headlightMaterials ?? []) {
    const enabled = mode > 0 && (!material.userData.highBeamOnly || mode === 2);
    material.emissiveIntensity = enabled ? (mode === 1 ? 3.2 : 5.2)
      * (material.userData.headlightScale ?? 1) : 0;
  }
}

export function createCarModel(gltf) {
  const vehicle = new THREE.Group();
  vehicle.rotation.order = 'ZXY';
  const visual = gltf.scene;
  visual.rotation.x = Math.PI / 2; // model Y-up/front -Z -> world Z-up/front +Y
  vehicle.add(visual);

  const body = visual.getObjectByName('body');
  if (body) {
    body.material = new THREE.MeshPhysicalMaterial({
      color: 0xa80719, metalness: 0.42, roughness: 0.28,
      clearcoat: 1, clearcoatRoughness: 0.19,
    });
    vehicle.userData.paintMaterials = [body.material];
  }
  const glass = visual.getObjectByName('glass');
  if (glass) {
    const originalGeometry = glass.geometry;
    const position = originalGeometry.getAttribute('position');
    const index = originalGeometry.getIndex();
    const windows = [], headlightCovers = [];
    const triangleCount = (index?.count ?? position.count) / 3;
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const vertices = [0, 1, 2].map(offset => index ? index.getX(triangle * 3 + offset) : triangle * 3 + offset);
      const x = vertices.reduce((sum, vertex) => sum + position.getX(vertex), 0) / 3;
      const y = vertices.reduce((sum, vertex) => sum + position.getY(vertex), 0) / 3;
      (x < -1.35 && Math.abs(y) > 0.36 ? headlightCovers : windows).push(...vertices);
    }
    glass.geometry = originalGeometry.clone();
    glass.geometry.setIndex(windows);
    glass.geometry.clearGroups();
    const coverGeometry = originalGeometry.clone();
    coverGeometry.setIndex(headlightCovers);
    coverGeometry.clearGroups();
    const covers = new THREE.Mesh(coverGeometry, new THREE.MeshPhysicalMaterial({
      color: 0xa6bac7, metalness: 0.08, roughness: 0.12,
      clearcoat: 1, clearcoatRoughness: 0.06,
      emissive: 0xeaf5ff, emissiveIntensity: 0,
      transparent: true, opacity: 0.52, depthWrite: false, side: THREE.FrontSide,
    }));
    covers.name = 'headlight_covers';
    covers.material.userData.headlightScale = 0.25;
    (vehicle.userData.headlightMaterials ??= []).push(covers.material);
    glass.add(covers);
    glass.material = new THREE.MeshPhysicalMaterial({
      color: 0x17242c, metalness: 0.08, roughness: 0.13,
      transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  const rearLights = visual.getObjectByName('lights_red');
  if (rearLights) {
    rearLights.material = new THREE.MeshStandardMaterial({
      color: 0xae1620, emissive: 0xff1722, emissiveIntensity: 0.3,
      roughness: 0.28, side: THREE.DoubleSide, toneMapped: false,
    });
    vehicle.userData.brakeLights = rearLights.material;
    const reverseLightLevel = { value: 0 };
    rearLights.material.userData.reverseLightLevel = reverseLightLevel;
    rearLights.material.onBeforeCompile = shader => {
      shader.uniforms.reverseLightLevel = reverseLightLevel;
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float reverseLightLevel;\nvoid main() {')
        .replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.91, 1.0), reverseLightLevel);
          totalEmissiveRadiance += vec3(2.6, 2.9, 3.3) * reverseLightLevel;
        `);
    };
    vehicle.userData.reverseLightMaterials = [rearLights.material];
  }
  // The supplied Ferrari exports its circular red lenses as "brakes",
  // separately from "lights_red" (the smaller markers/reflectors).
  const circularRearLights = visual.getObjectByName('brakes');
  if (circularRearLights?.isMesh) {
    circularRearLights.material = new THREE.MeshStandardMaterial({
      color: 0xae1620, emissive: 0xff1722, emissiveIntensity: 0.3,
      roughness: 0.28, side: THREE.DoubleSide, toneMapped: false,
    });
    vehicle.userData.brakeLights = [
      ...(rearLights ? [rearLights.material] : []), circularRearLights.material,
    ];
  }
  const projector = visual.getObjectByName('lights');
  if (projector) {
    projector.material = new THREE.MeshPhysicalMaterial({
      color: 0xd5e2e9, emissive: 0xe9f5ff, emissiveIntensity: 0,
      roughness: 0.16, metalness: 0.12, clearcoat: 1, side: THREE.DoubleSide,
    });
    projector.material.userData.headlightScale = 1.3;
    projector.position.x -= 0.025;
    (vehicle.userData.headlightMaterials ??= []).push(projector.material);
  }
  const lightGuides = visual.getObjectByName('leds');
  if (lightGuides) {
    lightGuides.material = new THREE.MeshPhysicalMaterial({
      color: 0xb9c9d1, emissive: 0xe3f2ff, emissiveIntensity: 0,
      roughness: 0.21, metalness: 0.08, clearcoat: 0.8, side: THREE.DoubleSide,
    });
    lightGuides.material.userData.headlightScale = 0.75;
    lightGuides.position.x -= 0.012;
    (vehicle.userData.headlightMaterials ??= []).push(lightGuides.material);
  }
  for (const name of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr']) {
    const rim = visual.getObjectByName(name);
    if (rim) rim.material = new THREE.MeshStandardMaterial({ color: 0x98a4ab, metalness: 0.88, roughness: 0.22 });
  }

  const wheels = [];
  for (const [index, name] of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].entries()) {
    const wheel = visual.getObjectByName(name);
    if (!wheel) continue;
    const parent = wheel.parent;
    const localPosition = wheel.position.clone();
    parent.remove(wheel);
    const steerPivot = new THREE.Group();
    const spinPivot = new THREE.Group();
    steerPivot.position.copy(localPosition);
    wheel.position.set(0, 0, 0);
    parent.add(steerPivot);
    steerPivot.add(spinPivot);
    spinPivot.add(wheel);
    wheels.push({ steerPivot, spinPivot, front: name.endsWith('fl') || name.endsWith('fr'), physicsIndex: index, baseY: localPosition.y, spinDirection: -1 });
  }

  visual.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    object.castShadow = !materials.every(material => material.transparent);
    object.receiveShadow = true;
  });
  // Grounding comes from the car's actual sun shadows and scene-depth AO.
  // A body-attached rectangle cannot follow uneven road contact correctly.
  vehicle.userData.wheels = wheels;
  installLicensePlates(vehicle, 'ferrari');
  return vehicle;
}

export function animateCarModel(vehicle, state, dt) {
  for (const wheel of vehicle.userData.wheels) {
    const physical = state.wheels[wheel.physicsIndex];
    if (!physical) continue;
    if (wheel.front) wheel.steerPivot.rotation.y = THREE.MathUtils.damp(wheel.steerPivot.rotation.y, physical.steer, 12, dt);
    wheel.steerPivot.position.y = wheel.baseY + physical.compression - state.staticCompression;
    wheel.spinPivot.rotation.x = physical.spinAngle * (wheel.spinDirection ?? 1);
  }
  const brakes = vehicle.userData.brakeLights;
  for (const material of Array.isArray(brakes) ? brakes : brakes ? [brakes] : []) {
    material.emissiveIntensity = THREE.MathUtils.damp(
      material.emissiveIntensity, state.brakeForceInput > 0.1 || state.handbrake ? 3.6 : 0.3, 16, dt,
    );
  }
  const reverse = state.gear === 0;
  for (const material of vehicle.userData.reverseLightMaterials ?? []) {
    if (material.userData.reverseLightLevel) {
      const level = material.userData.reverseLightLevel;
      level.value = THREE.MathUtils.damp(level.value, reverse ? 1 : 0, 16, dt);
    } else {
      material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, reverse ? 2.5 : 0, 16, dt);
    }
  }
}
