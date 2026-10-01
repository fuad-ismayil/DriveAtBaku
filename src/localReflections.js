import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const SIZES = { performance: 0, balanced: 128, cinematic: 256 };

// Complete probes blend in linear HDR into one stable texture. Neither an
// unfinished cube nor a hard swap reaches the paint, glass or clearcoat.
export function createLocalReflections(renderer, scene, sky) {
  let generator, cube, captureCamera, filtered, history, displayed;
  let quality = null, face = -1, elapsed = Infinity, blendTime = 1;
  let dirty = true, lastVehicle = null;
  const lastCenter = new THREE.Vector3(Infinity, Infinity, Infinity);
  const skyPosition = new THREE.Vector3();
  const materials = new Map();
  const stats = { captures: 0, faces: 0, size: 0, blend: 1 };
  const blitMaterial = new THREE.ShaderMaterial({
    uniforms: { previous: { value: null }, next: { value: null }, amount: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'varying vec2 vUv; uniform sampler2D previous,next; uniform float amount; void main(){gl_FragColor=mix(texture2D(previous,vUv),texture2D(next,vUv),amount);}',
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const blit = new FullScreenQuad(blitMaterial);
  function drawBlend(output, previous, next, amount) {
    blitMaterial.uniforms.previous.value = previous;
    blitMaterial.uniforms.next.value = next;
    blitMaterial.uniforms.amount.value = amount;
    renderer.setRenderTarget(output); blit.render(renderer);
  }

  function register(vehicle) {
    if (materials.has(vehicle)) return;
    const selected = new Set(vehicle.userData.paintMaterials ?? []);
    vehicle.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (material.isMeshPhysicalMaterial && material.roughness < 0.4) selected.add(material);
      }
    });
    materials.set(vehicle, [...selected].map(material => ({ material, original: material.envMap })));
  }

  function clearOverrides() {
    for (const list of materials.values()) for (const { material, original } of list) {
      if (material.envMap !== original) { material.envMap = original; material.needsUpdate = true; }
    }
  }

  function setQuality(value) {
    const next = Object.hasOwn(SIZES, value) ? value : 'balanced';
    if (quality === next) return;
    clearOverrides(); cube?.dispose(); filtered?.dispose(); history?.dispose(); displayed?.dispose(); generator?.dispose();
    cube = filtered = history = displayed = captureCamera = generator = null;
    quality = next; face = -1; dirty = true; elapsed = Infinity; blendTime = 1; stats.blend = 1;
    stats.size = renderer.extensions.has('EXT_color_buffer_float') ? SIZES[quality] : 0;
    if (!stats.size) return;
    generator = new THREE.PMREMGenerator(renderer);
    cube = new THREE.WebGLCubeRenderTarget(stats.size, { type: THREE.HalfFloatType, generateMipmaps: false });
    captureCamera = new THREE.CubeCamera(0.3, 6000, cube);
    captureCamera.coordinateSystem = renderer.coordinateSystem;
    captureCamera.updateCoordinateSystem();
  }

  function invalidate() { dirty = true; face = -1; }

  function update(dt, vehicle, vehicles, garage) {
    if (!vehicle) return;
    register(vehicle);
    if (garage || !cube) { clearOverrides(); dirty = true; face = -1; lastVehicle = null; return; }
    if (lastVehicle !== vehicle) { clearOverrides(); lastVehicle = vehicle; invalidate(); }
    const displacement = face >= 0 ? captureCamera.position.distanceToSquared(vehicle.position) : lastCenter.distanceToSquared(vehicle.position);
    if (!dirty && displacement > 120 ** 2) invalidate();
    elapsed += dt;
    if (face < 0 && blendTime >= 1 && (dirty || (elapsed >= .75 && lastCenter.distanceToSquared(vehicle.position) >= 6 ** 2))) {
      captureCamera.position.copy(vehicle.position).add(new THREE.Vector3(0, 0, 1.15));
      captureCamera.updateMatrixWorld(true);
      face = 0;
      dirty = false;
    }
    const target = renderer.getRenderTarget(), activeFace = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const xr = renderer.xr.enabled, shadows = renderer.shadowMap.autoUpdate, autoClear = renderer.autoClear;
    const visibility = [...vehicles].map(car => [car, car.visible]);
    for (const object of scene.children) if (object.userData.excludeFromReflection) visibility.push([object, object.visible]);
    skyPosition.copy(sky.position);
    try {
      renderer.xr.enabled = false;
      if (displayed && blendTime < 1) {
        blendTime = Math.min(1, blendTime + dt / .9);
        stats.blend = blendTime * blendTime * (3 - 2 * blendTime);
        drawBlend(displayed, history.texture, filtered.texture, stats.blend);
      }
      if (face < 0) return;
      for (const [car] of visibility) car.visible = false;
      sky.position.copy(captureCamera.position);
      // Reuse the previous sun shadow map; reflection capture must not run six
      // additional shadow passes or alter the main camera's shadow coverage.
      renderer.shadowMap.autoUpdate = false;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(cube, face);
      renderer.render(scene, captureCamera.children[face]);
      stats.faces++;
      face++;
      if (face === 6) {
        filtered = generator.fromCubemap(cube.texture, filtered);
        if (!displayed) {
          displayed = filtered.clone(); history = filtered.clone();
          drawBlend(displayed, filtered.texture, filtered.texture, 1);
        } else {
          drawBlend(history, displayed.texture, displayed.texture, 1);
          blendTime = 0; stats.blend = 0;
        }
        for (const { material } of materials.get(vehicle)) {
          if (material.envMap !== displayed.texture) { material.envMap = displayed.texture; material.needsUpdate = true; }
        }
        lastCenter.copy(captureCamera.position);
        lastCenter.z -= 1.15;
        stats.captures++; elapsed = 0; face = -1;
      }
    } finally {
      for (const [car, visible] of visibility) car.visible = visible;
      sky.position.copy(skyPosition);
      renderer.shadowMap.autoUpdate = shadows;
      renderer.xr.enabled = xr;
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(target, activeFace, mip);
    }
  }

  setQuality('balanced');
  return { update, invalidate, setQuality, stats, dispose() { clearOverrides(); cube?.dispose(); filtered?.dispose(); history?.dispose(); displayed?.dispose(); generator?.dispose(); blit.dispose(); blitMaterial.dispose(); } };
}
