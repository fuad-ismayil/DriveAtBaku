import assert from 'node:assert/strict';
import { deviceAccess } from '../src/deviceGate.js';
import { MOBILE_DEVICES, DESKTOP_DEVICES } from './lib/mobileDevices.mjs';
for (const device of [...MOBILE_DEVICES, ...DESKTOP_DEVICES]) {
  for (const width of [320, 390, 844, 1024, 1920, 3840]) {
    const nav = { userAgent: device.userAgent, platform: device.platform, userAgentData: device.hints, maxTouchPoints: device.touch };
    const browser = { innerWidth: width, matchMedia: () => ({ matches: device.coarse }) };
    assert.equal(deviceAccess(nav, browser).blocked, device.blocked, `${device.name} at ${width}px`);
  }
}
assert.equal(deviceAccess(null).blocked, true, 'Missing identity must not start the game');
assert.equal(deviceAccess({ userAgent: 'iPad', maxTouchPoints: 0 }, {}).blocked, true);
console.log(`Mobile gate: ${MOBILE_DEVICES.length} blocked phone/tablet identities, ${DESKTOP_DEVICES.length} desktop controls, six screen widths and missing APIs passed.`);
