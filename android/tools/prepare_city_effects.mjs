import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import sharp from 'sharp';
import { readMapGeometry } from '../../scripts/lib/readMapGeometry.mjs';
import { buildRoomLightGeometry } from '../../src/roomLights.js';
import { addGovernmentHouseWindowRelief, createLimestonePixels, isGovernmentHouseMaterial, GOVERNMENT_HOUSE_ORIGIN } from '../../src/governmentHouse.js';
import { partitionMesh } from '../../src/worldOptimization.js';
import atlas from '../../src/windowLightingAtlas.json' with { type: 'json' };

const output = 'android/game/assets/world';
mkdirSync(output, { recursive: true });
const roots = ['baku', 'buildings'].map(asset => {
  const root = new THREE.Group();
  for (const mesh of readMapGeometry(asset, () => true, { city: true })) root.add(mesh);
  root.updateMatrixWorld(true);
  return [asset, root];
});
const rooms = buildRoomLightGeometry(roots);
const roomMesh = new THREE.Mesh(rooms.geometry, new THREE.MeshBasicMaterial());
roomMesh.updateMatrixWorld(true);
const chunks = partitionMesh(roomMesh, 128);
const header = Buffer.alloc(12); header.write('DABR'); header.writeUInt32LE(rooms.count, 4); header.writeUInt32LE(chunks.length, 8);
const parts = [header];
for (const chunk of chunks) {
  const g = chunk.geometry, count = g.index?.count ?? g.attributes.position.count;
  const bytes = Buffer.alloc(4 + count * 36); bytes.writeUInt32LE(count); let cursor = 4;
  for (let i = 0; i < count; i++) {
    const j = g.index ? g.index.getX(i) : i;
    const p = g.attributes.position, uv = g.attributes.uv, color = g.attributes.color;
    for (const x of [p.getX(j), p.getZ(j), -p.getY(j), uv.getX(j), uv.getY(j), g.attributes.roomId.getX(j), color.getX(j), color.getY(j), color.getZ(j)]) { bytes.writeFloatLE(x, cursor); cursor += 4; }
  }
  parts.push(bytes);
}
writeFileSync(`${output}/rooms.bin`, Buffer.concat(parts));
copyFileSync(`public${atlas.atlas}`, `${output}/room-mask.png`);
const details = new THREE.Group(); let windows = 0;
for (const mesh of roots[1][1].children) if (mesh.material.name === 'bak_building_high_19_a_02-material') windows += addGovernmentHouseWindowRelief(mesh, details);
const frameParts = [];
for (const mesh of details.children) {
  const g = mesh.geometry.toNonIndexed(), bytes = Buffer.alloc(g.attributes.position.count * 24);
  let cursor = 0;
  for (let i = 0; i < g.attributes.position.count; i++) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (const x of [p.getX(i), p.getZ(i), -p.getY(i), n.getX(i), n.getZ(i), -n.getY(i)]) { bytes.writeFloatLE(x, cursor); cursor += 4; }
  }
  frameParts.push(bytes);
}
writeFileSync(`${output}/house-frames.bin`, Buffer.concat(frameParts));
// Generate exactly the web's limestone/glass masks from the original atlas.
const manifest = JSON.parse(readFileSync('public/generated/asset-manifest.json'));
const packed = manifest.assets.buildings;
const bytes = gunzipSync(Buffer.concat(packed.parts.map(p => readFileSync(`public/generated/${p}`))));
const jsonLength = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + jsonLength)), binary = bytes.subarray(28 + jsonLength);
const masks = {};
for (const material of doc.materials.filter(m => isGovernmentHouseMaterial(m.name) && !/_03-material$/.test(m.name))) {
  const texture = doc.textures[material.pbrMetallicRoughness.baseColorTexture.index], image = doc.images[texture.source], view = doc.bufferViews[image.bufferView];
  const { data, info } = await sharp(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const file = `house-${Object.keys(masks).length}.png`;
  await sharp(createLimestonePixels(data, info.width, info.height), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(`${output}/${file}`);
  masks[material.name] = file;
}
let star = '';
for (let i = 0; i < 16; i++) { const a = -Math.PI/2 + i*Math.PI/8, r = i%2 ? 8 : 17; star += `${278+Math.cos(a)*r},${128+Math.sin(a)*r} `; }
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256"><path fill="#00b5e2" d="M0 0H512V86H0Z"/><path fill="#ef3340" d="M0 85H512V172H0Z"/><path fill="#509e2f" d="M0 171H512V256H0Z"/><circle cx="238" cy="128" r="29" fill="white"/><circle cx="247" cy="128" r="24" fill="#ef3340"/><polygon points="${star}" fill="white"/></svg>`)).png().toFile(`${output}/flag.png`);
const stats = { rooms: rooms.count, roomChunks: chunks.length, roomTriangles: rooms.geometry.attributes.position.count/3, houseWindows: windows, houseMasks: masks, houseOrigin: GOVERNMENT_HOUSE_ORIGIN, houseAngle: Math.atan2(.38,.925) };
writeFileSync(`${output}/effects.json`, JSON.stringify(stats));
writeFileSync('artifacts/android/city-effects.json', JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats));
