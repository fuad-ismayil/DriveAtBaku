import {createReadStream} from 'node:fs';
import {mkdir,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import release from '../shared/release.json' with {type:'json'};
const version=release.version,assets=[];
for(const path of [`windows/build/DriveAtBaku-Windows-v${version}.zip`,`android/build/DriveAtBaku-Android-v${version}.apk`]){
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 assets.push({name:path.split('/').at(-1),path:resolve(path),bytes:(await stat(path)).size,sha256:hash.digest('hex')});
}
const directory=`artifacts/releases/v${version}`;await mkdir(directory,{recursive:true});
await writeFile(`${directory}/manifest.json`,JSON.stringify({version,tag:`v${version}`,status:'staged',releaseUrl:release.releaseUrl,assets},null,2)+'\n');
await writeFile(`${directory}/SHA256SUMS.txt`,assets.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
console.log(`Staged v${version}: one Windows ZIP and one Android APK. Nothing uploaded or published.`);
