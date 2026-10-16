import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const godot=process.env.GODOT_BIN??'C:/Program Files/Godot_v4.6.1-stable_win64/Godot_v4.6.1-stable_win64_console.exe';
const android=process.argv.includes('--android'),execute=promisify(execFile),selector=process.env.DAB_DEVICE?['-s',process.env.DAB_DEVICE]:[];
const adb=(...args)=>execute(process.env.ADB_BIN??'adb',[...selector,...args],{windowsHide:true,maxBuffer:2097152});
const relay=spawn(process.execPath,['server/server.js'],{env:{...process.env,PORT:'18787'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let relayText='';relay.stdout.on('data',b=>relayText+=b);relay.stderr.on('data',b=>relayText+=b);
const vite=await createServer({server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false},plugins:[{name:'network-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/__network_fixture'){res.setHeader('Content-Type','text/html');res.end('<title>Local multiplayer verification</title>');}else next();});}}]});
let browser,child;
try{
  await vite.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  await page.goto('http://127.0.0.1:5198/__network_fixture');
  await page.evaluate(async()=>{
    const {NetClient}=await import('/src/net/NetClient.js');const {formatStatePayload}=await import('/src/net/protocol.js');
    const client=new NetClient();window.__nativeSeen=[];window.__nativeLeft=[];let seq=0;
    client.onLeft=packet=>window.__nativeLeft.push(packet.id);
    client.onWelcome=p=>{window.__webId=p.id;window.__webReady=true;};
    client.onSnapshot=packet=>{for(const [id,state]of Object.entries(packet.states??{}))if(id!==window.__webId)window.__nativeSeen.push(state);};
    client.connect('ws://127.0.0.1:18787','WebQA');
    window.__sendTimer=setInterval(()=>{if(!window.__webReady)return;client.sendState(formatStatePayload(++seq,Date.now(),{cid:'elantra',col:'#314159',plt:null,rpm:3000,gr:3,au:{ld:.72,sh:.1,ac:6},p:[690,480,1.6],q:[0,0,0,1],v:[0,2,0],av:[0,0,0],spd:7.2,in:{th:.5,br:.25,st:.1,hb:0,hn:0,rev:0},li:{head:1,sig:'left',sigRev:1,sigAt:Date.now(),brake:1,rev:0},w:Array.from({length:4},()=>({st:.1,rot:2,sl:0,sk:0,sm:0,c:1,cp:[690,480,1.6]}))}));},33);
    window.__webClient=client;
  });
  await page.waitForFunction(()=>window.__webReady,null,{timeout:15000});
  let output='';
  if(android){
    await adb('reverse','tcp:18787','tcp:18787');
    await adb('install','-r','android/build/DriveAtBaku-network-verification.apk');
    await adb('shell','am','start','-n','games.driveatbaku.networkverification/com.godot.game.GodotAppLauncher');
    let pid='';
    for(let i=0;i<40;i++){
      if(!pid){try{pid=(await adb('shell','pidof','games.driveatbaku.networkverification')).stdout.trim();}catch{}}
      if(pid)output=(await adb('logcat','-d',`--pid=${pid}`,'-s','godot')).stdout;
      if(output.includes('NATIVE_NETWORK_PASS'))break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  }else{
    child=spawn(godot,['--headless','--path','android/game','res://tests/network.tscn'],{windowsHide:true});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Godot network test timed out'));},25000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
    assert.equal(code,0,output);
  }
  assert.match(output,/NATIVE_NETWORK_PASS/);
  const seen=await page.evaluate(()=>window.__nativeSeen);assert.ok(seen.length>0,'Browser must receive native state');const state=seen.at(-1);
  assert.equal(state.cid,'ferrari');assert.equal(state.gr,2);assert.equal(state.li.sig,'right');assert.equal(state.li.head,1);assert.equal(state.w.length,4);assert.deepEqual(state.p,[681,479,0]);assert.ok(state.li.sigAt>0);
  assert.ok(Number.isFinite(state.au.ld)&&Number.isFinite(state.au.sh)&&Number.isFinite(state.au.ac),'Native drivetrain audio state must survive relay');
  await page.waitForFunction(()=>window.__nativeLeft.length>=2,null,{timeout:5000});
  writeFileSync(`artifacts/android/network-verification${android?'-android':''}.json`,JSON.stringify({browserMessages:seen.length,nativeOutput:output,lastNativeState:state},null,2));
  console.log(output.trim());console.log(`BROWSER_NETWORK_PASS received ${seen.length} native vehicle updates through the existing relay.`);
}finally{child?.kill();await browser?.close();await vite.close();relay.kill();writeFileSync('artifacts/android/network-relay.log',relayText);if(android){await adb('reverse','--remove','tcp:18787').catch(()=>{});await adb('uninstall','games.driveatbaku.networkverification').catch(()=>{});}}
