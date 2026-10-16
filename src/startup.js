import { VERSION_LABEL, RELEASE_URL } from './release.js';
import { deviceAccess } from './deviceGate.js';
import './desktop.css';
let loadingScreen;

// Start the small, independent introduction before requesting the game module.
for (const element of document.querySelectorAll('[data-version]')) element.textContent = VERSION_LABEL;
for (const element of document.querySelectorAll('[data-version-inline]')) element.textContent = VERSION_LABEL;
for (const element of document.querySelectorAll('[data-download]')) element.href = RELEASE_URL;
const access = deviceAccess();
if (access.blocked) {
  document.getElementById('loading').hidden = true;
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('mobile-download').hidden = false;
  document.body.classList.add('mobile-download-only');
  if (access.platform === 'apple') {
    document.getElementById('mobile-app-copy').textContent = 'Play on a desktop computer, or get the native app for an Android device.';
    document.getElementById('mobile-download-label').textContent = 'View Windows & Android downloads';
    document.getElementById('mobile-download-note').textContent = 'An iPhone or iPad app is not available. The Android APK does not run on iOS or iPadOS.';
  } else if (access.platform !== 'android') {
    document.getElementById('mobile-download-label').textContent = 'View Windows & Android downloads';
    document.getElementById('mobile-download-note').textContent = 'Choose the Windows ZIP or Android APK for a supported device.';
  }
} else {
  document.getElementById('mobile-download').hidden = true;
  document.getElementById('loading').hidden = false;
  const { installDisplay } = await import('./display.js');
  installDisplay();
  document.querySelector('.loading-scene').src = '/assets/loading/city.webp';
  ({ loadingScreen } = await import('./loadingScreen.js'));
  loadingScreen.begin();
  import('./main.js').catch(error => {
    console.error('Game startup failed:', error);
    loadingScreen.fail(error);
  });
}
