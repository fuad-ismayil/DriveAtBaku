import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as THREE from 'three';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {readMapGeometry} from './lib/readMapGeometry.mjs';
import {BarrierCollision} from '../src/barrierCollision.js';
import {buildCityCollisions} from '../src/cityCollisions.js';
import {collisionMesh,simplifyCoplanarTriangles,treeTrunks} from '../src/collisionGeometry.js';
import {GroundSampler} from '../src/groundSampler.js';
import {createDynamicsState,stepDynamics} from '../src/vehicleDynamics.js';
import {VEHICLES} from '../src/vehicleCatalog.js';
function drive(body,from,to,vehicle,heading=0) {
  const state=createDynamicsState(heading,vehicle,new THREE.Vector3(...from)),start=state.position.clone(),rotation=state.quaternion.clone();
  state.position.fromArray(to).z+=state.comHeight;state.velocity.subVectors(state.position,start).multiplyScalar(120);
  return {state,hit:body.resolve(state,start,rotation,vehicle)};
}
for(const vehicle of Object.values(VEHICLES)) {
  const body=new BarrierCollision();body.addCylinder({x:3,y:0,bottom:0,top:3,radius:.25});
  const hit=drive(body,[0,0,0],[250,0,0],vehicle);
  assert.ok(hit.hit&&hit.state.position.x<=3-.25-vehicle.dims.width/2,'continuous trunk collision prevents tunnelling');
  assert.equal(drive(body,[0,4,0],[10,4,0],vehicle).hit,false,'canopy-sized space stays clear');
  assert.equal(drive(body,[0,0,6],[10,0,6],vehicle).hit,false,'nothing collides above the finite trunk');
  const start=3-.25-vehicle.dims.width/2-.04;
  assert.equal(drive(body,[start,0,0],[0,4,0],vehicle).hit,false,'reverse away from trunk');
  const corner=drive(body,[0,0,0],[10,0,0],vehicle,Math.PI/4);
  assert.ok(corner.hit&&Math.abs(corner.state.position.y)>.1,'rotated body corners collide and deflect around the trunk');
  const embedded=drive(body,[3,0,0],[3,0,0],vehicle);
  assert.ok(embedded.hit&&embedded.state.position.x!==3,'stationary overlap resolves');
}
// A subdivided wall with a vehicle-sized doorway, including an inner boundary.
const grid=[];for(let x=-6;x<6;x++)for(let z=0;z<6;z++){
  if(x>=-2&&x<2&&z<3)continue;
  const a=new THREE.Vector3(x,5,z),b=new THREE.Vector3(x+1,5,z),c=new THREE.Vector3(x+1,5,z+1),d=new THREE.Vector3(x,5,z+1);
  grid.push([a,b,c],[a,c,d]);
}
const simple=simplifyCoplanarTriangles(grid);assert.ok(simple.length<grid.length/3,'coplanar wall subdivision is removed');
const wall=new BarrierCollision();wall.addMesh(collisionMesh(simple));
for(const vehicle of Object.values(VEHICLES)){
  assert.equal(drive(wall,[0,0,0],[0,10,0],vehicle).hit,false,'doorway remains open');
  assert.ok(drive(wall,[4,0,0],[4,10,0],vehicle).hit,'wall beside doorway remains solid');
}
const original=readMapGeometry('collision'),primary=readMapGeometry('collision',()=>true,{city:true});
for(const meshes of [original,primary])for(const mesh of meshes){mesh.geometry.boundsTree=new MeshBVH(mesh.geometry,{indirect:true});mesh.raycast=acceleratedRaycast;}
const roots=['baku','buildings'].map(asset=>{const root=new THREE.Group();for(const mesh of readMapGeometry(asset,()=>true,{city:true}))root.add(mesh);return root;});
const body=new BarrierCollision();primary.forEach(m=>body.addMesh(m));
const world=await buildCityCollisions(roots,primary,body,{repairSources:readMapGeometry('baku',n=>['RMBL-material','POLICE-material','sochi_saussage-material','ROADOR-material','WHITELINE_A-material'].includes(n))});
assert.equal(world.trunks.length,1219,'one trunk per crossed billboard pair, including sloping bases');
assert.ok(world.trunks.every(t=>t.radius<=.45&&t.top-t.bottom<=4.5+1e-10),'trunks stay narrow and below the canopy');
assert.ok(world.report.wallInputTriangles<300000&&world.report.wallTriangles<world.report.wallInputTriangles,'walls omit roofs and upper-story trim and merge coplanar faces');
assert.ok(world.report.wallMaterials>150,'environmental colliders cover city wall material families');
const oldGround=new GroundSampler(original),down=new THREE.Vector3(0,0,-1);
const route=JSON.parse(readFileSync(new URL('../public/generated/route.json',import.meta.url)));
for(const p of [route.spawn,...route.checkpoints]){
  const from=new THREE.Vector3(...p).add(new THREE.Vector3(0,0,6)),a=oldGround.sample(from,down,16),b=world.sampler.sample(from,down,16);
  assert.deepEqual(b.point.toArray(),a.point.toArray());assert.deepEqual(b.normal.toArray(),a.normal.toArray());assert.equal(b.mu,a.mu);assert.equal(b.rr,a.rr);
}
// Exact trajectories on an unaffected stretch remain independent of new walls.
for(const vehicle of Object.values(VEHICLES)){
  const spawn=new THREE.Vector3(...route.spawn);spawn.z=world.sampler.sample(spawn.clone().add(new THREE.Vector3(0,0,6)),down,16).point.z;
  const a=createDynamicsState(route.heading,vehicle,spawn),b=createDynamicsState(route.heading,vehicle,spawn);
  for(let i=0;i<360;i++){
    const previous=b.position.clone(),rotation=b.quaternion.clone();
    const input={throttle:1,brake:0,steer:0};stepDynamics(a,input,1/120,vehicle,oldGround.sample.bind(oldGround));stepDynamics(b,input,1/120,vehicle,world.sampler.sample.bind(world.sampler));
    assert.equal(body.resolve(b,previous,rotation,vehicle),false,'no new obstacle in open starting street');
  }
  assert.deepEqual(b.position.toArray(),a.position.toArray());assert.deepEqual(b.velocity.toArray(),a.velocity.toArray());
}
let actualTrees=0;
for(const trunk of world.trunks){
  const ground=world.sampler.sample(new THREE.Vector3(trunk.x,trunk.y,trunk.bottom+3),down,8);if(!ground)continue;
  const from=[trunk.x-5,trunk.y,ground.point.z],to=[trunk.x+5,trunk.y,ground.point.z];
  for(const vehicle of Object.values(VEHICLES))assert.ok(drive(body,from,to,vehicle).hit,'real trunk blocks each car');
  if(++actualTrees===12)break;
}
assert.ok(actualTrees>=8,'exercise trees at actual drivable locations');
let actualWalls=0;
for(const mesh of world.walls){
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let i=0;i<index.count&&actualWalls<16;i+=3*11){
    const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+j)));
    const n=new THREE.Vector3().subVectors(vertices[1],vertices[0]).cross(new THREE.Vector3().subVectors(vertices[2],vertices[0])).normalize();
    if(Math.abs(n.z)>.05)continue;
    const base=vertices.reduce((a,b)=>a.z<b.z?a:b),ground=world.sampler.sample(new THREE.Vector3(base.x,base.y,40),down,80);if(!ground)continue;
    const z=ground.point.z+.8,intersections=[];
    for(let j=0;j<3;j++){const a=vertices[j],b=vertices[(j+1)%3];if((a.z<z)!==(b.z<z)){const t=(z-a.z)/(b.z-a.z);intersections.push(a.clone().lerp(b,t));}}
    if(intersections.length!==2)continue;
    const point=intersections[0].add(intersections[1]).multiplyScalar(.5);point.z=ground.point.z;
    const from=point.clone().addScaledVector(n,6).toArray(),to=point.clone().addScaledVector(n,-6).toArray();
    const isolated=new BarrierCollision();isolated.addMesh(mesh);
    for(const vehicle of Object.values(VEHICLES))assert.ok(drive(isolated,from,to,vehicle).hit,'actual visible city facade stops every car');
    actualWalls++;
  }
  if(actualWalls===16)break;
}
assert.equal(actualWalls,16,'sample sixteen actual wall locations');
let repairedSamples=0;
for(const mesh of world.repairs){const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  const heights=new Map();for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i)].map(v=>Math.round(v*1e4)).join(',');if(heights.has(key))assert.ok(Math.abs(p.getZ(i)-heights.get(key))<1e-4,'shared repair vertices cannot create a seam');else heights.set(key,p.getZ(i));}
  for(let i=0;i<index.count;i+=3*17){const point=new THREE.Vector3();for(let j=0;j<3;j++)point.add(new THREE.Vector3().fromBufferAttribute(p,index.getX(i+j)));point.multiplyScalar(1/3);
    const hit=world.sampler.sample(point.clone().add(new THREE.Vector3(0,0,2)),down,4);assert.ok(hit);assert.ok(hit.point.z>=point.z-.015,'repaired strip or higher visible ground supports the vehicle');repairedSamples++;
  }
}
assert.ok(world.groundMeshes.length>0&&world.report.groundTriangles>50000,'curbs and terrain have independent physical support');
// Sample the previously hidden hull. Only genuinely open spaces count; visible
// buildings may correctly replace portions that coincided with real walls.
const oldHull=new BarrierCollision();oldHull.addMesh(original.find(m=>m.name==='colmesh-2-mesh'));
const ghost=original.find(m=>m.name==='colmesh-2-mesh'),p=ghost.geometry.attributes.position,index=ghost.geometry.index;
let clearHullPassages=0;const a=new THREE.Vector3(),b=a.clone(),c=a.clone(),normal=a.clone(),point=a.clone();
for(let i=0;i<index.count&&clearHullPassages<8;i+=3*5){
  a.fromBufferAttribute(p,index.getX(i)).applyMatrix4(ghost.matrixWorld);b.fromBufferAttribute(p,index.getX(i+1)).applyMatrix4(ghost.matrixWorld);c.fromBufferAttribute(p,index.getX(i+2)).applyMatrix4(ghost.matrixWorld);
  normal.subVectors(b,a).cross(c.clone().sub(a)).normalize();if(Math.abs(normal.z)>.1)continue;
  point.copy(a).add(b).add(c).multiplyScalar(1/3);
  const hit=world.sampler.sample(new THREE.Vector3(point.x,point.y,40),down,80);if(!hit)continue;
  const from=hit.point.clone().addScaledVector(normal,5).toArray(),to=hit.point.clone().addScaledVector(normal,-5).toArray();
  if(!oldHull.sweep(createDynamicsState(0,VEHICLES.ferrari,new THREE.Vector3(...from)).position,new THREE.Quaternion(),new THREE.Vector3(...to).sub(new THREE.Vector3(...from)),VEHICLES.ferrari,.48))continue;
  if(Object.values(VEHICLES).every(v=>!drive(body,from,to,v).hit))clearHullPassages++;
}
assert.ok(clearHullPassages>=4,'old invisible hull passages are open for all four vehicles');
const report={...world.report,actualTrees,actualWalls,repairedSamples,clearHullPassages,syntheticWallTriangles:{before:grid.length,after:simple.length},roadContacts:15,exactVehicleTrajectories:4};
mkdirSync('artifacts/city-cleanup',{recursive:true});writeFileSync('artifacts/city-cleanup/verification.json',JSON.stringify(report,null,2));console.log(report);
