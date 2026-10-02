import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three';
const module = { exports: {} };
runInNewContext(readFileSync('public/draco/draco_wasm_wrapper.js','utf8'), { module, exports: module.exports, require:createRequire(import.meta.url), __dirname:process.cwd()+'/public/draco', console, process, WebAssembly, Buffer, setTimeout, clearTimeout });
const api = await module.exports({ wasmBinary: readFileSync('public/draco/draco_decoder.wasm') });
export const draco = {
 preload() {},
 decodeDracoFile(buffer, onLoad, ids, types) {
  const decoder=new api.Decoder(), input=new api.DecoderBuffer(), mesh=new api.Mesh(); input.Init(new Int8Array(buffer),buffer.byteLength);
  const status=decoder.DecodeBufferToMesh(input,mesh); if(!status.ok())throw new Error(status.error_msg());
  const g=new THREE.BufferGeometry(), face=new api.DracoInt32Array(), ix=[];
  for(let i=0;i<mesh.num_faces();i++) { decoder.GetFaceFromMesh(mesh,i,face); ix.push(face.GetValue(0),face.GetValue(1),face.GetValue(2)); }
  g.setIndex(ix); api.destroy(face);
  for (const [name,id] of Object.entries(ids)) {
   const attr=decoder.GetAttributeByUniqueId(mesh,id), values=new api.DracoFloat32Array(); decoder.GetAttributeFloatForAllPoints(mesh,attr,values);
   const v=new Float32Array(values.size()); for(let i=0;i<v.length;i++)v[i]=values.GetValue(i);
   g.setAttribute(name,new THREE.BufferAttribute(v,attr.num_components())); api.destroy(values);
  }
  api.destroy(mesh); api.destroy(input); api.destroy(decoder); onLoad(g);
 }
};
