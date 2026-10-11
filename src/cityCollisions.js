import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { GroundSampler, LayeredGroundSampler, InlayGroundSampler } from './groundSampler.js';
import { collisionMesh, simplifyCoplanarTriangles, treeTrunks } from './collisionGeometry.js';
import { additionalGroundKind } from './mapSurfaces.js';
import { groundSeams } from './groundSeams.js';

const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),edge=new THREE.Vector3(),normal=new THREE.Vector3();
const down=new THREE.Vector3(0,0,-1);
const buildingSurface=/building|window|glass|(?:^|_)feature_\d|(?:^|_)wall_\d/i;
function triangle(mesh,offset) {
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  a.fromBufferAttribute(p,index?index.getX(offset):offset).applyMatrix4(mesh.matrixWorld);
  b.fromBufferAttribute(p,index?index.getX(offset+1):offset+1).applyMatrix4(mesh.matrixWorld);
  c.fromBufferAttribute(p,index?index.getX(offset+2):offset+2).applyMatrix4(mesh.matrixWorld);
  normal.subVectors(b,a).cross(edge.subVectors(c,a));
}
function prepare(mesh) { mesh.geometry.boundsTree=new MeshBVH(mesh.geometry,{indirect:true,targetLeafSize:20});mesh.raycast=acceleratedRaycast;return mesh; }

