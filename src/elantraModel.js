import * as THREE from 'three';

export function repairMissingNormals(geometry) {
  const authoredNormals = geometry.getAttribute('normal');
  const missingNormals = [];
  for (let i = 0; i < authoredNormals.count; i++) {
    if (authoredNormals.getX(i) === 0 && authoredNormals.getY(i) === 0 && authoredNormals.getZ(i) === 0) missingNormals.push(i);
  }
  if (missingNormals.length) {
    geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();
    const computedNormals = geometry.getAttribute('normal');
    for (const i of missingNormals) {
      const x = computedNormals.getX(i), y = computedNormals.getY(i), z = computedNormals.getZ(i);
      authoredNormals.setXYZ(i, x, x === 0 && y === 0 && z === 0 ? 1 : y, z);
    }
    geometry.setAttribute('normal', authoredNormals);
  }
  return missingNormals.length;
}

function decodeArray(encoded, Type) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Type(bytes.buffer);
}

async function loadData() {
  const response = await fetch('/assets/vehicles/elantra-showroom.bin');
  if (!response.ok) throw new Error('Elantra model asset is unavailable');
  const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(decompressed).text());
}

function materialFor(part, entry, index, textures, brakeMaterials, paintMaterials, headlightMaterials, reverseLightMaterials) {
  const rgba = entry.color;
  const textureName = entry.texture.toLowerCase();
  const paint = rgba[0] === 116 && rgba[1] === 116 && !textureName;
  if (paint) {
    const finish = new THREE.MeshPhysicalMaterial({
      name: 'Elantra body paint', color: 0xb9c3ca, metalness: 0.58,
      roughness: 0.27, clearcoat: 0.85, clearcoatRoughness: 0.13,
      envMapIntensity: 0.75,
    });
    paintMaterials.push(finish);
    return finish;
  }
  if (rgba[3] < 255 && !textureName) {
    const window = rgba[3] === 204 || part.id === 29;
    return new THREE.MeshPhysicalMaterial({
      color: window ? 0x20313b : 0xbac8d1, roughness: 0.12,
      metalness: window ? 0.1 : 0.03, transparent: true,
      opacity: window ? 0.67 : 0.17, depthWrite: false,
      side: THREE.DoubleSide, clearcoat: 1,
    });
  }
  const color = new THREE.Color().setRGB(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, THREE.SRGBColorSpace);
  let metalness = 0;
  let roughness = 0.66;
  if (!textureName && rgba[0] >= 180) { metalness = 0.85; roughness = 0.23; }
  if (!textureName && rgba[0] < 30) { color.set(0x1a1d1f); roughness = 0.48; }
  if (textureName === 'ss') { color.set(0x303436); roughness = 0.83; }
  if (textureName === 's') { color.set(0x545752); roughness = 0.9; }
  if (textureName === 'sss') { color.set(0xaaa9a0); roughness = 0.75; }
  if (textureName === 'dbii6sibpjg' || textureName === 'vehiclelights128') {
    color.set(0xffffff); metalness = 0.38; roughness = 0.24;
  }
  if (part.id === 19 && textureName === '123') { color.set(0xffffff); roughness = 0.22; }
  const result = new THREE.MeshPhysicalMaterial({
    name: `Elantra part ${part.id} material ${index}`, color, metalness, roughness,
    map: ['ss', 's', 'sss'].includes(textureName) ? null : textures[textureName] ?? null,
    clearcoat: metalness > 0.4 ? 0.35 : 0,
    transparent: rgba[3] < 255, opacity: rgba[3] / 255,
    depthWrite: rgba[3] === 255, side: rgba[3] < 255 ? THREE.DoubleSide : THREE.FrontSide,
    envMapIntensity: 0.72,
  });
  if (part.id === 18 && index === 3) {
    result.emissive.set(0x9e0905);
    result.emissiveIntensity = 0.2;
    brakeMaterials.push(result);
    const reverseLightLevel = { value: 0 };
    result.userData.reverseLightLevel = reverseLightLevel;
    result.onBeforeCompile = shader => {
      shader.uniforms.reverseLightLevel = reverseLightLevel;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vLampPosition;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLampPosition = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying vec3 vLampPosition;\nuniform float reverseLightLevel;\nvoid main() {')
        .replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          float lampX = abs(vLampPosition.x);
          float reverseMask = smoothstep(0.56, 0.59, lampX)
            * (1.0 - smoothstep(0.68, 0.71, lampX))
            * smoothstep(2.14, 2.17, vLampPosition.z)
            * (1.0 - smoothstep(2.23, 2.27, vLampPosition.z))
            * (1.0 - smoothstep(-0.245, -0.20, vLampPosition.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.83, 0.90, 1.0), reverseMask * reverseLightLevel);
          totalEmissiveRadiance += vec3(2.4, 2.75, 3.1) * reverseMask * reverseLightLevel;
        `);
    };
    reverseLightMaterials.push(result);
  }
  if (part.id === 18 && index === 5) {
    result.emissive.set(0xe4efff);
    result.emissiveIntensity = 0;
    reverseLightMaterials.push(result);
  }
  if (part.id === 20 && index === 0) {
    result.color.set(0xe2ebf0);
    result.metalness = 0.12;
    result.roughness = 0.18;
    result.emissive.set(0xe8f4ff);
    result.emissiveIntensity = 0;
    result.userData.headlightScale = 0.55;
    headlightMaterials.push(result);
  }
  if (part.id === 20 && index === 2) {
    result.color.set(0x253b49);
    result.metalness = 0.04;
    result.roughness = 0.08;
    result.clearcoat = 1;
    result.clearcoatRoughness = 0.04;
    result.emissive.set(0xf1f8ff);
    result.emissiveIntensity = 0;
    result.userData.headlightScale = 1.65;
    headlightMaterials.push(result);
  }
  if (part.id === 20 && [4, 5, 6].includes(index)) {
    result.color.set(index === 6 ? 0xdbe9f0 : 0xf3f6f8);
    result.emissive.set(0xe4efff);
    result.emissiveIntensity = 0;
    result.metalness = 0.08;
    result.roughness = 0.19;
    result.side = THREE.DoubleSide;
    result.userData.headlightScale = index === 6 ? 0.75 : 1.25;
    headlightMaterials.push(result);
  }
  return result;
}

function buildWheel() {
  const wheel = new THREE.Group();
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x171a1d, roughness: 0.91 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xaeb8c0, metalness: 0.83, roughness: 0.27 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20262a, metalness: 0.43, roughness: 0.49 });
  const profile = new THREE.CatmullRomCurve3([
    [-0.103, 0.224], [-0.115, 0.245], [-0.112, 0.292], [-0.09, 0.327],
    [-0.058, 0.338], [0, 0.34], [0.058, 0.338], [0.09, 0.327],
    [0.112, 0.292], [0.115, 0.245], [0.103, 0.224], [0, 0.224],
  ].map(([x, r]) => new THREE.Vector3(x, r, 0)), true, 'centripetal');
  const positions = [], indices = [], segments = 96, rings = 32;
  for (let ring = 0; ring <= rings; ring++) {
    const point = profile.getPoint(ring / rings);
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      let radius = point.y;
      if (radius > 0.329) {
        for (const groove of [-0.052, -0.018, 0.018, 0.052]) {
          radius -= 0.003 * Math.exp(-(((point.x - groove) / 0.004) ** 2));
        }
      }
      positions.push(point.x, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
  }
  for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
    const a = ring * (segments + 1) + segment, b = a + segments + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const tireGeometry = new THREE.BufferGeometry();
  tireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  tireGeometry.setIndex(indices);
  tireGeometry.computeVertexNormals();
  const tire = new THREE.Mesh(tireGeometry, tireMaterial);
  tire.castShadow = true;
  wheel.add(tire);
  for (const side of [-1, 1]) {
    const sidewall = new THREE.Mesh(new THREE.RingGeometry(0.218, 0.333, 64), tireMaterial);
    sidewall.rotation.y = side * Math.PI / 2;
    sidewall.position.x = side * 0.109;
    wheel.add(sidewall);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.217, 0.009, 8, 64), alloy);
    lip.rotation.y = Math.PI / 2;
    lip.position.x = side * 0.114;
    wheel.add(lip);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.053, 0.053, 0.014, 24), alloy);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = side * 0.121;
    wheel.add(hub);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.122, 0.034), alloy);
      spoke.position.set(side * 0.119, Math.cos(i * Math.PI * 2 / 5) * 0.139, Math.sin(i * Math.PI * 2 / 5) * 0.139);
      spoke.rotation.x = -i * Math.PI * 2 / 5;
      spoke.rotation.y = side * 0.18;
      wheel.add(spoke);
    }
    const centre = new THREE.Mesh(new THREE.CircleGeometry(0.034, 24), dark);
    centre.rotation.y = side * Math.PI / 2;
    centre.position.x = side * 0.131;
    wheel.add(centre);
  }
  return wheel;
}

export async function loadElantraModel() {
  const data = await loadData();
  const loader = new THREE.TextureLoader();
  const textures = {};
  await Promise.all(Object.entries(data.textures).map(async ([name, encoded]) => {
    const texture = await loader.loadAsync(`data:image/png;base64,${encoded}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    textures[name.toLowerCase()] = texture;
  }));

  const car = new THREE.Group();
  car.rotation.order = 'ZXY';
  const yUp = new THREE.Group();
  yUp.rotation.x = Math.PI / 2;
  car.add(yUp);
  const body = new THREE.Group();
  yUp.add(body);
  const brakes = [];
  const paintMaterials = [];
  const headlightMaterials = [];
  const reverseLightMaterials = [];
  for (const part of data.meshes) {
    if (part.id === 30) continue; // Showroom replaces the original steel wheel with an alloy wheel.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(decodeArray(part.v, Float32Array), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(decodeArray(part.n, Int16Array), 3, true));
    geometry.setAttribute('uv', new THREE.BufferAttribute(decodeArray(part.uv, Float32Array), 2));
    geometry.setIndex(new THREE.BufferAttribute(decodeArray(part.ix, Uint32Array), 1));
    // The showroom export includes zero normals. Normalizing those in a physical
    // shader can produce NaNs that spread across HDR bloom. Keep authored normals
    // and reconstruct only the missing ones from the actual triangle faces.
    repairMissingNormals(geometry);
    for (const group of part.groups) geometry.addGroup(...group);
    const mesh = new THREE.Mesh(geometry, part.materials.map((entry, index) => materialFor(part, entry, index, textures, brakes, paintMaterials, headlightMaterials, reverseLightMaterials)));
    mesh.name = part.name || `Elantra part ${part.id}`;
    mesh.castShadow = ![19, 21, 25, 27, 29].includes(part.id);
    mesh.receiveShadow = true;
    body.add(mesh);
  }
  const wheelGeometry = buildWheel();
  const wheels = [];
  for (const item of data.wheels) {
    const pivot = new THREE.Group();
    pivot.position.set(...item.pos);
    const spin = new THREE.Group();
    spin.add(wheelGeometry.clone());
    pivot.add(spin);
    yUp.add(pivot);
    const physicsIndex = item.name.includes('lf') ? 0 : item.name.includes('rf') ? 1 : item.name.includes('lb') ? 2 : 3;
    wheels.push({ steerPivot: pivot, spinPivot: spin, front: physicsIndex < 2, physicsIndex, baseY: item.pos[1], spinDirection: -1 });
  }
  // Source coordinates are Y-up and nose toward -Z; the game is Z-up and nose +Y.
  // The wheel contact patch is the reliable floor reference for this mesh.
  const bounds = new THREE.Box3().setFromObject(yUp);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const scale = 4.53 / size.y;
  yUp.scale.setScalar(scale);
  yUp.position.set(-centre.x * scale, -centre.y * scale, -bounds.min.z * scale);
  // Mesh content has its own body/rolling wheels, so no procedural Ferrari shell is used.
  car.userData.wheels = wheels;
  car.userData.brakeLights = brakes;
  car.userData.headlightMaterials = headlightMaterials;
  car.userData.reverseLightMaterials = reverseLightMaterials;
  car.userData.paintMaterials = paintMaterials;
  return car;
}
