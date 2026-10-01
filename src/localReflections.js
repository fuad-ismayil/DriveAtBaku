import * as THREE from 'three';

const SIZES = { performance: 0, balanced: 128, cinematic: 256 };

// One cubemap face per frame. The car sees a new filtered map only after all six
// faces are complete, so no half-updated cube can produce seams in the paint.
export function createLocalReflections(renderer, scene, sky) {
  let generator, cube, captureCamera, filtered, quality = null, face = -1, elapsed = Infinity;
  let dirty = true, lastVehicle = null;
  const lastCenter = new THREE.Vector3(Infinity, Infinity, Infinity);
  const skyPosition = new THREE.Vector3();
  const materials = new Map();
  const stats = { captures: 0, faces: 0, size: 0 };

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
    clearOverrides(); cube?.dispose(); filtered?.dispose(); generator?.dispose();
    cube = filtered = captureCamera = generator = null;
    quality = next; face = -1; dirty = true; elapsed = Infinity;
    stats.size = renderer.extensions.has('EXT_color_buffer_float') ? SIZES[quality] : 0;
    if (!stats.size) return;
    generator = new THREE.PMREMGenerator(renderer);
    cube = new THREE.WebGLCubeRenderTarget(stats.size, { type: THREE.HalfFloatType, generateMipmaps: false });
    captureCamera = new THREE.CubeCamera(0.3, 6000, cube);
    captureCamera.coordinateSystem = renderer.coordinateSystem;
    captureCamera.updateCoordinateSystem();
  }

  function invalidate() { dirty = true; face = -1; clearOverrides(); }

  function update(dt, vehicle, vehicles, garage) {
    if (!vehicle) return;
    register(vehicle);
    if (garage || !cube) { clearOverrides(); dirty = true; face = -1; return; }
    if (lastVehicle !== vehicle) { lastVehicle = vehicle; invalidate(); }
    const displacement = face >= 0 ? captureCamera.position.distanceToSquared(vehicle.position) : lastCenter.distanceToSquared(vehicle.position);
    if (!dirty && displacement > 80 ** 2) invalidate();
    elapsed += dt;
    if (face < 0) {
      if (!dirty && (elapsed < 2 || lastCenter.distanceToSquared(vehicle.position) < 18 ** 2)) return;
      captureCamera.position.copy(vehicle.position).add(new THREE.Vector3(0, 0, 1.15));
      captureCamera.updateMatrixWorld(true);
      face = 0;
      dirty = false;
    }
    const target = renderer.getRenderTarget(), activeFace = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const xr = renderer.xr.enabled, shadows = renderer.shadowMap.autoUpdate, autoClear = renderer.autoClear;
    const visibility = [...vehicles].map(car => [car, car.visible]);
    skyPosition.copy(sky.position);
    try {
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
        for (const { material } of materials.get(vehicle)) {
          if (material.envMap !== filtered.texture) { material.envMap = filtered.texture; material.needsUpdate = true; }
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
  return { update, invalidate, setQuality, stats, dispose() { clearOverrides(); cube?.dispose(); filtered?.dispose(); generator?.dispose(); } };
}
