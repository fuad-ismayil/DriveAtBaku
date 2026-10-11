import { PLATE_LETTERS, normalizePlateSettings, plateRegistration } from './licensePlateSettings.js';
export function createLicensePlateControls(root, { getSettings, onChange, onInspect }) {
  const find = id => root.querySelector(`#plate-${id}`);
  const ui = Object.fromEntries(['enabled', 'options', 'region', 'letters', 'serial', 'details', 'format', 'preview', 'fit-note', 'disabled-note'].map(id => [id, find(id)]));
  // Keep unfinished edits visible without saving an invalid registration.
  let editing = null;
  const setToggle = (button, checked) => {
    button.setAttribute('aria-checked', String(checked));
    button.querySelector('.plate-toggle-state').textContent = checked ? 'ON' : 'OFF';
  };
  function render() {
    const s = getSettings();
    setToggle(ui.enabled, s.enabled);
    ui.options.hidden = !s.enabled;
    ui['disabled-note'].hidden = s.enabled;
    for (const key of ['region', 'letters', 'serial', 'format']) if (key !== editing && ui[key].value !== s[key]) ui[key].value = s[key];
    setToggle(ui.details, s.identity === 'older');
    const preview = ui.preview;
    preview.dataset.format = s.format; preview.dataset.identity = s.identity;
    preview.querySelectorAll('.plate-preview-separator').forEach(separator => { separator.textContent = s.hyphens ? '-' : ''; });
    preview.setAttribute('aria-label', `Edit Azerbaijani plate ${plateRegistration(s)}`);
    ui['fit-note'].textContent = s.format === 'compact' ? 'Square plate · two rows' : 'Long plate · one row';
  }
  const commit = patch => { onChange(normalizePlateSettings({ ...getSettings(), ...patch })); render(); };
  ui.enabled.onclick = () => {
    const enabled = !getSettings().enabled; commit({ enabled });
    if (!enabled) { resetView(); onInspect('car'); }
  };
  ui.details.onclick = () => {
    const enabled = getSettings().identity !== 'older';
    commit({ identity: enabled ? 'older' : 'new', hyphens: enabled });
  };
  ui.format.onchange = () => commit({ format: ui.format.value });
  for (const [key, count] of [['region', 2], ['letters', 2], ['serial', 3]]) {
    const input = ui[key];
    const sanitize = value => key === 'letters'
      ? value.toUpperCase().split('').filter(c => PLATE_LETTERS.includes(c)).join('').slice(0, count)
      : value.replace(/\D/g, '').slice(0, count);
    input.onfocus = () => { editing = key; input.select(); };
    input.oninput = event => {
      if (event.isComposing) return;
      const raw = input.value, cursor = input.selectionStart, value = sanitize(raw);
      if (raw !== value) {
        input.value = value;
        const position = sanitize(raw.slice(0, cursor)).length;
        input.setSelectionRange(position, position);
      }
      editing = key;
      // Pad partial digits and retain the saved second letter while typing.
      // Every valid keystroke updates the mounted plate through the same path.
      if (value && (key === 'letters' || Number(value) > 0)) {
        commit({ [key]: key === 'letters' ? value + getSettings().letters.slice(value.length) : value });
      }
    };
    input.oncompositionend = () => input.oninput({ isComposing: false });
    input.onblur = () => { editing = null; render(); };
    input.onkeydown = event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); input.blur(); }
    };
    input.onpaste = event => {
      const match = event.clipboardData?.getData('text').trim().toUpperCase().match(/^(\d{2})[\s-]*([A-Z]{2})[\s-]*(\d{3})$/);
      if (!match || ![...match[2]].every(c => PLATE_LETTERS.includes(c)) || !Number(match[1]) || !Number(match[3])) return;
      event.preventDefault();
      editing = null;
      commit({ region: match[1], letters: match[2], serial: match[3] });
      ui.serial.focus(); ui.serial.select();
    };
  }
  const views = [...root.querySelectorAll('[data-plate-view]')];
  const resetView = () => views.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.plateView === 'car')));
  views.forEach(button => { button.onclick = () => {
    views.forEach(b => b.setAttribute('aria-pressed', String(b === button))); onInspect(button.dataset.plateView);
  }; });
  return { render, resetView };
}
