import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import * as THREE from 'three';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {readMapGeometry,readMapDocument} from './lib/readMapGeometry.mjs';
import {buildCityCollisions} from '../src/cityCollisions.js';
import {BarrierCollision} from '../src/barrierCollision.js';
import {GroundSampler} from '../src/groundSampler.js';
import {additionalGroundKind,ASPHALT_MATERIALS} from '../src/mapSurfaces.js';
import {surfaceKind,createSurfaceDetail} from '../src/surfaceDetail.js';
import {createDynamicsState,stepDynamics} from '../src/vehicleDynamics.js';
import {VEHICLES} from '../src/vehicleCatalog.js';
import {filterCityMapDocument} from '../src/cityMap.js';

const roots=['baku','buildings'].map(asset=>{const root=new THREE.Group();readMapGeometry(asset,()=>true,{city:true}).forEach(m=>root.add(m));return root;});
const visual=roots[0].children.slice(),primary=readMapGeometry('collision',()=>true,{city:true}),body=new BarrierCollision();
for(const mesh of primary){mesh.geometry.boundsTree=new MeshBVH(mesh.geometry,{indirect:true});mesh.raycast=acceleratedRaycast;body.addMesh(mesh);}
const world=await buildCityCollisions(roots,primary,body,{repairSources:readMapGeometry('baku',n=>['RMBL-material','POLICE-material','sochi_saussage-material','ROADOR-material','WHITELINE_A-material'].includes(n))});
const baseline=new GroundSampler(primary),down=new THREE.Vector3(0,0,-1),a=new THREE.Vector3(),b=a.clone(),c=a.clone(),normal=a.clone(),point=a.clone();
const report={materials:[],seams:[],terrainDrive:[],preservedMarkings:[],collisionBuild:world.report};
const inspect=(x,y,z)=>world.sampler.sample(new THREE.Vector3(x,y,z+2),down,4);

// Sample every non-degenerate support triangle's interior. Any lower hidden
// terrain layer is insufficient if the visible paving/grass is above it.
for(const mesh of visual){
  const kind=additionalGroundKind(mesh.material.name);if(!kind)continue;
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;let samples=0,missingBefore=0;const failures=[];
  for(let i=0;i<index.count;i+=3){
    a.fromBufferAttribute(p,index.getX(i)).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,index.getX(i+1)).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,index.getX(i+2)).applyMatrix4(mesh.matrixWorld);
    normal.subVectors(b,a).cross(c.clone().sub(a));if(normal.lengthSq()<1e-12||Math.abs(normal.z)/normal.length()<.05)continue;
    point.copy(a).add(b).add(c).multiplyScalar(1/3);const old=baseline.sample(point.clone().add(new THREE.Vector3(0,0,2)),down,4),hit=inspect(point.x,point.y,point.z);
    // Paint can intentionally float above its road. It must have continuous
    // backing and preserve existing contact, rather than becoming a raised bump.
    const expected=kind==='roadpaint'?(old?.point.z??-Infinity):point.z;
    if(!old||(kind!=='roadpaint'&&old.point.z<point.z-.002))missingBefore++;samples++;
    if(!hit||hit.point.z<expected-.002)failures.push({point:point.toArray(),hit:hit?.point.toArray()});
  }
  assert.deepEqual(failures.slice(0,5),[],`${mesh.material.name}: support aligns with all visible triangle interiors`);
  if(samples)report.materials.push({name:mesh.material.name,kind,samples,missingBefore});
}

