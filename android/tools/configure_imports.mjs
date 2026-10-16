import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

// Force GPU texture compression and mipmaps before packaging. The first headless
// import does not have a displayed 3D viewport to trigger automatic detection.
let changed=0;
for(const file of readdirSync('android/game/assets/world/textures').filter(p=>p.endsWith('.png.import'))){
  const path=`android/game/assets/world/textures/${file}`,before=readFileSync(path,'utf8');
  const after=before.replace(/^compress\/mode=\d+/m,'compress/mode=2').replace(/^mipmaps\/generate=false/m,'mipmaps/generate=true');
  if(after!==before){writeFileSync(path,after);changed++;}
}
console.log(`Configured ${changed} map texture imports for GPU compression and mipmaps.`);
for (const file of readdirSync('android/game/assets/audio').filter(p => p.endsWith('.wav.import'))) {
  const path = `android/game/assets/audio/${file}`;
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^compress\/mode=\d+/m, 'compress/mode=0'));
}
