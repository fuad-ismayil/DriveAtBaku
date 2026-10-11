export const INDICATOR_MODES = ['off', 'left', 'right', 'hazard'];

export function isNewerSequence(next, previous) {
  const delta = ((next >>> 0) - (previous >>> 0)) >>> 0;
  return delta > 0 && delta < 0x80000000;
}
