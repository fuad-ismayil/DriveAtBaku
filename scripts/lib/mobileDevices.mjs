const chrome = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const linux = `Mozilla/5.0 (X11; Linux x86_64) ${chrome}`;
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1';
const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const android = `Mozilla/5.0 (Linux; Android 14; Pixel 8) ${chrome.replace(' Safari', ' Mobile Safari')}`;
const tablet = `Mozilla/5.0 (Linux; Android 14; SM-X910) ${chrome}`;
const mobile = (name, userAgent, platform, hints = null, coarse = true, touch = 5) => ({ name, userAgent, platform, hints, coarse, touch, blocked: true });
export const MOBILE_DEVICES = [
  mobile('android-chrome-phone', android, 'Linux armv8l', { platform: 'Android', mobile: true }),
  mobile('android-chrome-tablet', tablet, 'Linux armv8l', { platform: 'Android', mobile: false }),
  mobile('android-chrome-desktop-tablet', linux, 'Linux x86_64', { platform: 'Linux', mobile: false }),
  mobile('android-desktop-with-mouse', linux, 'Linux x86_64', { platform: 'Linux', mobile: false }, false),
  mobile('android-desktop-single-touch', linux, 'Linux x86_64', null, false, 1),
  mobile('android-samsung-internet', tablet + ' SamsungBrowser/29.0', 'Linux armv8l'),
  mobile('android-samsung-desktop', linux + ' SamsungBrowser/29.0', 'Linux x86_64', null, false),
  mobile('android-firefox', 'Mozilla/5.0 (Android 14; Tablet; rv:144.0) Gecko/144.0 Firefox/144.0', 'Linux armv8l'),
  mobile('android-firefox-desktop', 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0', 'Linux x86_64', null, false),
  mobile('android-edge', android + ' EdgA/143.0', 'Linux armv8l'),
  mobile('android-opera', android + ' OPR/89.0', 'Linux armv8l'),
  mobile('android-brave', android, 'Linux armv8l', { platform: 'Android', mobile: true }),
  mobile('android-webview', android.replace('Android 14;', 'Android 14; wv;'), 'Linux armv8l'),
  mobile('android-client-hints-only', 'Privacy browser', '', { platform: 'Android', mobile: false }),
  mobile('iphone-safari', iphone, 'iPhone'),
  mobile('iphone-chrome', iphone + ' CriOS/143.0', 'iPhone'),
  mobile('iphone-firefox', iphone + ' FxiOS/144.0', 'iPhone'),
  mobile('iphone-edge', iphone + ' EdgiOS/143.0', 'iPhone'),
  mobile('iphone-opera', iphone + ' OPiOS/5.0', 'iPhone'),
  mobile('iphone-desktop-mode', mac, 'MacIntel'),
  mobile('ipad-safari', ipad, 'iPad'),
  mobile('ipad-desktop-mode', mac, 'MacIntel'),
  mobile('ipad-desktop-with-mouse', mac, 'MacIntel', null, false),
  mobile('ipad-chrome-desktop', mac + ' CriOS/143.0', 'MacIntel', null, false),
  mobile('kindle-silk', tablet + ' Silk/130.0', 'Linux armv8l'),
  mobile('windows-touch-tablet', `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`, 'Win32', { platform: 'Windows', mobile: false }),
  mobile('unknown-browser', '', '', null, false, 0),
];
export const DESKTOP_DEVICES = [
  { name: 'windows-desktop', userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`, platform: 'Win32' },
  { name: 'mac-safari', userAgent: mac, platform: 'MacIntel' },
  { name: 'linux-desktop', userAgent: linux, platform: 'Linux x86_64' },
  { name: 'windows-touch-laptop-with-mouse', userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`, platform: 'Win32', touch: 10 },
  { name: 'chromebook', userAgent: `Mozilla/5.0 (X11; CrOS x86_64 16181.0.0) ${chrome}`, platform: 'Linux x86_64' },
].map(device => ({ touch: 0, hints: null, coarse: false, blocked: false, ...device }));
