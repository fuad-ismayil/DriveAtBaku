import * as THREE from 'three';

// Weld only collision positions (0.1 mm). Authored visual buffers are untouched.
// Internal coplanar edges disappear; concave outlines and openings remain. If a
// group is non-manifold or its area changes, retain its original triangles.
export function simplifyCoplanarTriangles(triangles) {
  const planes=new Map(),edge=new THREE.Vector3(),normal=new THREE.Vector3();
  const origin=triangles[0]?.[0]??new THREE.Vector3(),relative=new THREE.Vector3();
  for(const triangle of triangles) {
    const [a,b,c]=triangle;normal.subVectors(b,a).cross(edge.subVectors(c,a));const area=normal.length()/2;
    if(area<1e-8)continue;normal.normalize();
    const dominant=Math.abs(normal.x)>=Math.abs(normal.y)&&Math.abs(normal.x)>=Math.abs(normal.z)?0:Math.abs(normal.y)>=Math.abs(normal.z)?1:2;
    if(normal.getComponent(dominant)<0)normal.negate();
    const key=[normal.x*1e3,normal.y*1e3,normal.z*1e3,normal.dot(relative.subVectors(a,origin))*200].map(Math.round).join(',');
    if(!planes.has(key))planes.set(key,{normal:normal.clone(),point:a,triangles:[],area:0});
    const group=planes.get(key);group.triangles.push(triangle);group.area+=area;
  }
  const output=[];
  for(const group of planes.values()) {
    if(group.triangles.length<3){output.push(...group.triangles);continue;}
    if(group.triangles.some(t=>t.some(p=>Math.abs(group.normal.dot(relative.subVectors(p,group.point)))>.002))){output.push(...group.triangles);continue;}
    const ids=new Map(),points=[],edges=new Map(),duplicates=new Set();let uniqueArea=0;
    const vertex=p=>{const key=[p.x,p.y,p.z].map(v=>Math.round(v*1e4)).join(',');if(!ids.has(key)){ids.set(key,points.length);points.push(p);}return ids.get(key);};
    for(const triangle of group.triangles) {
      const vi=triangle.map(vertex),key=[...vi].sort((a,b)=>a-b).join(',');if(duplicates.has(key))continue;duplicates.add(key);
      uniqueArea+=new THREE.Triangle(...triangle).getArea();
      for(let i=0;i<3;i++){const a=vi[i],b=vi[(i+1)%3],k=a<b?`${a},${b}`:`${b},${a}`;const e=edges.get(k)??{a,b,n:0};e.n++;edges.set(k,e);}
    }
    const adjacency=new Map();let safe=true;
    for(const e of edges.values()) {
      if(e.n>2){safe=false;break;}if(e.n!==1)continue;
      for(const [a,b]of[[e.a,e.b],[e.b,e.a]]){if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a).push(b);}
    }
    if(!safe||!adjacency.size||[...adjacency.values()].some(a=>a.length!==2)){output.push(...group.triangles);continue;}
    const u=new THREE.Vector3(0,0,1).cross(group.normal).normalize(),v=new THREE.Vector3().crossVectors(group.normal,u);
    const projected=points.map(p=>new THREE.Vector2(p.dot(u),p.dot(v))),visited=new Set(),loops=[];
    for(const start of adjacency.keys()) {
      if(visited.has(start))continue;const loop=[];let previous=-1,current=start;
      do{if(visited.has(current)){safe=false;break;}visited.add(current);loop.push(current);const next=adjacency.get(current).find(x=>x!==previous);previous=current;current=next;}while(current!==start);
      if(!safe)break;
      // Remove collinear vertices only; this cannot bridge a real opening.
      let changed=true;while(changed&&loop.length>3){changed=false;for(let i=0;i<loop.length;i++){
        const a=projected[loop[(i+loop.length-1)%loop.length]],b=projected[loop[i]],c=projected[loop[(i+1)%loop.length]];
        const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
        if(Math.abs(cross)<1e-7 && (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)>=0){loop.splice(i,1);changed=true;break;}
      }}
      loops.push(loop);
    }
    if(!safe){output.push(...group.triangles);continue;}
    const contains=(loop,p)=>{let inside=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){
      const a=projected[loop[i]],b=projected[loop[j]];
      if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }return inside;};
    const depth=loops.map((loop,i)=>loops.reduce((n,other,j)=>n+(i!==j&&contains(other,projected[loop[0]])?1:0),0));
    const candidate=[];
    for(let i=0;i<loops.length;i++) {
      if(depth[i]%2)continue;
      const holes=loops.filter((loop,j)=>depth[j]===depth[i]+1&&contains(loops[i],projected[loop[0]]));
      const order=[...loops[i],...holes.flat()];
      for(const face of THREE.ShapeUtils.triangulateShape(loops[i].map(id=>projected[id]),holes.map(loop=>loop.map(id=>projected[id])))) {
        candidate.push(face.map(id=>points[order[id]]));
      }
    }
    const area=candidate.reduce((s,t)=>s+new THREE.Triangle(...t).getArea(),0);
    if(candidate.length && candidate.length<group.triangles.length&&Math.abs(area-uniqueArea)<Math.max(1e-5,uniqueArea*1e-6))output.push(...candidate);
    else output.push(...group.triangles);
  }
  return output;
}

