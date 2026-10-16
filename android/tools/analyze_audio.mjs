import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const report = { loops: JSON.parse(readFileSync('artifacts/android/audio-loops.json')), recordings: [] };
for (const name of ['native-idle.wav', 'native-driving.wav']) {
  const path = `artifacts/android/visual/${name}`;
  if (!existsSync(path)) continue;
  const bytes=readFileSync(path);let pcm,rate,channels,bits;
  for(let i=12;i+8<=bytes.length;){const size=bytes.readUInt32LE(i+4),tag=bytes.toString('ascii',i,i+4);
    if(tag==='fmt '){channels=bytes.readUInt16LE(i+10);rate=bytes.readUInt32LE(i+12);bits=bytes.readUInt16LE(i+22);}
    if(tag==='data')pcm=bytes.subarray(i+8,i+8+size);i+=8+size+size%2;
  }
  if(bits!==16)throw new Error('Expected PCM recording');
  let peak=0,energy=0,clipped=0,mean=0;
  const samples=pcm.length/2;
  for(let i=0;i<samples;i++){const v=pcm.readInt16LE(i*2)/32768;peak=Math.max(peak,Math.abs(v));energy+=v*v;mean+=v;if(Math.abs(v)>=.999)clipped++;}
  const rms=Math.sqrt(energy/samples);
  const frames=samples/channels;let silentBlocks=0;
  // Exclude startup fade; a fully empty 10 ms block would be suspicious in a
  // continuous idle recording. This does not prove the absence of audible ticks.
  for(let i=Math.floor(rate*.5);i+rate*.01<frames;i+=Math.floor(rate*.01)){
    let sum=0;for(let j=i;j<i+Math.floor(rate*.01);j++)sum+=Math.abs(pcm.readInt16LE(j*channels*2));
    if(sum===0)silentBlocks++;
  }
  report.recordings.push({name,rate,channels,duration:frames/rate,peak,rms,dc:mean/samples,clippedSamples:clipped,silent10msBlocksAfterFade:silentBlocks});
}
writeFileSync('artifacts/android/audio-analysis.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report.recordings,null,2));
