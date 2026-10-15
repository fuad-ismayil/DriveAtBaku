import * as THREE from 'three';
import atlas from './windowLightingAtlas.json' with {type:'json'};
import { RoomLightActivity } from './roomLightActivity.js';

function clipPolygon(polygon,axis,edge,greater){
  const result=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],insideA=greater?a[axis]>=edge:a[axis]<=edge,insideB=greater?b[axis]>=edge:b[axis]<=edge;
    if(insideA)result.push(a);
    if(insideA!==insideB){const t=(edge-a[axis])/(b[axis]-a[axis]);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
  }
  return result;
}

// Clip each window to the actual source triangles. A diagonal UV seam can split
// its geometry, but both pieces keep the same physical room ID and timer.
export function buildRoomLightGeometry(roots){
  const positions=[],uvs=[],ids=[],colors=[],roomKeys=new Map(),materials=new Set();
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const ta=new THREE.Vector2(),tb=new THREE.Vector2(),tc=new THREE.Vector2(),edge=new THREE.Vector3();
  for(const [asset,root]of roots){
    root.updateMatrixWorld(true);
    root.traverse(mesh=>{
      if(!mesh.isMesh||Array.isArray(mesh.material))return;
      const layoutId=atlas.bindings[`${asset}/${mesh.material.name}`],layout=atlas.layouts[layoutId];
      if(!layout?.rooms.length)return;
      materials.add(`${asset}/${mesh.material.name}`);
      const geometry=mesh.geometry,p=geometry.attributes.position,uv=geometry.attributes.uv,index=geometry.index;
      if(!uv)return;
      const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for(let i=0;i<(index?.count??p.count);i+=3){
        const vi=[0,1,2].map(j=>index?index.getX(i+j):i+j);
        a.fromBufferAttribute(p,vi[0]).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,vi[1]).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,vi[2]).applyMatrix4(mesh.matrixWorld);
        const normal=new THREE.Vector3().subVectors(b,a).cross(edge.subVectors(c,a));
        if(normal.lengthSq()<1e-10)continue;normal.normalize();if(Math.abs(normal.z)>.15)continue;
        if(geometry.attributes.normal){const authored=new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal,vi[0]).applyNormalMatrix(normalMatrix);if(normal.dot(authored)<0)normal.negate();}
        ta.fromBufferAttribute(uv,vi[0]);tb.fromBufferAttribute(uv,vi[1]);tc.fromBufferAttribute(uv,vi[2]);
        const det=(tb.y-tc.y)*(ta.x-tc.x)+(tc.x-tb.x)*(ta.y-tc.y);if(Math.abs(det)<1e-9)continue;
        const project=(u,v)=>{
          const wa=((tb.y-tc.y)*(u-tc.x)+(tc.x-tb.x)*(v-tc.y))/det,wb=((tc.y-ta.y)*(u-tc.x)+(ta.x-tc.x)*(v-tc.y))/det;
          return a.clone().multiplyScalar(wa).addScaledVector(b,wb).addScaledVector(c,1-wa-wb);
        };
        const minU=Math.min(ta.x,tb.x,tc.x),maxU=Math.max(ta.x,tb.x,tc.x),minV=Math.min(ta.y,tb.y,tc.y),maxV=Math.max(ta.y,tb.y,tc.y);
        if(maxU-minU>32||maxV-minV>32)continue;
        for(let tileU=Math.floor(minU);tileU<=Math.floor(maxU);tileU++)for(let tileV=Math.floor(minV);tileV<=Math.floor(maxV);tileV++){
          // The tower's curved side windows reuse its central glass atlas in a
          // separate authored UV band. Keep those sides; exclude the middle.
          if(layout.sourceVRange&&(tileV<layout.sourceVRange[0]||tileV>=layout.sourceVRange[1]))continue;
          for(const [left,top,right,bottom,ml,mt,mr,mb]of layout.rooms){
            const l=left+tileU,t=top+tileV,r=right+tileU,bot=bottom+tileV;
            if(r<=minU||l>=maxU||bot<=minV||t>=maxV)continue;
            const center=project((l+r)/2,(t+bot)/2),width=project(l,t).distanceTo(project(r,t)),height=project(l,t).distanceTo(project(l,bot));
            if(center.z<2.5||width<.3||width>8||height<.4||height>7||Math.abs(center.x)>3200||Math.abs(center.y)>3700)continue;
            let polygon=[[ta.x,ta.y],[tb.x,tb.y],[tc.x,tc.y]];
            polygon=clipPolygon(polygon,0,l,true);polygon=clipPolygon(polygon,0,r,false);
            polygon=clipPolygon(polygon,1,t,true);polygon=clipPolygon(polygon,1,bot,false);
            if(polygon.length<3)continue;
            const key=`${center.toArray().map(x=>Math.round(x*20)).join(',')}/${normal.toArray().map(x=>Math.round(x*10)).join(',')}`;
            let id=roomKeys.get(key);if(id===undefined){id=roomKeys.size;roomKeys.set(key,id);}
            // Stable variation in warmth and brightness, independent of activity.
            const warmth=(Math.sin(id*17.13+2)*43758.5453)%1,brightness=.72+Math.abs(warmth)*.65;
            const color=[brightness,brightness*(.64+Math.abs(warmth)*.14),brightness*(.32+Math.abs(warmth)*.15)];
            const vertex=point=>{
              const world=project(...point).addScaledVector(normal,.018);positions.push(...world.toArray());
              uvs.push(ml+(point[0]-l)/(r-l)*(mr-ml),mt+(point[1]-t)/(bot-t)*(mb-mt));
              ids.push(id);colors.push(...color);
            };
            for(let j=1;j<polygon.length-1;j++){vertex(polygon[0]);vertex(polygon[j]);vertex(polygon[j+1]);}
          }
        }
      }
    });
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('roomId',new THREE.Float32BufferAttribute(ids,1));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return {geometry,count:roomKeys.size,materials:materials.size};
}

