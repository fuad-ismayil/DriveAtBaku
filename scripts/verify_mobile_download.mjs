import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import release from '../shared/release.json' with { type: 'json' };
import { MOBILE_DEVICES } from './lib/mobileDevices.mjs';

const url = process.env.GAME_URL || 'http://localhost:5197';
const output = process.env.MOBILE_OUTPUT || 'artifacts/release-review/mobile';
const engines = { chromium, firefox, webkit };
const forbidden = /\/(generated|draco)\/|\/assets\/(vehicles|environment|audio|loading|fonts)\/|\/assets\/(main-|loadingScreen-|display-)|\/src\/(main|loadingScreen|display)\.js|\.(glb|wasm|ogg|mp3|bin|webp)(\?|$)/i;
const report = [];
mkdirSync(output, { recursive: true });

async function profile(browser, engine, device) {
  const context = await browser.newContext({ userAgent: device.userAgent || 'Unknown', hasTouch: device.touch > 0, viewport: { width: 390, height: 844 } });
  await context.addInitScript(device => {
    for (const [key, value] of Object.entries({ platform: device.platform, userAgentData: device.hints || undefined, maxTouchPoints: device.touch })) {
      Object.defineProperty(navigator, key, { configurable: true, get: () => value });
    }
    const match = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(pointer: coarse)' ? { matches: device.coarse } : match(query);
  }, device);
  const page = await context.newPage(), requests = [], errors = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', error => errors.push(error.message));
  // Record and abort a regression before it transfers hundreds of megabytes.
  await page.route('**/*', route => forbidden.test(new URL(route.request().url()).pathname) ? route.abort() : route.continue());
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#mobile-download').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#loading').isVisible(), false);
    assert.equal(await page.locator('#mobile-download [data-version]').textContent(), `v${release.version}`);
    assert.match(await page.locator('#mobile-download [data-download]').getAttribute('href'), /\/releases\/latest$/);
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1366, height: 1024 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${engine}/${device.name}: no horizontal overflow`);
      await page.locator('#mobile-download [data-download]').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#mobile-download [data-download]').isVisible(), true);
    }
    await page.waitForTimeout(150);
    assert.deepEqual(requests.filter(path => forbidden.test(path)), [], `${engine}/${device.name}: zero game requests`);
    assert.deepEqual(errors, [], `${engine}/${device.name}: no errors`);
    if (/ipad|iphone/.test(device.name)) assert.match(await page.locator('#mobile-download-note').textContent(), /does not run on iOS or iPadOS/);
    if (['android-chrome-phone', 'ipad-desktop-mode'].includes(device.name)) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${output}/${engine}-${device.name}.png` });
    }
    report.push({ engine, device: device.name, blocked: true, requests });
  } finally { await context.close(); }
}

for (const engine of (process.env.MOBILE_BROWSERS || 'chromium,firefox,webkit').split(',')) {
  const browser = await engines[engine].launch({ headless: true });
  try {
    for (let i = 0; i < MOBILE_DEVICES.length; i += 3) await Promise.all(MOBILE_DEVICES.slice(i, i + 3).map(device => profile(browser, engine, device)));
    // HTML must remain download-only if JavaScript is unavailable.
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const page = await nojs.newPage(), requests = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto(url);
    assert.equal(await page.locator('#mobile-download a').isVisible(), true);
    assert.match(await page.locator('#mobile-download a').getAttribute('href'), /\/releases\/latest$/);
    assert.deepEqual(requests.filter(path => forbidden.test(path)), []);
    await nojs.close();
    console.log(`${engine}: ${MOBILE_DEVICES.length} mobile/tablet profiles, resizes, desktop mode and no-JavaScript fallback passed.`);
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ url, version: release.version, cases: report.length, report }, null, 2));
console.log(`MOBILE_PRODUCTION_PASS: ${report.length} browser/device cases loaded zero game assets.`);
