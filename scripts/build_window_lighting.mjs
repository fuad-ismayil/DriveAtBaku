import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Profiles are visually audited atlas regions; detection never searches roads,
// roofs, shutters, signs or doors outside those regions. Read packed map assets
// so regeneration does not require the original local level export.
const profiles=JSON.parse(readFileSync(new URL('./windowAtlasProfiles.json',import.meta.url)));
if(Object.values(profiles).some(profile=>profile.grid))throw new Error('Only discrete windows are supported; continuous glass walls must not receive room lights.');
const manifest=JSON.parse(readFileSync('public/generated/asset-manifest.json'));
const atlasSize=2048,tileSize=32,padding=2,atlas=new Uint8Array(atlasSize*atlasSize*4);
const layouts=[],bindings={},byImage=new Map(),materialImages=new Map();let tileCount=0;
const hash=data=>createHash('sha256').update(data).digest('hex');

function detect(data,width,height,profile){
 const mask=new Uint8Array(width*height),regions=profile.regions;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(!regions.some(([l,t,r,b])=>x>=l*width&&x<r*width&&y>=t*height&&y<b*height))continue;
  const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
  const cool=b>r+7&&g>=r-5&&r<224;
  const dark=!profile.glassOnly&&r<112&&g<118&&b<130&&Math.max(r,g,b)-Math.min(r,g,b)<27&&b>r*.8;
  if((cool||dark)&&data[i+3]>128)mask[y*width+x]=1;
 }
 let boxes=[];
 if(profile.windows){
  boxes=profile.windows.map(([l,t,r,b])=>({l:Math.round(l*width),t:Math.round(t*height),r:Math.round(r*width),b:Math.round(b*height)}));
 }else{
  const seen=new Uint8Array(mask.length),stack=[];
  for(let start=0;start<mask.length;start++){
   if(!mask[start]||seen[start])continue;
   stack.push(start);seen[start]=1;let l=width,r=0,t=height,b=0,count=0;
   while(stack.length){const p=stack.pop(),x=p%width,y=Math.floor(p/width);l=Math.min(l,x);r=Math.max(r,x+1);t=Math.min(t,y);b=Math.max(b,y+1);count++;
    for(const n of [x>0?p-1:-1,x+1<width?p+1:-1,y>0?p-width:-1,y+1<height?p+width:-1])if(n>=0&&mask[n]&&!seen[n]){seen[n]=1;stack.push(n);}
   }
   if(r-l>=3&&b-t>=5&&count>=12&&count/((r-l)*(b-t))>.38&&r-l<width*.36&&b-t<height*.35)boxes.push({l,r,t,b});
  }
  // Reunite panes separated by narrow wooden mullions into one room. Adjacent
  // windows separated by wall remain distinct; preserve the mullions in the mask.
  let changed=true;
  while(changed){changed=false;
   for(let i=0;i<boxes.length&&!changed;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j],xOverlap=Math.min(a.r,b.r)-Math.max(a.l,b.l),yOverlap=Math.min(a.b,b.b)-Math.max(a.t,b.t);
    const xGap=Math.max(a.l,b.l)-Math.min(a.r,b.r),yGap=Math.max(a.t,b.t)-Math.min(a.b,b.b);
    const side=yOverlap>Math.min(a.b-a.t,b.b-b.t)*.72&&xGap<=Math.max(3,Math.min(7,(a.b-a.t)*.10))&&Math.max(a.r,b.r)-Math.min(a.l,b.l)<width*.20;
    const vertical=xOverlap>Math.min(a.r-a.l,b.r-b.l)*.75&&yGap<=4&&Math.max(a.b,b.b)-Math.min(a.t,b.t)<height*.22;
    if(side||vertical){boxes[i]={l:Math.min(a.l,b.l),r:Math.max(a.r,b.r),t:Math.min(a.t,b.t),b:Math.max(a.b,b.b)};boxes.splice(j,1);changed=true;break;}
   }
  }
 }
 return {mask,boxes:boxes.filter(b=>b.r-b.l>=4&&b.b-b.t>=7&&(b.r-b.l)/(b.b-b.t)>.13&&(b.r-b.l)/(b.b-b.t)<4)};
}

for(const asset of ['buildings','baku']){
 const bytes=gunzipSync(Buffer.concat(manifest.assets[asset].parts.map(part=>readFileSync(`public/generated/${part}`))));
 const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length)),offset=28+length;
 for(const material of json.materials){
  if(!/building|windows/i.test(material.name)||/pitgarage|medical|media|neon/i.test(material.name))continue;
  const profile=profiles[material.name]??profiles[material.name.toLowerCase()];
  const image=json.images[json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source],view=json.bufferViews[image.bufferView];
  const png=bytes.subarray(offset+view.byteOffset,offset+view.byteOffset+view.byteLength),key=hash(png);
  materialImages.set(`${asset}/${material.name}`,key);
  if(!profile)continue;
  if(byImage.has(key)){bindings[`${asset}/${material.name}`]=byImage.get(key);continue;}
  const {data,info}=await sharp(png).resize({width:512,height:1024,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {mask,boxes}=detect(data,info.width,info.height,profile),rooms=[];
  for(const box of boxes){
   const tile=tileCount++,tx=tile%64*tileSize,ty=Math.floor(tile/64)*tileSize;
   if(ty+tileSize>atlasSize)throw new Error('Window atlas capacity exceeded');
   for(let y=padding;y<tileSize-padding;y++)for(let x=padding;x<tileSize-padding;x++){
    const sx=Math.min(box.r-1,box.l+Math.floor((x-padding+.5)/(tileSize-padding*2)*(box.r-box.l)));
    const sy=Math.min(box.b-1,box.t+Math.floor((y-padding+.5)/(tileSize-padding*2)*(box.b-box.t)));
    const i=((ty+y)*atlasSize+tx+x)*4;atlas[i]=atlas[i+1]=atlas[i+2]=255;atlas[i+3]=mask[sy*info.width+sx]?255:0;
   }
   rooms.push([box.l/info.width,box.t/info.height,box.r/info.width,box.b/info.height,
    (tx+padding)/atlasSize,(ty+padding)/atlasSize,(tx+tileSize-padding)/atlasSize,(ty+tileSize-padding)/atlasSize].map(x=>Number(x.toFixed(7))));
  }
  const id=layouts.length;layouts.push({source:key,rooms,...(profile.sourceVRange?{sourceVRange:profile.sourceVRange}:{})});byImage.set(key,id);bindings[`${asset}/${material.name}`]=id;
  console.log(asset,material.name,rooms.length);
 }
}
// The conversion splits one facade atlas across many material bindings. Match
// identical source image bytes so every alias gets the same audited glass mask.
for(const [material,key]of materialImages)if(byImage.has(key))bindings[material]=byImage.get(key);
mkdirSync('public/assets/environment',{recursive:true});
await sharp(atlas,{raw:{width:atlasSize,height:atlasSize,channels:4}}).png({palette:true}).toFile('public/assets/environment/room-windows.png');
writeFileSync('src/windowLightingAtlas.json',JSON.stringify({version:1,atlas:'/assets/environment/room-windows.png',bindings,layouts})+'\n');
console.log(JSON.stringify({atlases:layouts.length,materials:Object.keys(bindings).length,windowTemplates:tileCount}));