export async function buildCityCollisions(roots,primaryMeshes,body,{repairSources=[],yieldFrame=async()=>{}}={}) {
  const started=performance.now(),report={trunks:0,wallInputTriangles:0,wallTriangles:0,wallMeshes:0,wallMaterials:0,repairTriangles:0,repairSources:0,groundTriangles:0,groundMeshes:0,groundMaterials:[],milliseconds:0};
  const visual=[];for(const root of roots){root.updateMatrixWorld(true);root.traverse(o=>{if(o.isMesh&&!Array.isArray(o.material))visual.push(o);});}
  for(const mesh of primaryMeshes){if(!mesh.geometry.boundsTree)prepare(mesh);mesh.raycast=acceleratedRaycast;}
  const primary=new GroundSampler(primaryMeshes),groundMeshes=[],groundBuckets=new Map();
  let yielded=performance.now();
  const pause=async()=>{if(performance.now()-yielded>20){await yieldFrame();yielded=performance.now();}};
  // Contact follows the actual visible curb, paving and terrain triangles. Keep
  // them in small spatial BVHs rather than querying kilometre-wide material
  // meshes per wheel. No extra rendering, canopy collision or global plane.
  for(const mesh of visual) {
    const kind=additionalGroundKind(mesh.material.name);if(!kind)continue;
    const count=mesh.geometry.index?.count??mesh.geometry.attributes.position.count;let triangles=0;
    for(let i=0;i<count;i+=3){
      if(i%(3*512)===0&&performance.now()-yielded>20)await pause();
      triangle(mesh,i);if(normal.lengthSq()<1e-12||Math.abs(normal.z)/normal.length()<.05)continue;
      const key=`${kind}:${Math.floor((a.x+b.x+c.x)/768)},${Math.floor((a.y+b.y+c.y)/768)}`;
      const face=[a.clone(),b.clone(),c.clone()];
      if(kind==='roadpaint')for(const p of face){
        const backing=primary.sample(p.clone().add(new THREE.Vector3(0,0,.3)),down,.6);
        if(backing&&Math.abs(backing.point.z-p.z)<.25)p.z=backing.point.z;
      }
      if(!groundBuckets.has(key))groundBuckets.set(key,{kind,faces:[]});groundBuckets.get(key).faces.push(face);triangles++;
    }
    if(triangles)report.groundMaterials.push({name:mesh.material.name,triangles});
    await pause();
  }
  for(const [key,{kind,faces}]of groundBuckets){const mesh=prepare(collisionMesh(faces,`city ground ${key}`));mesh.userData.groundSurfaceKind=kind;groundMeshes.push(mesh);report.groundTriangles+=faces.length;await pause();}
  report.groundMeshes=groundMeshes.length;
  const heights=new GroundSampler(groundMeshes.filter(m=>m.userData.groundSurfaceKind!=='roadpaint'));
  const inlays=new GroundSampler(groundMeshes.filter(m=>m.userData.groundSurfaceKind==='roadpaint')),heightCache=new Map();
  const edgeRepairs=await groundSeams([...primaryMeshes,...visual],new InlayGroundSampler(new LayeredGroundSampler(primary,heights),inlays),{yieldFrame});
  const seamMeshes=[];
  if(edgeRepairs.faces.length){const mesh=prepare(collisionMesh(edgeRepairs.faces,'city curb seam support'));seamMeshes.push(mesh);}
  const seamGround=new GroundSampler(seamMeshes);report.seams=edgeRepairs.report;
  const streetHeight=(x,y)=>{
    const key=`${Math.floor(x/4)},${Math.floor(y/4)}`;
    if(!heightCache.has(key)){
      const from=new THREE.Vector3(x,y,500);
      heightCache.set(key,(primary.sample(from,down,600)??heights.sample(from,down,600)??inlays.sample(from,down,600))?.point.z??null);
    }
    return heightCache.get(key);
  };
  const wallBuckets=new Map(),trunks=[];
  for(const mesh of visual) {
    if(mesh.material.name==='TREEC-material') {
      for(const trunk of treeTrunks(mesh)){body.addCylinder(trunk);trunks.push(trunk);}continue;
    }
    // Alpha cards (railings/decorations), roofs, trees, lights and background
    // horizon billboards cannot become invisible wall boxes.
    const glazing=/window|glass/i.test(mesh.material.name);
    if(!mesh.visible||!mesh.material.visible||!buildingSurface.test(mesh.material.name)
      ||(!glazing&&(mesh.material.alphaTest>0||mesh.material.transparent))||/light|dist_horizon/i.test(mesh.material.name))continue;
    const faces=[],count=mesh.geometry.index?.count??mesh.geometry.attributes.position.count;
    for(let i=0;i<count;i+=3) {
      if(i%(3*512)===0&&performance.now()-yielded>20)await pause();
      triangle(mesh,i);const area=normal.length()/2;
      if(area<.002||Math.abs(normal.z)/normal.length()>=.65)continue;
      const z=Math.min(a.z,b.z,c.z);
      const lowest=a.z<=b.z&&a.z<=c.z?a:b.z<=c.z?b:c;
      const ground=streetHeight(lowest.x,lowest.y);
      // Preserve complete facade triangles that meet the car-height band. Tall
      // base walls stay tall; unrelated upper-story trim needs no collider.
      if(ground!==null&&(z>ground+4.5||Math.max(a.z,b.z,c.z)<ground+.1))continue;
      faces.push([a.clone(),b.clone(),c.clone()]);
    }
    if(!faces.length)continue;report.wallMaterials++;report.wallInputTriangles+=faces.length;
    for(const face of simplifyCoplanarTriangles(faces)) {
      const x=(face[0].x+face[1].x+face[2].x)/3,y=(face[0].y+face[1].y+face[2].y)/3;
      const key=`${Math.floor(x/96)},${Math.floor(y/96)}`;if(!wallBuckets.has(key))wallBuckets.set(key,[]);wallBuckets.get(key).push(face);
    }
    await pause();
  }
  const walls=[];
  for(const [key,faces]of wallBuckets){const mesh=collisionMesh(faces,`city walls ${key}`);body.addMesh(mesh);walls.push(mesh);report.wallTriangles+=faces.length;await pause();}
  report.trunks=trunks.length;report.wallMeshes=walls.length;

  // Removing a raised racing strip can expose an authored gap below it. Fill
  // only absent support within that old footprint, using adjacent road planes.
  // Existing roads, their UVs and their collision indices remain untouched.
  const repairs=[],roadRoot=roots[0],asphalt=visual.find(m=>m.material.name==='ROADA_MAIN-material')?.material;
  const authoredGround=new LayeredGroundSampler(primary,heights);
  const closest={point:new THREE.Vector3()},local=new THREE.Vector3(),point=new THREE.Vector3();
  const sourceEntries=primaryMeshes.map(mesh=>({mesh,inverse:mesh.matrixWorld.clone().invert()}));
  const repairedHeights=new Map();
  const roadPlane=(p)=> {
    let best=Infinity,plane=null;
    for(const entry of sourceEntries){local.copy(p).applyMatrix4(entry.inverse);const hit=entry.mesh.geometry.boundsTree.closestPointToPoint(local,closest,0,8);
      if(!hit||hit.distance>=best||hit.distance>8)continue;
      triangle(entry.mesh,hit.faceIndex*3);if(Math.abs(normal.z)/normal.length()<.55)continue;
      best=hit.distance;plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal.clone().normalize(),a);
    }return plane;
  };
  for(const source of repairSources) {
    const faces=[],count=source.geometry.index.count;
    for(let i=0;i<count;i+=3) {
      triangle(source,i);if(normal.lengthSq()<1e-10||Math.abs(normal.z)/normal.length()<.55)continue;
      point.copy(a).add(b).add(c).multiplyScalar(1/3);
      if(primary.sample(point.clone().add(new THREE.Vector3(0,0,3)),down,6))continue;
      const face=[a.clone(),b.clone(),c.clone()],reference=roadPlane(point);if(!reference)continue;
      const level=-(reference.normal.x*point.x+reference.normal.y*point.y+reference.constant)/reference.normal.z;
      const existing=authoredGround.sample(point.clone().add(new THREE.Vector3(0,0,3)),down,6);
      // Real paving/soil exposed by removing a race curb keeps its own geometry
      // and artwork. Do not place replacement asphalt over an existing curb.
      if(existing&&Math.abs(existing.point.z-level)<.4)continue;
      let supported=true;
      for(const p of face){
        const key=[p.x,p.y].map(v=>Math.round(v*1e4)).join(',');
        if(!repairedHeights.has(key)){
          const hit=primary.sample(p.clone().add(new THREE.Vector3(0,0,3)),down,10);
          const plane=hit?null:roadPlane(p);
          repairedHeights.set(key,hit?.point.z??(plane&&Math.abs(plane.normal.z)>.55?-(plane.normal.x*p.x+plane.normal.y*p.y+plane.constant)/plane.normal.z:null));
        }
        const z=repairedHeights.get(key);if(z===null){supported=false;break;}p.z=z;
      }
      if(!supported)continue;
      faces.push(face);
    }
    if(faces.length&&asphalt){
      const repaired=collisionMesh(simplifyCoplanarTriangles(faces),`city road repair ${source.name}`);
      repaired.material.dispose();repaired.material=asphalt;repaired.visible=true;
      repaired.geometry.computeVertexNormals();const positions=repaired.geometry.attributes.position;
      const uv=new Float32Array(positions.count*2);for(let i=0;i<positions.count;i++){uv[i*2]=positions.getX(i)/8;uv[i*2+1]=positions.getY(i)/8;}
      repaired.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
      // Rendering and ground queries own independent geometry, so draw-range
      // culling and static batch staging disposal cannot affect road contact.
      const ground=new THREE.Mesh(repaired.geometry.clone(),new THREE.MeshBasicMaterial({name:'city repaired asphalt',side:THREE.DoubleSide}));ground.visible=false;ground.updateMatrixWorld(true);prepare(ground);repairs.push(ground);
      roadRoot.add(repaired);report.repairTriangles+=ground.geometry.index.count/3;report.repairSources++;
    }
    source.geometry.dispose();source.material.dispose();await pause();
  }
  const repairedGround=new GroundSampler(repairs);
  const sampler=new InlayGroundSampler(new LayeredGroundSampler(primary,repairedGround,heights,seamGround),inlays);
  report.milliseconds=performance.now()-started;
  return {sampler,report,trunks,walls,repairs,groundMeshes,seamMeshes};
}
