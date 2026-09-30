import * as THREE from 'three';

export function createCarModel(gltf) {
  const vehicle = new THREE.Group();
  vehicle.rotation.order = 'ZXY';
  const visual = gltf.scene;
  visual.rotation.x = Math.PI / 2; // model Y-up/front -Z -> world Z-up/front +Y
  vehicle.add(visual);

  const body = visual.getObjectByName('body');
  if (body) {
    body.material = new THREE.MeshPhysicalMaterial({
      color: 0xa80719, metalness: 0.64, roughness: 0.23,
      clearcoat: 1, clearcoatRoughness: 0.12,
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
      transparent: true, opacity: 0.7, side: THREE.DoubleSide,
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
    object.castShadow = true;
    object.receiveShadow = true;
  });
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128; shadowCanvas.height = 256;
  const context = shadowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 128, 20, 64, 128, 126);
  gradient.addColorStop(0, 'rgba(0,0,0,0.42)');
  gradient.addColorStop(0.58, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 256);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 5.15), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false,
  }));
  shadow.position.z = 0.018;
  shadow.renderOrder = 2;
  vehicle.add(shadow);
  vehicle.userData.wheels = wheels;
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
