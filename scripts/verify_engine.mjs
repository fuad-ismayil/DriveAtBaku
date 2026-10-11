import assert from 'node:assert/strict';
import { renderingSize, normalizeRenderingResolution } from '../src/renderingResolution.js';
import { GpuTimer } from '../src/gpuTimer.js';
import { summarizeFrames } from './lib/performanceMetrics.mjs';
import * as THREE from 'three';
import { SpatialIndex } from '../src/spatialIndex.js';
import { StreetSMAAPass } from '../src/streetSMAAPass.js';
import { StreetBloomPass } from '../src/streetBloomPass.js';
import { createTireEffects } from '../src/tireEffects.js';
for (const dpr of [1, 1.25, 1.5, 2]) for (const scale of [1, 1.25, 1.5]) {
  const native = renderingSize(1920,1080,dpr,1.5,scale,'native');
  assert.equal(native.bufferWidth, Math.floor(1920*Math.min(dpr,1.5)*scale));
  for (const [resolution,width,height] of [['1920x1080',1920,1080],['1600x900',1600,900],['1280x720',1280,720]]) {
    const fixed = renderingSize(1920,1080,dpr,1.5,scale,resolution);
    assert.equal(fixed.bufferWidth,width);assert.equal(fixed.bufferHeight,height);
  }
}
for (const [width,height] of [[1920,947],[2560,1080],[390,844],[1280,720]]) {
  const fixed = renderingSize(width,height,2,2,1.5,'1280x720');
  assert.ok(fixed.bufferWidth<=1280 && fixed.bufferHeight<=720);
  assert.ok(Math.abs(fixed.bufferWidth/fixed.bufferHeight-width/height) < .005);
}
assert.equal(normalizeRenderingResolution('junk'),'native');
function mockGL(supported=true) {
  return { QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,disjoint:false,lost:false,available:false,deleted:[],active:null,
    getExtension:()=>supported?{TIME_ELAPSED_EXT:3,GPU_DISJOINT_EXT:4}:null,
    createQuery:()=>({}),beginQuery(target,q){assert.equal(this.active,null,'no nested queries');this.active=q;},
    endQuery(){this.active=null;},isContextLost(){return this.lost;},
    getParameter(){return this.disjoint;},getQueryParameter(q,key){return key===1?this.available:1200000;},
    deleteQuery(q){this.deleted.push(q);} };
}
const gl=mockGL(),timer=new GpuTimer(gl,{maxPending:2}),a={},b={};
assert.ok(timer.begin('beauty',a));assert.equal(timer.begin('nested',a),false);timer.end();timer.poll();
assert.equal(a.gpu,undefined,'pending never appears as a GPU time');
timer.begin('shadows',b);timer.end();assert.equal(timer.begin('overload',{}),false);
gl.available=true;timer.poll();assert.equal(a.gpu.beauty,1.2);assert.equal(b.gpu.shadows,1.2);assert.equal(a.pending,0);
const overflow={};gl.available=false;timer.begin('one',{});timer.end();timer.begin('two',{});timer.end();assert.equal(timer.begin('overflow',overflow),false);assert.equal(overflow.gpuInvalid,true);gl.available=true;timer.poll();
gl.available=false;timer.begin('frame',a);timer.end();timer.begin('frame',b);timer.end();gl.disjoint=true;timer.poll();
assert.ok(a.gpuInvalid && b.gpuInvalid,'disjoint discards unavailable queries too');assert.equal(timer.pending.length,0);
assert.equal(timer.stats.disjoint,1);gl.disjoint=false;gl.lost=true;assert.equal(timer.begin('lost',{}),false);
assert.equal(new GpuTimer(mockGL(false)).begin('unsupported',{}),false);timer.dispose();
const rows=Array.from({length:100},()=>({interval:10,cpu:3,pending:0,gpu:{frame:4}}));rows[99].interval=100;
const summary=summarizeFrames(rows);assert.equal(summary.gpuValidFrames,100);assert.equal(summary.metrics.gpu.median,4);
assert.equal(summary.fps.onePercentLow,10);assert.equal(summary.metrics.interval.p99,10);assert.equal(summary.stutters.over50ms,1);
let seed=41;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const entries=Array.from({length:2000},(_,id)=>{const min=new THREE.Vector3(random()*600-300,random()*600-300,random()*80-40);return{id,bounds:new THREE.Box3(min,min.clone().addScalar(random()*40))};});
const index=new SpatialIndex(entries),camera=new THREE.PerspectiveCamera(62,16/9,.1,300),frustum=new THREE.Frustum(),matrix=new THREE.Matrix4();
for(let i=0;i<100;i++){
  camera.position.set(random()*600-300,random()*600-300,random()*80);camera.lookAt(random()*600-300,random()*600-300,random()*80);camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  assert.deepEqual(index.queryFrustum(frustum,[]).map(e=>e.id).sort((a,b)=>a-b),entries.filter(e=>frustum.intersectsBox(e.bounds)).map(e=>e.id));
}
globalThis.Image=class { set src(value){this.source=value;} };
const smaa=new StreetSMAAPass();
assert.equal(smaa._edgesRT.texture.format,THREE.RGFormat);assert.equal(smaa._edgesRT.texture.type,THREE.UnsignedByteType);
assert.equal(smaa._weightsRT.texture.type,THREE.HalfFloatType);
assert.ok(smaa._materialBlend.fragmentShader.includes('smaaBlend();\n        #include <tonemapping_fragment>'));
const mockRenderer={autoClear:false,color:new THREE.Color(.2,.3,.4),alpha:.7,getClearColor(out){out.copy(this.color);},getClearAlpha(){return this.alpha;},setClearColor(color,alpha){this.color.set(color);this.alpha=alpha;},setRenderTarget(){},clear(){}};
smaa._fsQuad.render=()=>{assert.equal(mockRenderer.color.getHex(),0);throw new Error('intentional');};
assert.throws(()=>smaa.render(mockRenderer,{},{texture:{}}),/intentional/);
assert.equal(mockRenderer.autoClear,false);assert.equal(mockRenderer.alpha,.7);assert.deepEqual(mockRenderer.color.toArray(),[.2,.3,.4]);smaa.dispose();
const bloom=new StreetBloomPass(new THREE.Vector2(1,1),.16,.35,1.35);let draws=0;
bloom._fsQuad.render=()=>{draws++;assert.notEqual(bloom._fsQuad.material,bloom.blendMaterial,'final additive blend is fused into grading');};
bloom.render(mockRenderer,null,{texture:{}});assert.equal(draws,12);assert.equal(mockRenderer.autoClear,false);assert.equal(mockRenderer.alpha,.7);bloom.dispose();
const effectScene=new THREE.Scene(),effects=createTireEffects(effectScene),marks=effectScene.getObjectByName('tire marks'),smoke=effectScene.getObjectByName('subtle tire smoke');
marks.visible=false;smoke.visible=false;const smokeCount=smoke.geometry.drawRange.count;
await assert.rejects(effects.warmup(async()=>{
  assert.equal(marks.visible,true);assert.equal(smoke.visible,true);assert.equal(marks.geometry.drawRange.count,0);assert.equal(smoke.geometry.drawRange.count,0);
  throw new Error('intentional');
}),/intentional/);
assert.equal(marks.visible,false);assert.equal(smoke.visible,false);assert.equal(smoke.geometry.drawRange.count,smokeCount);
assert.equal(effects.stats.marks,0);assert.equal(effects.stats.emittedSmoke,0);effects.dispose();
console.log('Engine checks passed: fixed/native resolution, aspect ratio, DPR, pending/disjoint/lost GPU queries and frame statistics.');