export async function createRoomLights(roots){
  const {geometry,count,materials}=buildRoomLightGeometry(roots);
  const activity=new RoomLightActivity(count),width=256,height=Math.max(1,Math.ceil(count/width));
  const data=new Float32Array(width*height*4);data.set(activity.states);
  const states=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);states.needsUpdate=true;
  states.name='Independent room light states';
  let fullUploadPending=true;states.onUpdate=()=>{fullUploadPending=false;};
  const mask=await new THREE.TextureLoader().loadAsync(atlas.atlas);mask.flipY=false;mask.name='Audited window glass masks';
  const time={value:0};
  const material=new THREE.MeshBasicMaterial({name:'City occupied rooms',map:mask,vertexColors:true,transparent:true,
    blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:true});
  material.onBeforeCompile=shader=>{
    shader.uniforms.roomStates={value:states};shader.uniforms.roomTime=time;shader.uniforms.roomTextureSize={value:new THREE.Vector2(width,height)};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float roomId; varying float vRoomId;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvRoomId=roomId;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform sampler2D roomStates;uniform vec2 roomTextureSize;uniform float roomTime;varying float vRoomId;`)
      .replace('#include <map_fragment>',`#include <map_fragment>
        float id=floor(vRoomId+.5);
        vec4 room=texture2D(roomStates,(vec2(mod(id,roomTextureSize.x),floor(id/roomTextureSize.x))+.5)/roomTextureSize);
        float fade=smoothstep(0.0,1.0,(roomTime-room.b)/max(room.a,.01));
        diffuseColor.a*=mix(room.r,room.g,fade)*.55;
        if(diffuseColor.a<.004)discard;`);
  };
  material.customProgramCacheKey=()=> 'independent-city-room-lights-v1';
  const group=new THREE.Group();group.name='City independent room lights';group.visible=false;
  const mesh=new THREE.Mesh(geometry,material);mesh.name='City window light surfaces';mesh.renderOrder=2;group.add(mesh);
  return {group,activity,stats:{rooms:count,materials,triangles:geometry.attributes.position.count/3},
    setNight(enabled){activity.setNight(enabled);group.visible=Boolean(enabled);},
    update(dt){if(!activity.night)return;const changed=activity.update(dt);time.value=activity.time;
      if(changed.length){
        const unique=new Set(changed);
        if(states.updateRanges.length+unique.size>128){states.clearUpdateRanges();fullUploadPending=true;}
        for(const id of unique){data.set(activity.states.subarray(id*4,id*4+4),id*4);if(!fullUploadPending)states.addUpdateRange(id*4,4);}
        states.needsUpdate=true;
      }
    },
  };
}
