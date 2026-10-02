// Civilian Azerbaijani plates only. The letters follow AZS 599's Latin alphabet.
export const PLATE_LETTERS = 'ABCDEFGHJKLMNOPRSTUVXYZ';
export const PLATE_FORMATS = Object.freeze({
  long: { width: .520, height: .110, radius: .013, label: 'Standard long · 520 × 110 mm' },
  compact: { width: .300, height: .150, radius: .013, label: 'Compact / two-row · 300 × 150 mm' },
});
export const DEFAULT_PLATE = Object.freeze({ enabled: true, region: '10', letters: 'AA', serial: '001', hyphens: true, format: 'long', identity: 'older' });
export function normalizePlateSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const digits = (v, count, fallback) => {
    const s = String(v ?? '').replace(/\D/g, '').slice(0, count);
    return s && Number(s) > 0 ? s.padStart(count, '0') : fallback;
  };
  const letters = String(value.letters ?? '').toUpperCase().split('').filter(c => PLATE_LETTERS.includes(c)).slice(0, 2).join('');
  // Preserve the appearance of previously saved modern/classic selections.
  const identity = value.identity === 'new' || value.identity === 'classic' ? 'new' : 'older';
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_PLATE.enabled,
    region: digits(value.region, 2, DEFAULT_PLATE.region),
    letters: letters.length === 2 ? letters : DEFAULT_PLATE.letters,
    serial: digits(value.serial, 3, DEFAULT_PLATE.serial),
    hyphens: identity === 'new' ? false : typeof value.hyphens === 'boolean' ? value.hyphens : DEFAULT_PLATE.hyphens,
    format: Object.hasOwn(PLATE_FORMATS, value.format) ? value.format : DEFAULT_PLATE.format,
    identity,
  };
}
export function plateRegistration(value) {
  const s = normalizePlateSettings(value), separator = s.hyphens && s.format === 'long' ? '-' : ' ';
  return [s.region, s.letters, s.serial].join(separator);
}
export function readPlateSettings(storage, vehicleId) {
  try { return normalizePlateSettings(JSON.parse(storage?.getItem(`baku-plate-${vehicleId}`) ?? 'null')); }
  catch { return { ...DEFAULT_PLATE }; }
}
export function savePlateSettings(storage, vehicleId, value) {
  const settings = normalizePlateSettings(value);
  try { storage?.setItem(`baku-plate-${vehicleId}`, JSON.stringify(settings)); } catch { /* optional storage */ }
  return settings;
}
