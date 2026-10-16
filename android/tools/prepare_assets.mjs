// Prepare native resources without changing the web client's source or assets.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import * as THREE from 'three';
import { readMapGeometry } from '../../scripts/lib/readMapGeometry.mjs';
import { buildCityCollisions } from '../../src/cityCollisions.js';
import { BarrierCollision } from '../../src/barrierCollision.js';
import { partitionMesh, canCullBackfaces, extractOccluders } from '../../src/worldOptimization.js';
import { filterCityMapDocument } from '../../src/cityMap.js';
import { GroundSampler, LayeredGroundSampler } from '../../src/groundSampler.js';
import { VEHICLES } from '../../src/vehicleCatalog.js';
import { createDynamicsState } from '../../src/vehicleDynamics.js';

const output='android/game/assets';
for(const dir of ['world','world/textures','vehicles','data','audio'])mkdirSync(`${output}/${dir}`,{recursive:true});
const manifest=JSON.parse(readFileSync('public/generated/asset-manifest.json'));
const rootFor=asset=>{const root=new THREE.Group();for(const mesh of readMapGeometry(asset,()=>true,{city:true}))root.add(mesh);return root;};
const roots=['baku','buildings'].map(rootFor),primary=readMapGeometry('collision',()=>true,{city:true});
const barriers=new BarrierCollision();primary.forEach(m=>barriers.addMesh(m));
console.log('Preparing the existing audited road, wall and tree collision geometry…');
const city=await buildCityCollisions(roots,primary,barriers,{repairSources:readMapGeometry('baku',n=>['RMBL-material','POLICE-material','sochi_saussage-material','ROADOR-material','WHITELINE_A-material'].includes(n))});
const groundGroups=[primary,city.repairs,city.groundMeshes.filter(m=>m.userData.groundSurfaceKind!=='roadpaint'),city.seamMeshes,city.groundMeshes.filter(m=>m.userData.groundSurfaceKind==='roadpaint')];
const occluderVertices=[];
for(const root of roots)for(const mesh of root.children.filter(m=>m.isMesh))for(const face of extractOccluders(mesh)){
  for(const v of face.vertices)occluderVertices.push(v.x,v.z,-v.y);
}
const occluderBytes=Buffer.alloc(occluderVertices.length*4);occluderVertices.forEach((v,i)=>occluderBytes.writeFloatLE(v,i*4));
writeFileSync(`${output}/world/occluders.bin`,occluderBytes);
function triangles(mesh,visit){
  mesh.updateMatrixWorld(true);const p=mesh.geometry.attributes.position,ix=mesh.geometry.index,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<(ix?.count??p.count);i+=3){a.fromBufferAttribute(p,ix?ix.getX(i):i).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,ix?ix.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,ix?ix.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);visit([...a,...b,...c]);}
}
const ng=groundGroups.flat().reduce((sum,m)=>sum+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
const nw=barriers.colliders.reduce((sum,e)=>sum+(e.mesh.geometry.index?.count??e.mesh.geometry.attributes.position.count)/3,0);
const world=Buffer.alloc(20+ng*96+nw*72+city.trunks.length*40);world.write('DABW');[1,ng,nw,city.trunks.length].forEach((v,i)=>world.writeUInt32LE(v,4+i*4));let cursor=20;
function doubles(values){for(const v of values){world.writeDoubleLE(v,cursor);cursor+=8;}}
for(const [layer,meshes]of groundGroups.entries())for(const mesh of meshes){const name=mesh.material.name,mu=mesh.userData.groundSurfaceKind==='terrain'||/grass|dirt|sand/i.test(`${mesh.name} ${name}`)?.65:/gravel/i.test(`${mesh.name} ${name}`)?.75:1;triangles(mesh,t=>doubles([...t,mu,mu<1?.045:.013,layer]));}
// Contact ties use the web BVH's traversal order, rather than the source index
// order. Preserve that order when baking so a wall corner selects the same face.
for(const {mesh}of barriers.colliders)mesh.geometry.boundsTree.shapecast({intersectsBounds:()=>true,intersectsTriangle:triangle=>{
  const a=triangle.a.clone().applyMatrix4(mesh.matrixWorld),b=triangle.b.clone().applyMatrix4(mesh.matrixWorld),c=triangle.c.clone().applyMatrix4(mesh.matrixWorld);
  doubles([...a,...b,...c]);return false;
}});
for(const t of city.trunks)doubles([t.x,t.y,t.bottom,t.top,t.radius]);
if(cursor!==world.length)throw new Error('Collision asset byte count mismatch');writeFileSync(`${output}/world/collisions.bin`,world);
writeFileSync(`${output}/data/route.json`,readFileSync('public/generated/route.json'));
writeFileSync('artifacts/android/collision-preparation.json',JSON.stringify({...city.report,groundTriangles:ng,barrierTriangles:nw,bytes:world.length},null,2));

// Portable surface-query fixtures use the exact existing layered sampler.
const queries=[];const route=JSON.parse(readFileSync('public/generated/route.json'));
for(const p of [route.spawn,...route.checkpoints])for(const dx of [-2,0,2])for(const dy of [-2,0,2]){
  const from=new THREE.Vector3(p[0]+dx,p[1]+dy,p[2]+6),hit=city.sampler.sample(from,new THREE.Vector3(0,0,-1),16);
  queries.push({origin:from.toArray(),direction:[0,0,-1],max:16,hit:hit?{distance:hit.distance,point:hit.point.toArray(),normal:hit.normal.toArray(),mu:hit.mu,rr:hit.rr}:null});
}
writeFileSync('artifacts/android/ground-reference.json',JSON.stringify(queries));
const fixtureChunks=[];
function fixtureNumbers(values){const b=Buffer.alloc(values.length*8);values.forEach((v,i)=>b.writeDoubleLE(Number(v),i*8));fixtureChunks.push(b);}
fixtureNumbers([queries.length]);
for(const q of queries)fixtureNumbers([...q.origin,...q.direction,q.max,Boolean(q.hit),...(q.hit?[q.hit.distance,...q.hit.point,...q.hit.normal,q.hit.mu,q.hit.rr]:Array(9).fill(0))]);
const sweeps=[];
for(const [vehicleIndex,vehicle]of Object.values(VEHICLES).entries()){
  for(const trunk of city.trunks.filter((_,i)=>i%19===0))for(const heading of [0,Math.PI/4]){
    const from=new THREE.Vector3(trunk.x-7,trunk.y,trunk.bottom),to=new THREE.Vector3(trunk.x+7,trunk.y,trunk.bottom);
    const state=createDynamicsState(heading,vehicle,from),start=state.position.clone(),rotation=state.quaternion.clone();
    state.position.copy(to).z+=state.comHeight;state.velocity.subVectors(state.position,start).multiplyScalar(120);
    const hit=barriers.resolve(state,start,rotation,vehicle);sweeps.push({vehicleIndex,heading,from:from.toArray(),to:to.toArray(),hit,p:state.position.toArray(),q:state.quaternion.toArray(),v:state.velocity.toArray()});
  }
}
fixtureNumbers([sweeps.length]);
for(const s of sweeps)fixtureNumbers([s.vehicleIndex,s.heading,...s.from,...s.to,s.hit,...s.p,...s.q,...s.v]);
writeFileSync('artifacts/android/world-reference.bin',Buffer.concat(fixtureChunks));
if(process.argv.includes('--collisions-only')){
  console.log(`Prepared ${queries.length} ground queries and ${sweeps.length} swept-contact references.`);
  process.exit(0);
}

const imageCache=new Map();const conversion=new THREE.Matrix4().makeRotationX(-Math.PI/2);
for(const [assetIndex,asset]of ['baku','buildings'].entries()){
  console.log(`Preparing spatially partitioned ${asset} visuals…`);
  const packed=manifest.assets[asset],bytes=gunzipSync(Buffer.concat(packed.parts.map(p=>readFileSync(`public/generated/${p}`))));
  const jsonLength=bytes.readUInt32LE(12),source=JSON.parse(bytes.subarray(20,20+jsonLength));const binary=bytes.subarray(28+jsonLength);
  filterCityMapDocument(source,asset);
  const gltf={asset:{version:'2.0',generator:'DriveAtBaku native asset preparation'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],textures:[],images:[],samplers:source.samplers??[],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};
  const buffers=[];let size=0;const materials=new Map(),textures=new Map();
  function bufferView(data){const padding=(4-data.length%4)%4,index=gltf.bufferViews.length;gltf.bufferViews.push({buffer:0,byteOffset:size,byteLength:data.length});buffers.push(data);if(padding)buffers.push(Buffer.alloc(padding));size+=data.length+padding;return index;}
  function accessor(attr){const type={1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'}[attr.itemSize],componentType=attr.array instanceof Uint32Array?5125:attr.array instanceof Uint16Array?5123:5126;
    const data=Buffer.from(attr.array.buffer,attr.array.byteOffset,attr.array.byteLength),index=gltf.accessors.length;const a={bufferView:bufferView(data),componentType,count:attr.count,type};
    if(attr.itemSize===3){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<attr.count;i++)for(let j=0;j<3;j++){const v=attr.array[i*3+j];min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);}a.min=min;a.max=max;}gltf.accessors.push(a);return index;
  }
  async function texture(id){if(textures.has(id))return textures.get(id);const t=source.textures[id],im=source.images[t.source],view=source.bufferViews[im.bufferView];
    if(!view)throw new Error('Expected embedded map image');const raw=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),hash=createHash('sha256').update(raw).digest('hex').slice(0,24);
    if(!imageCache.has(hash)){await sharp(raw).resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).png().toFile(`${output}/world/textures/${hash}.png`);imageCache.set(hash,true);}
    const imageIndex=gltf.images.length;gltf.images.push({uri:`textures/${hash}.png`});const index=gltf.textures.length;gltf.textures.push({...t,source:imageIndex});textures.set(id,index);return index;
  }
  async function material(mesh){const name=mesh.material.name;if(materials.has(name))return materials.get(name);const src=structuredClone(source.materials.find(m=>m.name===name)??{name});
    for(const obj of [src,src.pbrMetallicRoughness??{}])for(const [key,v]of Object.entries(obj))if(key.endsWith('Texture')&&v?.index!==undefined)v.index=await texture(v.index);
    src.doubleSided=!canCullBackfaces(mesh);src.pbrMetallicRoughness??={};src.pbrMetallicRoughness.roughnessFactor=/water/i.test(name)?.25:.75;src.pbrMetallicRoughness.metallicFactor=/window|glass/i.test(name)?.2:0;
    if(mesh.material.alphaTest>0){src.alphaMode='MASK';src.alphaCutoff=/tree|hedge|grass_bridge/i.test(name)?.38:10/255;}
    const index=gltf.materials.length;gltf.materials.push(src);materials.set(name,index);return index;
  }
  for(const mesh of roots[assetIndex].children.filter(m=>m.isMesh)){
    // Road repair geometry is created by the web collision builder and uses the
    // existing asphalt binding. Its vertices are included in the native scene.
    const mat=await material(mesh);
    for(const chunk of partitionMesh(mesh,128)){
      const geometry=chunk.geometry.clone().applyMatrix4(chunk.matrixWorld).applyMatrix4(conversion);const attributes={};
      for(const [name,key]of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0']])if(geometry.attributes[name])attributes[key]=accessor(geometry.attributes[name]);
      const primitive={attributes,material:mat};if(geometry.index)primitive.indices=accessor(geometry.index);
      const id=gltf.meshes.length;gltf.meshes.push({name:chunk.name,primitives:[primitive]});gltf.scenes[0].nodes.push(gltf.nodes.length);gltf.nodes.push({name:`${asset}_${id}`,mesh:id});geometry.dispose();
    }
  }
  gltf.buffers[0].byteLength=size;let json=Buffer.from(JSON.stringify(gltf));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const bin=Buffer.concat(buffers);const result=Buffer.alloc(28+json.length+bin.length);
  result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);result.writeUInt32LE(bin.length,20+json.length);result.writeUInt32LE(0x004e4942,24+json.length);bin.copy(result,28+json.length);writeFileSync(`${output}/world/${asset}.glb`,result);
  console.log(`${asset}: ${gltf.meshes.length} chunks, ${gltf.materials.length} materials, ${(result.length/1048576).toFixed(1)} MiB geometry`);
}
for(const dir of ['engines','tires'])for(const file of readdirSync(`public/assets/audio/${dir}`))if(file.endsWith('.wav'))copyFileSync(`public/assets/audio/${dir}/${file}`,`${output}/audio/${file}`);
copyFileSync('public/assets/fonts/AlteDIN1451-Regular.ttf',`${output}/data/AlteDIN1451-Regular.ttf`);
copyFileSync('public/multiplayer-config.json',`${output}/data/multiplayer-config.json`);
console.log(`Prepared native city, collision layers, ${imageCache.size} unique map textures, audio and local configuration.`);
