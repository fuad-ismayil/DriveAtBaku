import release from '../shared/release.json' with { type: 'json' };
import { deviceAccess } from './deviceGate.js';
export const VERSION = release.version;
export const VERSION_LABEL = `v${VERSION}`;
export const RELEASE_URL = release.releaseUrl;
export function isMobileBrowser(nav = globalThis.navigator, browser = globalThis) {
  return deviceAccess(nav, browser).blocked;
}