// Cross actual road/sidewalk boundaries selected from the curb geometry, with
// the original pavement-A/road data present at the two ends. Check every cm.
const curb=visual.find(m=>m.material.name==='BAK_KERB_A-material'),p=curb.geometry.attributes.position,index=curb.geometry.index;
const ray=new THREE.Raycaster();ray.firstHitOnly=true;
function originalHit(pt){ray.set(pt.clone().add(new THREE.Vector3(0,0,3)),down);ray.far=6;return ray.intersectObjects(primary,false)[0];}
const roads=new Set(['colmesh-1-mesh','colmesh-1-mesh_2','colmesh-1-mesh_7','colmesh-1-mesh_8','colmesh-1-mesh_9']);
for(let i=0;i<index.count&&report.seams.length<80;i+=3*19){
  const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+j)).applyMatrix4(curb.matrixWorld));
  const n=new THREE.Vector3().subVectors(vertices[1],vertices[0]).cross(new THREE.Vector3().subVectors(vertices[2],vertices[0])).normalize();if(Math.abs(n.z)<.8)continue;
  let edgeA,edgeB,length=0;for(let j=0;j<3;j++){const x=vertices[j],y=vertices[(j+1)%3],d=Math.hypot(x.x-y.x,x.y-y.y);if(d>length){edgeA=x;edgeB=y;length=d;}}
  if(length<.3)continue;
  const center=edgeA.clone().add(edgeB).multiplyScalar(.5),across=new THREE.Vector3(edgeB.y-edgeA.y,edgeA.x-edgeB.x,0).normalize();
  let from=center.clone().addScaledVector(across,-1.2),to=center.clone().addScaledVector(across,1.2),h1=originalHit(from),h2=originalHit(to);
  if(!h1||!h2)continue;
  if(!roads.has(h1.object.name)&&roads.has(h2.object.name)){[from,to]=[to,from];[h1,h2]=[h2,h1];}
  if(!roads.has(h1.object.name)||h2.object.name!=='colmesh-1-mesh_11'||Math.abs(h1.point.z-h2.point.z)>.25)continue;
  const floor=Math.min(h1.point.z,h2.point.z),gaps=[];let repaired=0;
  for(let step=0;step<=240;step++){
    const pt=from.clone().lerp(to,step/240);pt.z=Math.max(h1.point.z,h2.point.z)+.5;
    const hit=inspect(pt.x,pt.y,pt.z),old=originalHit(pt);
    if(!old||old.point.z<floor-.03)repaired++;
    if(!hit||hit.point.z<floor-.03)gaps.push({step,point:pt.toArray(),hit:hit?.point.toArray()});
  }
  if(gaps.length){mkdirSync('artifacts/ground-surfaces',{recursive:true});writeFileSync('artifacts/ground-surfaces/gap-debug.json',JSON.stringify({from:h1.point.toArray(),to:h2.point.toArray(),gaps,collisionBuild:world.report},null,2));}
  assert.deepEqual(gaps.slice(0,3),[],'road/curb/sidewalk corridor has continuous contact');
  report.seams.push({from:h1.point.toArray(),to:h2.point.toArray(),samples:241,repaired});
}
assert.ok(report.seams.length>=10,'check many real curb transitions, not one synthetic seam');
assert.ok(report.seams.some(s=>s.repaired>0),'sample missing contacts in the prior collision layer');
report.slowApproaches=[];
for(const seam of report.seams.filter(s=>s.repaired>0).slice(0,12)){
  const from=new THREE.Vector3(...seam.from),to=new THREE.Vector3(...seam.to),forward=to.clone().sub(from).setZ(0).normalize();
  const heading=Math.atan2(-forward.x,forward.y);
  for(const vehicle of Object.values(VEHICLES)){
    const state=createDynamicsState(heading,vehicle,from);let minimum=Infinity,contactFrames=0;
    for(let frame=0;frame<600;frame++){
      const previous=state.position.clone(),rotation=state.quaternion.clone();
      stepDynamics(state,{throttle:.08,brake:0,steer:0},1/120,vehicle,world.sampler.sample.bind(world.sampler));body.resolve(state,previous,rotation,vehicle);
      minimum=Math.min(minimum,state.position.z);if(state.groundedWheels)contactFrames++;
      assert.ok(state.position.z>Math.min(from.z,to.z)-.3,'slow approach cannot fall beneath the curb seam');
    }
    assert.ok(contactFrames>550,'suspension retains support while approaching the sidewalk slowly');
    report.slowApproaches.push({vehicle:vehicle.id,from:from.toArray(),to:to.toArray(),contactFrames,minimum});
  }
}
assert.ok(report.slowApproaches.length>=20,'exercise low-speed curb approaches in every car');

