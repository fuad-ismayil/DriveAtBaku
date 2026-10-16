// Screen width is deliberately excluded: desktop mode and external displays
// must not make a phone or tablet eligible to download the Web game.
export function deviceAccess(nav = globalThis.navigator, browser = globalThis) {
  if (!nav) return { blocked: true, platform: 'unknown' };
  const ua = String(nav.userAgent || '');
  const identity = `${ua} ${nav.platform || ''} ${nav.userAgentData?.platform || ''}`;
  const touch = Number(nav.maxTouchPoints ?? nav.msMaxTouchPoints ?? 0) > 0;
  const coarse = Boolean(browser.matchMedia?.('(pointer: coarse)').matches);
  const apple = /iPad|iPhone|iPod|iOS|iPadOS/i.test(identity) || (touch && /Mac/i.test(identity));
  const android = /Android/i.test(identity);
  const mobile = Boolean(nav.userAgentData?.mobile) || /Mobile|Tablet|Silk|Kindle|PlayBook|Windows Phone/i.test(identity);
  // Android desktop mode can mask BOTH the UA and client hints as Linux.
  // iPadOS similarly presents a Mac identity, even with a keyboard attached.
  const desktopTablet = touch && /Linux|Mac/i.test(identity) && !/CrOS/i.test(identity);
  const knownDesktop = /Windows|Win32|Win64|Macintosh|MacIntel|Linux|CrOS|FreeBSD/i.test(identity);
  return {
    blocked: apple || android || mobile || desktopTablet || (touch && coarse) || !knownDesktop,
    platform: apple ? 'apple' : android ? 'android' : 'unknown',
  };
}
