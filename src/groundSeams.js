import * as THREE from 'three';
import { SpatialIndex } from './spatialIndex.js';

const PRIMARY_ROLES = {
  'colmesh-1-mesh':'road','colmesh-1-mesh_2':'road','colmesh-1-mesh_7':'road',
  'colmesh-1-mesh_8':'road','colmesh-1-mesh_9':'road','colmesh-1-mesh_11':'pavement',
};
function role(mesh) {
  if(PRIMARY_ROLES[mesh.name])return PRIMARY_ROLES[mesh.name];
  const name=mesh.material?.name;
  if(name==='BAK_KERB_A-material')return 'curb';
  if(/^BAK_PAVEMENT_[ABC]-material$/.test(name)||name==='BAK_CONCRETE_A-material')return 'pavement';
  if(name==='BAK_GRASS_A-material'||/^BAK_TREE_BASE_[AB]-material$/.test(name))return 'terrain';
  return null;
}
const allowed=new Set(['curb:pavement','curb:road','curb:terrain','pavement:road']);
const vertexKey=p=>[p.x,p.y,p.z].map(v=>Math.round(v*1e4)).join(',');

// Stitch only short, parallel, uncovered road/curb/pavement boundary gaps.
// Endpoints retain each surface's height. This cannot fill a courtyard, doorway,
// distant terrain hole or the old race enclosure with an arbitrary global floor.
export async function groundSeams(meshes,sampler,{yieldFrame=async()=>{}}={}) {
  const boundaries=[],a=new THREE.Vector3(),b=a.clone(),c=a.clone(),normal=a.clone(),edge=a.clone();
  let yielded=performance.now();const pause=async()=>{if(performance.now()-yielded>20){await yieldFrame();yielded=performance.now();}};
  for(const mesh of meshes) {
    const kind=role(mesh);if(!kind)continue;
    const map=new Map(),p=mesh.geometry.attributes.position,index=mesh.geometry.index;
    const count=index?.count??p.count;
    for(let i=0;i<count;i+=3) {
      a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      normal.subVectors(b,a).cross(edge.subVectors(c,a));if(normal.lengthSq()<1e-12||Math.abs(normal.z)/normal.length()<.05)continue;
      const vs=[a,b,c];
      for(let j=0;j<3;j++){const x=vs[j],y=vs[(j+1)%3],kx=vertexKey(x),ky=vertexKey(y),key=kx<ky?`${kx}/${ky}`:`${ky}/${kx}`;
        if(map.has(key))map.get(key).count++;else map.set(key,{a:x.clone(),b:y.clone(),count:1});
      }
    }
    for(const e of map.values())if(e.count===1&&Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y)>.03)boundaries.push({...e,kind,id:boundaries.length,bounds:new THREE.Box3().setFromPoints([e.a,e.b])});
    await pause();
  }
  const index=new SpatialIndex(boundaries),query=new THREE.Box3(),candidates=[],faces=[];
  const intersects=bounds=>bounds.intersectsBox(query),down=new THREE.Vector3(0,0,-1);
  let pairs=0,maxWidth=0;
  for(const s of boundaries) {
    if(s.id%512===0)await pause();
    query.copy(s.bounds).expandByScalar(.51);index.query(intersects,candidates);
    const length=Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y),ux=(s.b.x-s.a.x)/length,uy=(s.b.y-s.a.y)/length;
    for(const t of candidates) {
      if(t.id<=s.id||!allowed.has([s.kind,t.kind].sort().join(':')))continue;
      const tLength=Math.hypot(t.b.x-t.a.x,t.b.y-t.a.y),alignment=((t.b.x-t.a.x)*ux+(t.b.y-t.a.y)*uy)/tLength;
      if(Math.abs(alignment)<.997)continue;
      const tc=(t.a.x-s.a.x)*ux+(t.a.y-s.a.y)*uy,td=(t.b.x-s.a.x)*ux+(t.b.y-s.a.y)*uy;
      const lo=Math.max(0,Math.min(tc,td)),hi=Math.min(length,Math.max(tc,td));if(hi-lo<.02)continue;
      const p1=s.a.clone().lerp(s.b,lo/length),p2=s.a.clone().lerp(s.b,hi/length);
      const q1=t.a.clone().lerp(t.b,(lo-tc)/(td-tc)),q2=t.a.clone().lerp(t.b,(hi-tc)/(td-tc));
      const w1=Math.hypot(p1.x-q1.x,p1.y-q1.y),w2=Math.hypot(p2.x-q2.x,p2.y-q2.y);
      if(Math.max(w1,w2)>.5||Math.min(w1,w2)<.0001||Math.max(Math.abs(p1.z-q1.z),Math.abs(p2.z-q2.z))>.25)continue;
      const center=p1.clone().add(p2).add(q1).add(q2).multiplyScalar(.25);
      const bottom=Math.min(p1.z,p2.z,q1.z,q2.z),top=Math.max(p1.z,p2.z,q1.z,q2.z);
      const hit=sampler.sample(new THREE.Vector3(center.x,center.y,top+.1),down,top-bottom+.14);
      if(hit&&hit.point.z>=bottom-.025)continue;
      const first=[p1,p2,q2],second=[p1,q2,q1];
      // Degenerate/crossing edge pairings are not support surfaces.
      const area=new THREE.Triangle(...first).getArea()+new THREE.Triangle(...second).getArea();
      if(area<1e-6||area>(hi-lo)*Math.max(w1,w2)*2+1e-5)continue;
      faces.push(first,second);pairs++;maxWidth=Math.max(maxWidth,w1,w2);
    }
  }
  return {faces,report:{boundaryEdges:boundaries.length,pairs,triangles:faces.length,maxWidth}};
}
