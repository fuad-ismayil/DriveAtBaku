import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.env.GAME_URL ?? 'http://127.0.0.1:5188';
const output = resolve('artifacts/liquid-glass');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel:'chrome', headless:true, args:['--disable-background-timer-throttling','--disable-renderer-backgrounding'] });
const report = { errors: [], checks: [] };
const settle = page => page.evaluate(async()=>{for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);});
const checkIcons = async (page, selector) => {
  const failures = await page.locator(selector).evaluate(root => [...root.querySelectorAll('button .ui-icon, a .ui-icon')].flatMap(icon => {
    const r = icon.getBoundingClientRect();
    if (!r.width || !r.height) return [];
    const control = icon.closest('button, a').getBoundingClientRect();
    const use = icon.querySelector('use'), target = use && document.querySelector(use.getAttribute('href'));
    const box = icon.getBBox();
    return Math.abs((r.top + r.bottom - control.top - control.bottom) / 2) > 1 || !box.width || !box.height || (use && !target)
      ? [{ control: icon.closest('button, a').id, href: use?.getAttribute('href'), offset: (r.top+r.bottom-control.top-control.bottom)/2 }] : [];
  }));
  assert.deepEqual(failures, [], 'Visible menu icons render and stay vertically centered');
};
const inside = async (page,selector) => {
  const result = await page.locator(selector).evaluate(element=>{
    const r=element.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:element.scrollWidth-element.clientWidth};
  });
  assert.ok(result.left>=-1 && result.right<=result.width+1 && result.top>=-1 && result.bottom<=result.height+1,`${selector} fits the viewport: ${JSON.stringify(result)}`);
  if(result.overflow>1) {
    await page.screenshot({path:`${output}/layout-failure.png`});
    console.log(await page.locator(selector).evaluate(el=>[...el.querySelectorAll('*')].map(child=>({tag:child.tagName,id:child.id,width:child.clientWidth,scroll:child.scrollWidth})).filter(x=>x.scroll>x.width+1)));
  }
  assert.ok(result.overflow<=1,`${selector} has no horizontal overflow: ${JSON.stringify(result)}`);
};
try {
  // Exercise the real lightweight loader independently of heavy map downloads.
  const intro = await browser.newPage({viewport:{width:1440,height:900}});
  intro.on('pageerror',error=>report.errors.push(String(error)));
  await intro.routeWebSocket('**/*',socket=>socket.close());
  await intro.route('**/src/startup.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.loader = loadingScreen;'});});
  await intro.route('**/src/main.js*',route=>route.fulfill({body:'',contentType:'text/javascript'}));
  await intro.goto(origin);
  await intro.evaluate(async()=>{
    loader.plan({city:1000});loader.stage('Bringing the city into view…','THE CITY','Preparing your drive.',true);loader.bytes('city',680,1000);
  });
  await intro.waitForFunction(()=>document.getElementById('loading-progress').getAttribute('aria-valuenow')==='68');
  await intro.locator('#loading-motion').click();
  assert.equal(await intro.locator('#loading-motion').getAttribute('aria-pressed'),'true');
  assert.equal(await intro.locator('#loading-progress').getAttribute('aria-valuenow'),'68');
  for(const [width,height] of [[1440,900],[1920,1080],[390,844],[844,390],[320,568]]) {
    await intro.setViewportSize({width,height});
    await settle(intro);
    await inside(intro,'.loading-footer');
    await inside(intro,'.loading-editorial');
    const overlap=await intro.evaluate(()=>document.querySelector('.loading-editorial').getBoundingClientRect().bottom>document.querySelector('.loading-footer').getBoundingClientRect().top+1);
    assert.equal(overlap,false,'Loading story and controls do not overlap');
    await intro.screenshot({path:`${output}/loading-${width}x${height}.png`});
  }
  await intro.setViewportSize({width:1440,height:900});
  for(const index of [1,2,3,0]) {
    await intro.locator(`[data-chapter="${index}"]`).click();
    await intro.waitForFunction(index=>loader.postcard===index&&!loader.switching,index,{timeout:10000});
    assert.equal(await intro.locator(`[data-chapter="${index}"]`).getAttribute('aria-current'),'true');
    const dimensions=await intro.locator('.loading-scene.is-active').evaluate(image=>[image.naturalWidth,image.naturalHeight]);
    assert.deepEqual(dimensions,[3840,2160],'Every loading scene is native 4K');
    await intro.screenshot({path:`${output}/loading-chapter-${index}.png`});
  }
  await intro.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await intro.locator('.loading-scene').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await intro.locator('[data-chapter="2"]').click();
  await intro.waitForFunction(()=>loader.postcard===2&&!loader.switching);
  for(const size of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    await intro.setViewportSize(size);await settle(intro);await inside(intro,'.loading-editorial');await inside(intro,'.loading-footer');
  }
  await intro.emulateMedia({reducedMotion:'no-preference'});
  await intro.setViewportSize({width:1440,height:900});
  // A resumed slideshow advances, and pausing prevents further automatic changes.
  await intro.locator('#loading-motion').click();
  const previous=await intro.evaluate(()=>loader.postcard);
  await intro.waitForFunction(previous=>loader.postcard!==previous,previous,{timeout:11000});
  await intro.locator('#loading-motion').click();
  await intro.waitForTimeout(1800);
  const paused=await intro.evaluate(()=>loader.postcard);
  await intro.waitForTimeout(7200);
  assert.equal(await intro.evaluate(()=>loader.postcard),paused);
  await intro.evaluate(()=>loader.fail(new Error('Asset request failed')));
  assert.equal(await intro.locator('#loading-retry').isVisible(),true);
  await intro.screenshot({path:`${output}/loading-error.png`});
  await Promise.all([intro.waitForNavigation(),intro.locator('#loading-retry').click()]);
  assert.equal(await intro.locator('#loading').evaluate(el=>el.classList.contains('has-error')),false);
  await intro.close();
  report.checks.push('4K loading scenes, responsive layout, chapter selection, pause/resume, reduced motion, progress, failure and retry');

  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>report.errors.push(String(error)));
  await page.routeWebSocket('**/*',socket=>socket.close());
  await page.goto(origin,{timeout:180000});
  await page.waitForSelector('#loading.hidden',{state:'attached',timeout:240000});
  console.log('Current game loaded; checking menu and driving flows…');
  for(const [width,height] of [[1440,900],[1280,720],[390,844],[844,390],[320,568]]){
    await page.setViewportSize({width,height});await settle(page);
    await inside(page,'.hero-copy');
    await page.locator('#drive-button').scrollIntoViewIfNeeded();await inside(page,'#drive-button');
    await checkIcons(page,'#menu');
    if(width===844) assert.equal(await page.locator('.hero-copy').evaluate(el=>el.scrollHeight>el.clientHeight+1),false,'Short landscape shows the complete main menu');
    await page.screenshot({path:`${output}/menu-${width}x${height}.png`});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#time-toggle').click();
  assert.equal(await page.locator('#time-toggle use').getAttribute('href'),'#icon-moon');
  await page.screenshot({path:`${output}/menu-night.png`});
  await page.locator('#time-toggle').click();
  await page.locator('#multiplayer-button').click();
  await page.locator('#mp-nick-input').fill('Glass Driver');
  await page.locator('#mp-advanced-toggle').click();
  assert.equal(await page.locator('#mp-server-input').isVisible(),true);
  await page.screenshot({path:`${output}/multiplayer.png`});
  await page.locator('#mp-back-button').click();
  await page.locator('#controls-button').click();await inside(page,'#controls .modal-card');
  await page.screenshot({path:`${output}/controls.png`});await page.locator('#close-controls').click();
  await page.locator('#garage-button').click();
  await inside(page,'.garage-panel');
  await page.locator('#garage-amg').click();
  await page.waitForFunction(()=>document.getElementById('garage-amg').classList.contains('selected'),null,{timeout:90000});
  await page.screenshot({path:`${output}/garage.png`});
  await page.locator('#garage-back').click();
  await page.locator('#drive-button').click();
  await page.waitForSelector('#hud:not(.hidden)');await page.waitForTimeout(1200);
  assert.equal(await page.locator('.suspension-bars').count(),0);
  for(const aid of ['abs','tcs','esc']){
    assert.equal(await page.locator(`#aid-${aid} svg`).count(),1);
    const before=await page.locator(`#aid-${aid}`).getAttribute('aria-pressed');
    await page.keyboard.press({abs:'1',tcs:'2',esc:'3'}[aid]);await settle(page);
    assert.notEqual(await page.locator(`#aid-${aid}`).getAttribute('aria-pressed'),before,`${aid} keyboard toggle updates accessible state`);
  }
  await page.waitForTimeout(1800);
  await page.screenshot({path:`${output}/driving-1440x900.png`});
  await page.keyboard.press('Escape');await page.waitForSelector('#pause:not(.hidden)');
  for(const [width,height] of [[1440,900],[1280,720],[390,844],[844,390],[320,568]]){
    await page.setViewportSize({width,height});await settle(page);await inside(page,'.pause-card');
    await checkIcons(page,'#pause');
    await inside(page,'.telemetry-panel');await inside(page,'.dynamics-panel');await inside(page,'.map-panel');
    assert.ok(await page.evaluate(()=>document.querySelector('.dynamics-panel').getBoundingClientRect().right<document.querySelector('.telemetry-panel').getBoundingClientRect().left),'Driving instruments do not overlap');
    await page.screenshot({path:`${output}/pause-${width}x${height}.png`});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#pause-time-toggle').click();
  assert.equal(await page.locator('#pause-time-toggle use').getAttribute('href'),'#icon-moon');
  await page.locator('#pause-mute').click();
  assert.equal(await page.locator('#pause-mute use').getAttribute('href'),'#icon-volume-off');
  await page.locator('#pause-mute').click();
  assert.equal(await page.locator('#pause-mute use').getAttribute('href'),'#icon-volume');
  await page.screenshot({path:`${output}/pause-night.png`});
  await page.locator('#resume').click();await page.waitForSelector('#hud:not(.hidden)');
  await page.screenshot({path:`${output}/driving-night.png`});
  await page.keyboard.press('Escape');await page.locator('#exit').click();await page.waitForSelector('#menu:not(.hidden)');
  report.checks.push('Real menu, multiplayer form, controls, garage selection, driving, aid keyboard states, pause/settings, resume and return to menu');
  assert.deepEqual(report.errors,[],'No game or UI runtime errors');
  console.log(JSON.stringify(report,null,2));
} finally { writeFileSync(`${output}/verification.json`,JSON.stringify(report,null,2)+'\n');await browser.close(); }
