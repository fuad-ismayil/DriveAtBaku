import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { summarizeFrames } from './lib/performanceMetrics.mjs';
import sharp from 'sharp';
const folder=resolve(process.argv[2]??'artifacts/engine-investigation/final');
const before=process.env.BEFORE_VARIANT??'baseline',after=process.env.AFTER_VARIANT??'current';
const report=JSON.parse(readFileSync(folder+'/results.json'));
const rows=[];
for(const height of [...new Set(report.samples.map(s=>s.height))])for(const quality of [...new Set(report.samples.map(s=>s.quality))])for(const scenario of [...new Set(report.samples.map(s=>s.scenario))]){
  const selected=variant=>report.samples.filter(s=>s.variant===variant&&s.height===height&&s.quality===quality&&s.scenario===scenario);
  const a=selected(before),b=selected(after);if(!a.length||!b.length)continue;
  const old=summarizeFrames(a.flatMap(s=>s.rows)),next=summarizeFrames(b.flatMap(s=>s.rows));
  rows.push({height,quality,scenario,before:old,after:next,gpuReductionPercent:old.metrics.gpu&&next.metrics.gpu?(1-next.metrics.gpu.median/old.metrics.gpu.median)*100:null});
}
const visuals=[];
for(const label of ['sunny','rain','snow','night','garage']){
  if(!existsSync(`${folder}/${before}-${label}.png`)||!existsSync(`${folder}/${after}-${label}.png`))continue;
  const a=await sharp(`${folder}/${before}-${label}.png`).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const b=await sharp(`${folder}/${after}-${label}.png`).removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(JSON.stringify(a.info)!==JSON.stringify(b.info))throw new Error('Capture sizes differ');
  let sum=0,squared=0,max=0,over8=0;
  const colors=new Set();
  for(let i=0;i<a.data.length;i+=3){let pixelMax=0;for(let c=0;c<3;c++){const delta=Math.abs(a.data[i+c]-b.data[i+c]);sum+=delta;squared+=delta*delta;max=Math.max(max,delta);pixelMax=Math.max(pixelMax,delta);}if(pixelMax>8)over8++;if(i%3000===0)colors.add(a.data[i]*65536+a.data[i+1]*256+a.data[i+2]);}
  if(colors.size<32)throw new Error('Blank capture');
  visuals.push({label,meanChannelError:sum/a.data.length,rmsChannelError:Math.sqrt(squared/a.data.length),maximumChannelError:max,pixelsOver8Percent:over8/(a.data.length/3)*100});
}
const bytesPerTexture=({format,type})=>({1028:1,1030:2,1023:4}[format]??4)*({1009:1,1016:2,1015:4}[type]??4);
function targetBytes(target){const faces=target.cube?6:1,color=target.attachments.reduce((sum,t)=>sum+bytesPerTexture(t),0),depth=target.depth?4:0;
  return target.width*target.height*faces*((color+depth)+(target.samples?target.samples*(color+depth):0));}
const resources=report.samples.filter(s=>s.scenario==='idle').map(s=>({variant:s.variant,height:s.height,quality:s.quality,repeat:s.repeat,
  estimatedRenderTargetMiB:s.state.renderTargets.reduce((sum,t)=>sum+targetBytes(t),0)/1048576,targets:s.state.renderTargets.length,
  textures:s.metrics.textures?.median,geometries:s.metrics.geometries?.median,programs:s.metrics.programs?.median,heapMiB:(s.metrics.heap?.median??0)/1048576}));
const comparison={hardware:report.hardware,rows,visuals,resources,errors:report.errors};writeFileSync(folder+'/comparison.json',JSON.stringify(comparison,null,2));
console.log(JSON.stringify({rows:rows.map(r=>({height:r.height,quality:r.quality,scenario:r.scenario,beforeGPU:r.before.metrics.gpu?.median,afterGPU:r.after.metrics.gpu?.median,reduction:r.gpuReductionPercent,beforeFPS:r.before.fps.average,afterFPS:r.after.fps.average})),visuals,resources,errors:report.errors},null,2));
