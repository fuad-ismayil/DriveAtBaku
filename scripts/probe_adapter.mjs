import playwright from 'playwright';
for(const preference of ['default','high']){
  const browser=await playwright.chromium.launch({channel:'chrome',headless:false,args:preference==='high'?['--force_high_performance_gpu']:[]});
  try{const page=await browser.newPage();const result=await page.evaluate(()=>{
    const gl=document.createElement('canvas').getContext('webgl2',{powerPreference:'high-performance',antialias:true}),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return{renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),timer:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};
  });console.log(JSON.stringify({preference,...result}));}finally{await browser.close();}
}