const green=visual.find(m=>m.material.name==='BAK_GRASS_A-material'),gp=green.geometry.attributes.position,gi=green.geometry.index;
for(let i=0;i<gi.count&&report.terrainDrive.length<4;i+=3*11){
  point.set(0,0,0);for(let j=0;j<3;j++)point.add(new THREE.Vector3().fromBufferAttribute(gp,gi.getX(i+j)).applyMatrix4(green.matrixWorld));point.multiplyScalar(1/3);
  const floor=inspect(point.x,point.y,point.z);if(!floor||floor.mu!==.65)continue;
  let safe=true;for(const dx of [-1,1])for(const dy of [-2,2]){const h=inspect(point.x+dx,point.y+dy,point.z);if(!h||h.mu!==.65||Math.abs(h.point.z-floor.point.z)>.05)safe=false;}if(!safe)continue;
  const states=[];for(const vehicle of Object.values(VEHICLES)){
    const state=createDynamicsState(0,vehicle,floor.point);
    for(let frame=0;frame<600;frame++)stepDynamics(state,{throttle:0,brake:0,steer:0},1/120,vehicle,world.sampler.sample.bind(world.sampler));
    assert.ok(state.groundedWheels===4&&state.position.z>floor.point.z,'every car stays on grass without falling');states.push({vehicle:vehicle.id,grounded:state.groundedWheels,z:state.position.z});
  }
  report.terrainDrive.push({point:floor.point.toArray(),mu:floor.mu,rr:floor.rr,states});
}
assert.equal(report.terrainDrive.length,4,'four real green areas support every vehicle');

const doc=readMapDocument('baku');filterCityMapDocument(doc,'baku');const asphalt=doc.materials.find(m=>m.name==='ROADA_MAIN-material');
for(const name of ASPHALT_MATERIALS)assert.deepEqual(doc.materials.find(m=>m.name===name).pbrMetallicRoughness.baseColorTexture,asphalt.pbrMetallicRoughness.baseColorTexture);
assert.equal(surfaceKind('BAK_OFFTRACK_B-material'),'asphalt');
const detail=createSurfaceDetail(),material=new THREE.MeshStandardMaterial({name:'BAK_OFFTRACK_B-material'});assert.ok(detail.apply(material));assert.equal(material.userData.dryRoadSurface,true);assert.equal(material.roughness,.97);detail.dispose();
for(const name of ['MARKINGS_A-material','MARKINGS_B-material','MARKINGS_C-material','BAK_ROAD_MARKINGS_A-material','BAK_ROAD_MARKINGS_B-material','ROAD_MARKINGS_C-material','BAK_YELLOWLINE-material']){
  assert.ok(visual.some(m=>m.material.name===name));report.preservedMarkings.push(name);
}
assert.ok(!visual.some(m=>m.material.name==='WHITELINE_A-material'));
const raceLines=readMapGeometry('baku',n=>n==='WHITELINE_A-material')[0];let raceBacking=0;
for(let i=0;i<raceLines.geometry.index.count;i+=3){
  const p=raceLines.geometry.attributes.position,index=raceLines.geometry.index;point.set(0,0,0);
  const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+j)).applyMatrix4(raceLines.matrixWorld));
  normal.subVectors(vertices[1],vertices[0]).cross(vertices[2].clone().sub(vertices[0]));if(normal.lengthSq()<1e-10||Math.abs(normal.z)/normal.length()<.55)continue;
  for(const vertex of vertices)point.add(vertex);point.multiplyScalar(1/3);
  const hit=inspect(point.x,point.y,point.z);
  assert.ok(hit&&hit.point.z>=point.z-.4,'removing circuit paint does not remove its road backing');raceBacking++;
}
report.removedRaceLineBackingSamples=raceBacking;
mkdirSync('artifacts/ground-surfaces',{recursive:true});writeFileSync('artifacts/ground-surfaces/verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({triangles:report.materials.reduce((s,m)=>s+m.samples,0),missingBefore:report.materials.reduce((s,m)=>s+m.missingBefore,0),curbCorridors:report.seams.length,seamSamples:report.seams.length*241,greenAreas:report.terrainDrive.length,collisionBuild:world.report}));