export function collisionMesh(triangles,name='city collision') {
  const positions=[],indices=[],vertices=new Map();
  for(const triangle of triangles)for(const p of triangle){const key=[p.x,p.y,p.z].map(v=>Math.round(v*1e4)).join(',');if(!vertices.has(key)){vertices.set(key,positions.length/3);positions.push(p.x,p.y,p.z);}indices.push(vertices.get(key));}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({name,side:THREE.DoubleSide}));mesh.name=name;mesh.visible=false;mesh.updateMatrixWorld(true);
  return mesh;
}

export function treeTrunks(mesh) {
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index,parents=new Int32Array(p.count);
  for(let i=0;i<p.count;i++)parents[i]=i;
  const root=i=>{while(i!==parents[i]){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  for(let i=0;i<index.count;i+=3){const a=root(index.getX(i));parents[root(index.getX(i+1))]=a;parents[root(index.getX(i+2))]=a;}
  const components=new Map(),world=new THREE.Vector3();
  for(let i=0;i<p.count;i++){const id=root(i);if(!components.has(id))components.set(id,[]);components.get(id).push(world.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).clone());}
  const trunks=[],cells=new Map();
  for(const points of components.values()) {
    const min=Math.min(...points.map(p=>p.z)),max=Math.max(...points.map(p=>p.z));if(max-min<1)continue;
    const bottom=[...points].sort((a,b)=>a.z-b.z).slice(0,2);if(bottom.length<2)continue;
    const center=new THREE.Vector3();for(const p of bottom)center.add(p);center.multiplyScalar(1/bottom.length);
    let width=0;for(const a of bottom)for(const b of bottom)width=Math.max(width,a.distanceTo(b));
    const cellX=Math.floor(center.x/.1),cellY=Math.floor(center.y/.1);let duplicate=false;
    for(let x=cellX-1;x<=cellX+1;x++)for(let y=cellY-1;y<=cellY+1;y++)for(const t of cells.get(`${x},${y}`)??[]) {
      if(Math.hypot(t.x-center.x,t.y-center.y)<.05&&Math.abs(t.bottom-center.z)<.05){duplicate=true;break;}
    }
    if(duplicate)continue;
    // The audited TREEF atlas has a trunk about 3.6% of billboard width at its
    // base; bare trunk occupies the bottom third. Leaves/branches never collide.
    const trunk={x:center.x,y:center.y,bottom:center.z,top:center.z+Math.min(4.5,(max-min)*.33),radius:THREE.MathUtils.clamp(width*.018,.08,.45)};
    trunks.push(trunk);const key=`${cellX},${cellY}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(trunk);
  }
  return trunks;
}
