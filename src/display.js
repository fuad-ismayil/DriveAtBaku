import presentation from '../shared/ui-spec.json' with { type: 'json' };
export const ASPECT_RATIOS = Object.freeze({ auto: null, '16:9': 16 / 9, '16:10': 1.6, '21:9': 21 / 9, '4:3': 4 / 3 });
const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
export function fittedDisplay(width, height, choice = 'auto') {
  const ratio = ASPECT_RATIOS[choice];
  const w = ratio ? Math.min(width, height * ratio) : width;
  const h = ratio ? w / ratio : height;
  return { width: Math.round(w), height: Math.round(h), left: (width - w) / 2, top: (height - h) / 2 };
}
export function displaySize() { const rect = document.getElementById('app')?.getBoundingClientRect(); return { width: rect?.width || innerWidth, height: rect?.height || innerHeight }; }
export function frameLimit() { return Number(read('baku-frame-limit', '0')) || 0; }
export function installDisplay() {
  const appStyle = document.getElementById('app').style;
  appStyle.setProperty('--minimap-diameter', `${presentation.minimap.diameter}px`);
  appStyle.setProperty('--minimap-canvas', `${presentation.minimap.diameter - presentation.minimap.inset * 2}px`);
  const aspect = document.getElementById('desktop-aspect'), limit = document.getElementById('desktop-frame-limit'), fullscreen = document.getElementById('desktop-fullscreen');
  aspect.value = Object.hasOwn(ASPECT_RATIOS, read('baku-aspect-ratio', 'auto')) ? read('baku-aspect-ratio', 'auto') : 'auto';
  limit.value = String(frameLimit());
  const resize = () => { const fit = fittedDisplay(innerWidth, innerHeight, aspect.value); const app = document.getElementById('app');
    for (const [key, value] of Object.entries(fit)) app.style.setProperty(`--view-${key}`, `${value}px`); dispatchEvent(new Event('displayresize')); };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* optional storage */ } };
  aspect.onchange = () => { save('baku-aspect-ratio', aspect.value); resize(); };
  limit.onchange = () => save('baku-frame-limit', limit.value);
  const toggle = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { fullscreen.checked = Boolean(document.fullscreenElement); } };
  fullscreen.onchange = toggle;
  document.addEventListener('fullscreenchange', () => { fullscreen.checked = Boolean(document.fullscreenElement); resize(); });
  addEventListener('keydown', event => { if (event.code === 'F11' || (event.code === 'Enter' && event.altKey)) { event.preventDefault(); toggle(); } });
  addEventListener('resize', resize); resize();
}
