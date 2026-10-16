# Mobile and tablet download restriction

Phones and tablets receive a lightweight page linking to native downloads.
They do not start the Web game's asset transfer. This policy applies at every
screen size, in landscape, split view, desktop-site mode and with a mouse or
keyboard attached. It has no URL parameter or on-page override.

`src/deviceGate.js` combines operating-system/browser identifiers, client hints,
touch capability and primary pointer type. It recognizes Android without a
`Mobile` token, Android desktop mode masked as Linux, and iPadOS masked as a Mac.
It does not use viewport width. Touch-enabled Mac/Linux desktop identities are
treated conservatively as potential tablets; some touch-enabled Linux laptops
therefore also receive the download page. Ordinary desktops, including a
Windows touch laptop with a fine primary pointer, remain supported.

Unknown or unavailable device identities receive the small page. The initial
HTML is also download-only: links work without JavaScript, the desktop loader
is hidden, and loading artwork has no `src`. Only the eligible desktop branch
of `src/startup.js` imports display controls, the loading module and the game.
Mobile visitors request HTML, lightweight interface code/styles and branding;
they do not request city/vehicle models, audio, decoders or loading images.

Android visitors get an Android download button. iPhone/iPad visitors see an
explicit note that the Android APK cannot run on iOS/iPadOS; their button shows
the supported Windows and Android packages. No iOS app is advertised.

Chrome's [desktop-mode documentation](https://developer.chrome.com/blog/desktop-mode)
explains why Android tablet user agents **and** client hints can report Linux.
MDN documents [touch-point detection](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/maxTouchPoints).
Browser identities can be deliberately spoofed; the policy covers the identity
and capability signals actually exposed by the browser, rather than claiming
to identify hardware from a completely disguised desktop browser.

## Verification

`npm run verify-mobile-gate` checks 27 blocked identities and five desktop
controls at six widths. `npm run verify-mobile-download` opens the production
build in Chromium, Firefox and WebKit: 81 browser/profile cases, repeated
portrait/landscape/tablet/4K resizes, and JavaScript-disabled fallbacks. The
profiles include Safari, Chrome, Firefox, Edge, Opera, Brave, Samsung Internet,
WebView and Silk identities, plus iPad and Android desktop-site modes.

The browser suite records requests and fails on **any attempted** game request.
It aborts such requests to avoid transferring the large files when detecting a
regression. It also checks links, version labels, layout and iOS-specific copy.
These are automated browser-engine and identity simulations, not a claim that
every physical phone or third-party browser was tested.

Run against a local production preview or the deployed website:

```powershell
npm run build
npm run preview -- --port 5197
# In a second terminal:
npx playwright install chromium firefox webkit
npm run verify-mobile-download
$env:GAME_URL = 'https://www.driveatbaku.games'
npm run verify-mobile-download
```

The GitHub mobile-download job runs the production checks on Linux for every
main push, PR or manually dispatched verification. Reports stay in ignored
`artifacts/release-review/mobile/`.
