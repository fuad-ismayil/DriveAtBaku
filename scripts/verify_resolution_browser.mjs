import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import playwright from 'playwright';
const output=resolve('artifacts/engine-investigation/resolution');mkdirSync(output,{recursive:true});
const url=process.env.GAME_URL??'http://127.0.0.1:5186';
const report={cases:[],windows:[],aoOff:[],errors:[]};
const browser=await playwright.chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
  const context=await browser.newContext({viewport:process.env.HEADED==='1'?null:{width:1920,height:1080}});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',msg=>{if(/THREE.WebGLProgram|Shader Error/.test(msg.text()))report.errors.push(msg.text());});
  await page.route('**/src/main.js*',async route=>{
    const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`
      window.__resolutionProbe={ready:()=>mode!=='loading',stats:()=>graphics.stats,
        pause:()=>{mode='drive';pause();},
        state:()=>({graphics:graphics.stats,programs:renderer.info.programs.length,textures:renderer.info.memory.textures,
          viewport:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,
          buffer:[renderer.getContext().drawingBufferWidth,renderer.getContext().drawingBufferHeight],canvas:[canvas.clientWidth,canvas.clientHeight],aspect:camera.aspect,
          zoom:visualViewport?.scale,contextLost:renderer.getContext().isContextLost()})};`});
  });
  const targetURL=new URL(url);if(process.env.GRAPHICS_DEBUG==='1')targetURL.searchParams.set('graphicsDebug','1');
  await page.goto(targetURL.href,{timeout:180000});await page.waitForFunction(()=>window.__resolutionProbe?.ready(),null,{timeout:240000});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const layoutMetrics=await cdp.send('Page.getLayoutMetrics');report.browserZoom={zoom:layoutMetrics.cssVisualViewport?.zoom??null,pinchScale:layoutMetrics.cssVisualViewport?.scale??null};
  report.hardware=await page.evaluate(()=>{const gl=document.querySelector('#game').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),timerQueries:!!gl.getExtension('EXT_disjoint_timer_query_webgl2'),version:navigator.userAgent};});
  assert.ok(!/SwiftShader|llvmpipe/i.test(report.hardware.renderer));
  const settle=()=>page.evaluate(async()=>{for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);});
  await page.evaluate(()=>window.__resolutionProbe.pause());
  if(process.env.GRAPHICS_DEBUG==='1'){
    await page.waitForFunction(()=>/GPU median \/ p95: \d/.test(document.getElementById('graphics-diagnostics')?.textContent??''),null,{timeout:30000});
    report.overlay=await page.locator('#graphics-diagnostics').textContent();
  }
  for(const dpr of [1,1.25,1.5,2]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:dpr,mobile:false});
    for(const quality of ['performance','balanced','cinematic']){
      await page.selectOption('#graphics-quality',quality);
      for(const resolution of ['native','1920x1080','1600x900','1280x720']){
        await page.selectOption('#rendering-resolution',resolution);await settle();const state=await page.evaluate(()=>window.__resolutionProbe.state());
        const ratio=resolution==='native'?Math.min(dpr,{performance:1,balanced:1.5,cinematic:2}[quality]):({ '1920x1080':1,'1600x900':900/1080,'1280x720':720/1080 })[resolution];
        assert.deepEqual(state.buffer,[Math.floor(1920*ratio),Math.floor(1080*ratio)]);
        assert.deepEqual(state.canvas,[1920,1080]);assert.equal(state.aspect,1920/1080);
        if(quality!=='performance')assert.deepEqual(state.graphics.aoSize,state.buffer.map(v=>Math.round(v/2)));
        assert.equal(await page.locator('#render-scale').isDisabled(),resolution!=='native');
        report.cases.push({quality,resolution,...state});
      }
      if(quality!=='performance'){
        await page.uncheck('#ambient-occlusion');await settle();const state=await page.evaluate(()=>window.__resolutionProbe.state());
        assert.equal(state.graphics.ao,false);assert.equal(state.contextLost,false);report.aoOff.push({quality,dpr,...state});
        await page.check('#ambient-occlusion');await settle();
      }
    }
  }
  // Resize repeatedly at constant quality. Shader programs and live textures
  // must return to the same inventory, rather than grow on each change.
  await page.selectOption('#graphics-quality','balanced');await page.selectOption('#rendering-resolution','1920x1080');await settle();
  const before=await page.evaluate(()=>window.__resolutionProbe.state());
  for(let i=0;i<12;i++){await page.selectOption('#rendering-resolution',i%2?'1920x1080':'1280x720');await settle();}
  const after=await page.evaluate(()=>window.__resolutionProbe.state());
  assert.equal(after.programs,before.programs);assert.equal(after.textures,before.textures);assert.equal(after.contextLost,false);
  report.resourceCycles={before,after};
  for(const [width,height] of [[1920,947],[2560,1080],[390,844]]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
    await page.selectOption('#rendering-resolution','1280x720');await settle();const state=await page.evaluate(()=>window.__resolutionProbe.state());
    assert.ok(state.buffer[0]<=1280&&state.buffer[1]<=720);assert.equal(state.aspect,width/height);assert.deepEqual(state.canvas,[width,height]);
    const layout=await page.evaluate(()=>{const card=document.querySelector('.pause-card').getBoundingClientRect();return{left:card.left,right:card.right,controls:[...document.querySelectorAll('.pause-card select')].map(el=>el.getBoundingClientRect().right)};});
    assert.ok(layout.left>=0&&layout.right<=width+1&&layout.controls.every(right=>right<=width+1));report.cases.push({resolution:'1280x720',...state,layout});
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  if(process.env.HEADED==='1'){
    const{windowId}=await cdp.send('Browser.getWindowForTarget');
    for(const windowState of ['normal','maximized','fullscreen']){
      await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
      if(windowState==='normal')await cdp.send('Browser.setWindowBounds',{windowId,bounds:{left:20,top:20,width:1280,height:720}});
      else await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState}});
      await settle();const{bounds}=await cdp.send('Browser.getWindowBounds',{windowId});
      const state=await page.evaluate(()=>window.__resolutionProbe.state());report.windows.push({windowState,bounds,...state});
      assert.deepEqual(state.canvas,state.viewport);assert.equal(state.aspect,state.viewport[0]/state.viewport[1]);assert.ok(state.buffer[0]<=1280&&state.buffer[1]<=720);
      await page.screenshot({path:`${output}/${windowState}.png`});
    }
  }
  await page.selectOption('#rendering-resolution','1600x900');await page.reload({timeout:180000});
  await page.waitForFunction(()=>window.__resolutionProbe,null,{timeout:30000});
  assert.equal(await page.locator('#rendering-resolution').inputValue(),'1600x900');
  assert.equal((await page.evaluate(()=>window.__resolutionProbe.stats())).renderingResolution,'1600x900');
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({hardware:report.hardware,cases:report.cases.length,windows:report.windows,resources:report.resourceCycles,errors:report.errors}));
}finally{writeFileSync(output+'/results.json',JSON.stringify(report,null,2));await browser.close();}
