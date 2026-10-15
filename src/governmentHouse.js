import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFlagCloth } from './flagCloth.js';

// These five bindings belong exclusively to Government House in the supplied
// map. Preserve its measured footprint, real open loggias and carved silhouette.
export const GOVERNMENT_HOUSE_MATERIALS = new Set([
  'bak_building_high_19_a_01-material', 'bak_building_high_19_a_02-material',
  'bak_building_high_19_a_03-material', 'bak_building_high_19_f_01-material',
  'bak_building_high_19_f_03-material',
]);
export const GOVERNMENT_HOUSE_ORIGIN = [680.13, 630.01];
const angle = Math.atan2(.38, .925);
const across = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
const back = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0);

export function isGovernmentHouseMaterial(name) { return GOVERNMENT_HOUSE_MATERIALS.has(name); }

// Derive relief and glass masks from the existing photographic atlas. No
// external photograph is downloaded, redistributed or stretched over the model.
export function createLimestonePixels(pixels, width, height) {
  const output = new Uint8Array(width * height * 4);
  const luma = (x, y) => {
    const i = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    return (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255;
  };
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    // Limestone is warm; the photographed panes are cool neutral grey. Do not
    // classify dark brown arches, carved borders or doorways as reflective glass.
    const glass = smooth(3, 12, pixels[i + 2] - pixels[i]) * smooth(-6, 0, pixels[i + 1] - pixels[i]);
    const local = (luma(x - 3, y) + luma(x + 3, y) + luma(x, y - 3) + luma(x, y + 3)) / 4;
    output[i] = Math.round(255 * THREE.MathUtils.clamp(.5 + (luma(x, y) - local) * 1.1 * (1 - glass), .22, .78));
    output[i + 1] = Math.round(glass * 255);
    output[i + 2] = 0; output[i + 3] = 255;
  }
  return output;
}

function surfaceTexture(map) {
  const image = map.image, canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const texture = new THREE.DataTexture(createLimestonePixels(ctx.getImageData(0, 0, image.width, image.height).data,
    image.width, image.height), image.width, image.height);
  texture.name = 'Government House limestone relief and glass';
  texture.flipY = map.flipY; texture.wrapS = map.wrapS; texture.wrapT = map.wrapT;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = map.anisotropy;
  texture.needsUpdate = true;
  return texture;
}

const lightingShader = `
  varying vec3 vHousePosition;
  uniform float houseNight;
  uniform sampler2D houseSurface;
  float houseBeam(float position, float spacing, float width) {
    float d=abs(mod(position+spacing*.5,spacing)-spacing*.5);
    return exp(-d*d/(width*width));
  }
`;

