import * as THREE from 'three';
import { SpatialIndex } from './spatialIndex.js';

// Continuous circle-versus-convex-footprint queries. No per-tree render mesh,
// BVH or canopy box: a trunk is one finite vertical cylinder in a static index.
export class CylinderCollision {
  constructor() {
    this.entries = []; this.index = null; this.query = new THREE.Box3(); this.candidates = [];
    this.points = Array.from({length:8},()=>new THREE.Vector2()); this.sorted = [...this.points]; this.hull = [];
    this.intersects = bounds => bounds.intersectsBox(this.query);
    this.normal = new THREE.Vector3();
  }
  add({ x,y,bottom,top,radius }) {
    this.entries.push({x,y,bottom,top,radius,bounds:new THREE.Box3(
      new THREE.Vector3(x-radius,y-radius,bottom),new THREE.Vector3(x+radius,y+radius,top))});
    this.index = null;
  }
  sweep(center,half,axes,worldHalf,travel,query,angularMargin=0) {
    if(!this.entries.length)return null;
    this.query.copy(query); this.index ??= new SpatialIndex(this.entries);
    this.index.query(this.intersects,this.candidates); if(!this.candidates.length)return null;
    for(let i=0;i<8;i++) {
      const p=this.points[i];p.set(center.x,center.y);
      for(let j=0;j<3;j++) { const extent=half.getComponent(j)*(i&(1<<j)?1:-1);p.x+=axes[j].x*extent;p.y+=axes[j].y*extent; }
    }
    this.sorted.sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const hull=this.hull;hull.length=0;
    for(const p of this.sorted){while(hull.length>=2&&cross(hull.at(-2),hull.at(-1),p)<=1e-10)hull.pop();hull.push(p);}
    const lower=hull.length;
    for(let i=this.sorted.length-2;i>=0;i--){const p=this.sorted[i];while(hull.length>lower&&cross(hull.at(-2),hull.at(-1),p)<=1e-10)hull.pop();hull.push(p);}hull.pop();
    let bestTime=Infinity,bestDepth=0;
    for(const trunk of this.candidates) {
      let first=0,last=1;
      const low=center.z-worldHalf.z,high=center.z+worldHalf.z;
      if(Math.abs(travel.z)<1e-10){if(high<trunk.bottom||low>trunk.top)continue;}
      else {const a=(trunk.bottom-high)/travel.z,b=(trunk.top-low)/travel.z;first=Math.max(0,Math.min(a,b));last=Math.min(1,Math.max(a,b));if(first>last)continue;}
      const vx=-travel.x,vy=-travel.y,px=trunk.x+vx*first,py=trunk.y+vy*first;
      let inside=true,edgeDepth=Infinity,insideNX=0,insideNY=0,closest=Infinity,closestX=0,closestY=0;
      for(let i=0;i<hull.length;i++) {
        const a=hull[i],b=hull[(i+1)%hull.length],ex=b.x-a.x,ey=b.y-a.y,len=Math.hypot(ex,ey);
        if(len<1e-9)continue;
        const nx=ey/len,ny=-ex/len,signed=(px-a.x)*nx+(py-a.y)*ny;
        if(signed>0)inside=false;
        if(trunk.radius-signed<edgeDepth){edgeDepth=trunk.radius-signed;insideNX=-nx;insideNY=-ny;}
        const t=THREE.MathUtils.clamp(((px-a.x)*ex+(py-a.y)*ey)/(len*len),0,1),qx=a.x+ex*t,qy=a.y+ey*t;
        const distance=Math.hypot(px-qx,py-qy);if(distance<closest){closest=distance;closestX=qx;closestY=qy;}
      }
      let depth=inside?edgeDepth:trunk.radius-closest;
      if(inside||depth>0) {
        const nx=inside?insideNX:(closestX-px)/Math.max(closest,1e-12),ny=inside?insideNY:(closestY-py)/Math.max(closest,1e-12);
        if(!(first===0&&nx*travel.x+ny*travel.y>=-1e-9&&depth<=.05&&angularMargin===0)
          &&(first<bestTime||(first===bestTime&&depth>bestDepth))){bestTime=first;bestDepth=depth;this.normal.set(nx,ny,0);}
        continue;
      }
      for(let i=0;i<hull.length;i++) {
        const a=hull[i],b=hull[(i+1)%hull.length],ex=b.x-a.x,ey=b.y-a.y,len=Math.hypot(ex,ey);
        if(len<1e-9)continue;
        const nx=ey/len,ny=-ex/len,rate=vx*nx+vy*ny;
        if(rate<-1e-10) {
          const t=(trunk.radius-(trunk.x-a.x)*nx-(trunk.y-a.y)*ny)/rate;
          const along=((trunk.x+vx*t-a.x)*ex+(trunk.y+vy*t-a.y)*ey)/len;
          if(t>=first-1e-10&&t<=last&&along>=0&&along<=len&&t<bestTime){bestTime=Math.max(first,t);bestDepth=0;this.normal.set(-nx,-ny,0);}
        }
        const dx=trunk.x-a.x,dy=trunk.y-a.y,A=vx*vx+vy*vy,B=2*(dx*vx+dy*vy),C=dx*dx+dy*dy-trunk.radius**2;
        const discriminant=B*B-4*A*C;
        if(A>1e-12&&discriminant>=0) {
          const t=(-B-Math.sqrt(discriminant))/(2*A);
          if(t>=first-1e-10&&t<=last&&t<bestTime){bestTime=Math.max(first,t);bestDepth=0;this.normal.set(a.x-trunk.x-vx*t,a.y-trunk.y-vy*t,0).normalize();}
        }
      }
    }
    return bestTime===Infinity?null:{time:bestTime,depth:bestDepth,normal:this.normal};
  }
}
