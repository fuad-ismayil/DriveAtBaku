import { PLATE_LETTERS, normalizePlateSettings, plateRegistration } from './licensePlateSettings.js';
export function createLicensePlateControls(root, { getSettings, onChange, onInspect }) {
  const find = id => root.querySelector(`#plate-${id}`);
  const ui = Object.fromEntries(['enabled', 'options', 'region', 'letters', 'serial', 'hyphens', 'format', 'identity', 'preview', 'fit-note'].map(id => [id, find(id)]));
  function render() {
    const s = getSettings();
    ui.enabled.setAttribute('aria-checked', String(s.enabled)); ui.enabled.textContent = s.enabled ? 'ON' : 'OFF';
    ui.options.hidden = !s.enabled;
    for (const key of ['region', 'letters', 'serial', 'format', 'identity']) if (ui[key].value !== s[key]) ui[key].value = s[key];
    ui.hyphens.disabled = s.format === 'compact' || s.identity === 'new';
    ui.hyphens.setAttribute('aria-checked', String(s.hyphens && s.format === 'long'));
    ui.hyphens.textContent = s.format === 'compact' ? 'OFF' : s.hyphens ? 'ON' : 'OFF';
    const preview = ui.preview, separator = s.hyphens && s.format === 'long' ? '-' : ' ';
    preview.dataset.format = s.format; preview.dataset.identity = s.identity;
    preview.querySelector('.plate-preview-region').textContent = s.region + (s.format === 'long' ? separator : '');
    preview.querySelector('.plate-preview-letters').textContent = s.letters;
    preview.querySelector('.plate-preview-separator').textContent = separator;
    preview.querySelector('.plate-preview-serial').textContent = s.serial;
    preview.setAttribute('aria-label', `Azerbaijani plate ${plateRegistration(s)}`);
    ui['fit-note'].textContent = s.format === 'compact' ? 'Two-row Azerbaijani layout uses no hyphens. Both mounts adapt to the taller plate.'
      : s.identity === 'new' ? 'New style: straight flag and AZ, without hyphens or an RFID panel.'
      : 'Older style: straight flag and RFID panel. Both plates fitted individually to this car.';
  }
  const commit = patch => { onChange(normalizePlateSettings({ ...getSettings(), ...patch })); render(); };
  ui.enabled.onclick = () => {
    const enabled = !getSettings().enabled; commit({ enabled });
    if (!enabled) { resetView(); onInspect('car'); }
  };
  ui.hyphens.onclick = () => commit({ hyphens: !getSettings().hyphens });
  ui.format.onchange = () => commit({ format: ui.format.value });
  ui.identity.onchange = () => commit({ identity: ui.identity.value, hyphens: ui.identity.value === 'older' });
  for (const [key, count] of [['region', 2], ['letters', 2], ['serial', 3]]) {
    ui[key].oninput = () => {
      const value = key === 'letters' ? ui[key].value.toUpperCase().split('').filter(c => PLATE_LETTERS.includes(c)).join('').slice(0, count)
        : ui[key].value.replace(/\D/g, '').slice(0, count);
      ui[key].value = value;
      if (value.length === count && (key === 'letters' || Number(value) > 0)) commit({ [key]: value });
    };
    ui[key].onblur = () => {
      const value = ui[key].value;
      if (value && (key !== 'letters' || value.length === count)) commit({ [key]: value }); else render();
    };
  }
  const views = [...root.querySelectorAll('[data-plate-view]')];
  const resetView = () => views.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.plateView === 'car')));
  views.forEach(button => { button.onclick = () => {
    views.forEach(b => b.setAttribute('aria-pressed', String(b === button))); onInspect(button.dataset.plateView);
  }; });
  return { render, resetView };
}