function applyLimestone(material, texture, night) {
  if (material.userData.governmentHouse) return;
  material.userData.governmentHouse = true;
  material.roughness = .88; material.metalness = 0; material.envMapIntensity = .42;
  material.bumpMap = texture; material.bumpScale = .025;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.houseNight = night; shader.uniforms.houseSurface = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHousePosition;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 houseWorld=vec4(transformed,1.0);
        #ifdef USE_BATCHING
          houseWorld=batchingMatrix*houseWorld;
        #endif
        #ifdef USE_INSTANCING
          houseWorld=instanceMatrix*houseWorld;
        #endif
        vHousePosition=(modelMatrix*houseWorld).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${lightingShader}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 houseData=texture2D(houseSurface,vMapUv);
        float houseGlass=houseData.g;
        diffuseColor.rgb*=vec3(1.09,1.055,.99);
        diffuseColor.rgb=mix(diffuseColor.rgb,mix(diffuseColor.rgb,vec3(.048,.062,.067),.64),houseGlass);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,.29,houseGlass);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal=normalize(mix(normal,nonPerturbedNormal,houseGlass));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if(houseNight>.0) {
          vec2 houseDelta=vHousePosition.xy-vec2(${GOVERNMENT_HOUSE_ORIGIN.join(',')});
          vec3 hp=vec3(dot(houseDelta,vec2(${across.x},${across.y})),
            dot(houseDelta,vec2(${back.x},${back.y})),vHousePosition.z);
          vec3 wn=inverseTransformDirection(normal,viewMatrix);
          vec2 hn=vec2(dot(wn.xy,vec2(${across.x},${across.y})),dot(wn.xy,vec2(${back.x},${back.y})));
          float tower=smoothstep(22.0,27.0,abs(hp.x))*(1.0-smoothstep(46.0,51.0,abs(hp.x)));
          float level=hp.z<24.8?11.4:hp.z<36.7?24.8:36.7;
          float rise=max(0.0,hp.z-level);
          float vertical=1.0-abs(wn.z);
          float column=pow(abs(hn.x),3.0)*houseBeam(hp.y+33.1,5.55,1.0+rise*.09)
            +pow(abs(hn.y),3.0)*houseBeam(hp.x+44.4,5.55,1.0+rise*.09);
          float towerWash=tower*smoothstep(10.9,11.6,hp.z)*(.28+column*1.75)*exp(-rise*.052);
          float wallWash=(.18+houseBeam(hp.x,7.2,1.25+hp.z*.035)*.42)*exp(-max(0.0,hp.z-5.0)*.012);
          float cornice=exp(-pow((hp.z-24.85)/.24,2.0))+exp(-pow((hp.z-36.85)/.24,2.0))
            +exp(-pow((hp.z-43.65)/.35,2.0));
          float foundation=(1.0-smoothstep(7.0,11.4,hp.z))*houseBeam(hp.x,9.5,.85+hp.z*.16)*1.2;
          // The source atlas already records deep arch occlusion. Retain it in
          // the indirect wash, and keep roofs/terraces out of the facade flood.
          float stoneLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
          float recess=smoothstep(.025,.30,stoneLuma);
          float wash=(wallWash+towerWash+cornice*.58+foundation)*vertical*recess*(1.0-houseGlass);
          totalEmissiveRadiance+=diffuseColor.rgb*vec3(1.8,.85,.23)*wash*houseNight;
        }`);
  };
  material.customProgramCacheKey = () => `${key}:government-house-limestone-v1`;
  material.needsUpdate = true;
}

// Window positions come from the authored UV layout, not an invented grid on
// the building. Lift only the frames/sills; the original wall/glass UVs stay put.
const windowRects = [];
for (const [top, bottom] of [[88,120],[154,186],[220,253],[287,320]]) {
  for (let i = 0; i < 10; i++) windowRects.push([12+i*51,top,32+i*51,bottom]);
}
for (const [top, bottom] of [[574,598],[637,658],[696,718],[750,773]]) {
  for (let i = 0; i < 12; i++) windowRects.push([12+i*42.5,top,27+i*42.5,bottom]);
}

export function addGovernmentHouseWindowRelief(mesh, group) {
  const position = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv, index = mesh.geometry.index;
  const pieces = [], seen = new Set(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ta = new THREE.Vector2(), tb = new THREE.Vector2(), tc = new THREE.Vector2();
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const ids = [0,1,2].map(j => index ? index.getX(i+j) : i+j);
    a.fromBufferAttribute(position,ids[0]).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position,ids[1]).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position,ids[2]).applyMatrix4(mesh.matrixWorld);
    const normal = new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
    if (Math.abs(normal.z) > .03) continue;
    ta.fromBufferAttribute(uv,ids[0]); tb.fromBufferAttribute(uv,ids[1]); tc.fromBufferAttribute(uv,ids[2]);
    const determinant=(tb.y-tc.y)*(ta.x-tc.x)+(tc.x-tb.x)*(ta.y-tc.y);
    if (Math.abs(determinant)<1e-7) continue;
    const weights=(u,v)=>{
      const x=((tb.y-tc.y)*(u-tc.x)+(tc.x-tb.x)*(v-tc.y))/determinant;
      const y=((tc.y-ta.y)*(u-tc.x)+(ta.x-tc.x)*(v-tc.y))/determinant;
      return [x,y,1-x-y];
    };
    const project=(u,v)=>{const w=weights(u,v);return a.clone().multiplyScalar(w[0]).addScaledVector(b,w[1]).addScaledVector(c,w[2]);};
    const minU=Math.floor(Math.min(ta.x,tb.x,tc.x)),maxU=Math.floor(Math.max(ta.x,tb.x,tc.x));
    const minV=Math.floor(Math.min(ta.y,tb.y,tc.y)),maxV=Math.floor(Math.max(ta.y,tb.y,tc.y));
    for(let repeatU=minU;repeatU<=maxU;repeatU++)for(let repeatV=minV;repeatV<=maxV;repeatV++)
    for (const [left,top,right,bottom] of windowRects) {
      // GLTF's flipY=false preserves the atlas's top-to-bottom image rows.
      const u=(left+right)/1024+repeatU, v=(top+bottom)/2048+repeatV, w=weights(u,v);
      if(w.some(x=>x<-.00001)) continue;
      const center=project(u,v), leftPoint=project(left/512+repeatU,v), rightPoint=project(right/512+repeatU,v);
      const upper=project(u,top/1024+repeatV), lower=project(u,bottom/1024+repeatV);
      const width=leftPoint.distanceTo(rightPoint), height=upper.distanceTo(lower);
      if(width<.55||width>3.2||height<.7||height>4.5||center.z<4) continue;
      const key=center.toArray().map(x=>x.toFixed(2)).join(',');
      if(seen.has(key)) continue; seen.add(key);
      const horizontal=new THREE.Vector3().subVectors(rightPoint,leftPoint).normalize();
      const vertical=new THREE.Vector3().subVectors(upper,lower).normalize();
      // Correct winding from the measured face, including mirrored UV islands.
      const outward=mesh.geometry.attributes.normal
        ? new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal,ids[0])
          .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize() : normal.clone();
      if(new THREE.Vector3().crossVectors(horizontal,vertical).dot(outward)<0)horizontal.negate();
      const basis=new THREE.Matrix4().makeBasis(horizontal,vertical,outward);
      const box=(x,y,sx,sy,depth,offset)=>{
        const geometry=new THREE.BoxGeometry(sx,sy,depth);
        geometry.applyMatrix4(basis.clone().setPosition(center.clone().addScaledVector(horizontal,x)
          .addScaledVector(vertical,y).addScaledVector(outward,offset)));
        pieces.push(geometry);
      };
      box(-width/2-.055,0,.11,height+.22,.17,.075);
      box(width/2+.055,0,.11,height+.22,.17,.075);
      box(0,height/2+.065,width+.32,.13,.22,.095);
      box(0,-height/2-.085,width+.43,.17,.32,.145);
    }
  }
  if(!pieces.length) return 0;
  const geometry=mergeGeometries(pieces); for(const piece of pieces)piece.dispose();
  const material=new THREE.MeshStandardMaterial({name:'Government House building carved limestone surrounds',color:0xbab09a,roughness:.9});
  const frames=new THREE.Mesh(geometry,material);frames.name='Government House window jambs and projecting sills';
  frames.castShadow=true;frames.receiveShadow=true;group.add(frames);
  return seen.size;
}

function createFlag() {
  const group=new THREE.Group(); group.name='Government House Azerbaijan flag';
  group.position.set(...GOVERNMENT_HOUSE_ORIGIN,0);group.rotation.z=angle;
  const poleMaterial=new THREE.MeshStandardMaterial({name:'Government House flagpole',color:0xa9adb0,metalness:.65,roughness:.4});
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.075,.14,36,12).rotateX(Math.PI/2),poleMaterial);
  pole.position.set(-.6,-32.5,35.0);pole.castShadow=true;group.add(pole);
  const finial=new THREE.Mesh(new THREE.SphereGeometry(.19,10,8),poleMaterial);finial.position.set(-.6,-32.5,53.1);group.add(finial);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const ctx=canvas.getContext('2d');
  for(const [i,color]of ['#00b5e2','#ef3340','#509e2f'].entries()){ctx.fillStyle=color;ctx.fillRect(0,i*256/3,512,256/3+1);}
  ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(238,128,29,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ef3340';ctx.beginPath();ctx.arc(247,128,24,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ffffff';ctx.beginPath();
  for(let i=0;i<16;i++){const a=-Math.PI/2+i*Math.PI/8,r=i%2?8:17;const x=278+Math.cos(a)*r,y=128+Math.sin(a)*r;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.closePath();ctx.fill();
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshStandardMaterial({name:'Government House Azerbaijan flag fabric',map,side:THREE.DoubleSide,roughness:.94});
  const cloth=createFlagCloth();
  const flag=new THREE.Mesh(cloth.geometry,material);flag.name='Government House simulated flag cloth';
  flag.position.set(-.6,-32.5,52.7);flag.castShadow=true;
  flag.userData.deformationBounds=cloth.bounds;group.add(flag);
  return {group,update:cloth.update};
}

export function createGovernmentHouse(root) {
  root.updateMatrixWorld(true);
  const night={value:0}, textures=new Map(), materials=new Set(), details=new THREE.Group();
  details.name='Government House architectural details';
  let windowCount=0;
  root.traverse(mesh=>{
    if(!mesh.isMesh||!isGovernmentHouseMaterial(mesh.material?.name)) return;
    const material=mesh.material;
    if(/_03-material$/.test(material.name)) return; // Authored perforated parapets.
    if(!materials.has(material)) {
      let texture=textures.get(material.map);
      if(!texture){texture=surfaceTexture(material.map);textures.set(material.map,texture);}
      applyLimestone(material,texture,night);materials.add(material);
    }
    if(material.name==='bak_building_high_19_a_02-material')windowCount+=addGovernmentHouseWindowRelief(mesh,details);
  });
  // Window details are built in world coordinates; this source scene is identity.
  root.add(details);
  const flag=createFlag();root.add(flag.group);
  const fabric=flag.group.children.find(child=>child.material?.name==='Government House Azerbaijan flag fabric').material;
  const frameMaterial=details.children[0]?.material;
  return {
    stats:{materials:materials.size,textures:textures.size,windows:windowCount},
    get nightEnabled(){return night.value===1;},
    setNight(enabled){
      night.value=enabled?1:0;
      // The fabric is lit by the site's flag floodlight only after dusk.
      fabric.emissive.set(0xffffff);fabric.emissiveMap=fabric.map;fabric.emissiveIntensity=enabled?.16:0;
      if(frameMaterial){frameMaterial.emissive.set(0xffb956);frameMaterial.emissiveIntensity=enabled?.18:0;}
    },
    update(dt){flag.update(dt);},
  };
}
