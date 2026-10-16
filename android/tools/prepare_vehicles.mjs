import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('android/game/assets/vehicles',{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:5197,strictPort:true,hmr:false},plugins:[{name:'native-asset-export',configureServer(s){s.middlewares.use(async(req,res,next)=>{
  if(req.url==='/__native_capture'){res.setHeader('Content-Type','text/html');res.end('<link rel="icon" href="data:,"><script type="module">import capture from "/android/tools/capture_vehicles.js";capture().catch(e=>{console.error(e);window.__nativeCaptureError=String(e)});</script>');return;}
  const match=/^\/__native_export\/(ferrari\.glb|elantra\.glb|amg\.glb|prado\.glb|plate_library\.glb|plate_glyph_(?:[0-9A-Z]|dash)\.glb|metadata\.json)$/.exec(req.url??'');if(!match||req.method!=='POST'){next();return;}
  try{const chunks=[];for await(const c of req)chunks.push(c);writeFileSync(`android/game/assets/vehicles/${match[1]}`,Buffer.concat(chunks));res.end('ok');}catch(e){res.statusCode=500;res.end(String(e));}
});}}]});
let browser;
try{
  await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('console',m=>{if(m.type()==='error'||m.text().startsWith('Preparing native'))console.log(m.text());});
  await page.goto('http://127.0.0.1:5197/__native_capture');await page.waitForFunction(()=>window.__nativeCaptureDone||window.__nativeCaptureError,null,{timeout:240000});const error=await page.evaluate(()=>window.__nativeCaptureError);if(error)throw new Error(error);console.log('All four vehicles prepared with the existing web model assembly and wheel fitting.');
}finally{await browser?.close();await server.close();}
