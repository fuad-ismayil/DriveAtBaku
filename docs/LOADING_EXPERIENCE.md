# Interface and loading

The v1.0.0 Web experience starts with a device check. Phones and tablets show
the lightweight native-download page and never start the game loader or fetch
city assets, vehicles, audio or loading photographs. This includes Android
desktop mode and iPadOS desktop identities at any viewport size. See the
[mobile download policy and browser matrix](MOBILE_DOWNLOAD_GATE.md).

The loading screen, main menu, garage, controls, pause settings and driving HUD share a Liquid Glass design. Transparent capsules and rounded panels show the scene behind them, with neutral shading, soft reflections and a fine illuminated rim. The background supplies the color; the shared glass material does not impose a warm or brown tint.

![v1.0.0 main menu with versioned native downloads and current map and HUD highlights](images/web-menu-v1.0.0.webp)

*Released v1.0.0 Web menu, captured on 16 October 2026. The
[screenshot gallery](SCREENSHOTS.md) also shows the Windows interface,
current driving HUD, full map and mobile download pages.*

## Shared material and icons

The material uses light 5 px backdrop diffusion, opposing rim highlights and soft inner light. Buttons use translucent fills and a masked edge. The main menu adds a local neutral shadow behind its copy; text-dense dialogs and instruments use a stronger backing for readability. Pause uses a separate 2 px background blur so it does not stack two heavy blur layers.

| File | Responsibility |
| --- | --- |
| `index.html` | Interface markup, initial loading screen and shared inline SVG symbols |
| `src/glass.css` | Neutral material tokens, lens rim, icon sizing and transparency fallbacks |
| `src/style.css` | Responsive menus, garage, controls, settings, multiplayer and driving instruments |
| `src/licensePlate.css` | Plate editor layout and locally bundled plate fonts; imported by `style.css` |
| `src/loading.css` | Loading layout, scene drift, crossfades and progress animation |
| `src/loadingScreen.js` | Scene selection, slideshow controls, progress reporting and failure handling |
| `src/startup.js` | Applies the device gate before importing the desktop loader and game |
| `src/desktop.css` | Desktop aspect sizing, compact instruments and menu refinements |

`glass.css` and `loading.css` load directly from the document before the game bundle. General interface text uses local system fonts; the plate editor retains its bundled DIN fonts. No additional WebGL scene, remote image service or UI font download is required to show the loading screen.

SVG icons share rounded strokes and explicit flex/grid slots so their placement does not depend on font baselines. Navigation uses straight arrows, the brand uses a road mark, and external links use a diagonal arrow. Day/night and audio toggles update the icon reference and text label independently.

Desktop browser windows keep panels inside the viewport and allow long settings/garage panels to scroll, including small windows and short landscape layouts. Native Android retains its touch interface. The Web phone/tablet page has a scrollable download card with Android and iOS/iPadOS-specific copy.

Keyboard focus remains visible. Reduced motion disables drift, sweeps, entry animations and animated transitions. Reduced transparency and browsers without backdrop blur receive a stronger neutral backing. These settings preserve labels and controls.

## Driving HUD

The desktop HUD combines a 176 px circular camera-up minimap with a transparent
264 × 62 px speed/gear/RPM instrument centered at the bottom. ABS, TCS and ESC
appear as plain text in that instrument. White multiplayer names above cars
use the shared Godot sizing, outline and distance fade without a background.
The full city map is north-up and offers zoom, Your car and Fit city controls.
Vehicle physics and suspension behavior are unchanged.

- **Enabled:** readable assist text and an updated accessible pressed state.
- **Disabled:** the label is hidden and its accessible pressed state is false.
- **Intervening:** a restrained mint text highlight.

The controls retain the **1 / 2 / 3** keyboard shortcuts and descriptive accessible labels. **Escape** opens the pause settings with visible keyboard focus. Web offers Main menu and Download; native Windows and Android offer Quit game. Native pause and map menus release the cursor for mouse interaction.

## Loading artwork and slideshow

The four loading scenes were captured on **15 October 2026** from the game renderer at native **3840 × 2160**, with the former Cinematic preset and city, landmark, foliage and room-light detail. Current presets are Performance, Balanced, High and Ultra; old Cinematic preferences migrate to High.

| Scene | Vehicle and conditions |
| --- | --- |
| `city.webp` | Ferrari by day along the Caspian boulevard |
| `night.webp` | Ferrari after dark, with illuminated city windows and Government House |
| `weather.webp` | Mercedes-AMG on wet streets |
| `garage.webp` | Toyota Prado in the city |

The images are composed with the car to the right of the loading story. High-quality WebP encoding preserves native detail without upscaling or artificial sharpening. Each image has a **2,200,000-byte** transfer budget. After the desktop device gate passes, the first image loads; later images decode before a 1.7-second crossfade. A missing later image leaves the current scene visible.

The slideshow advances every seven seconds with a restrained photographic drift. Chapter capsules support click and keyboard selection, and a dedicated button pauses/resumes automatic changes and motion. Driver notes rotate independently every ten seconds. Hidden tabs stop scheduling chapter and note changes. Reduced motion keeps scene selection available and removes animated transitions.

The [capture metadata](../public/assets/loading/captures.json) records the capture time, camera/target coordinates, vehicle, conditions and actual drawing-buffer dimensions. The game captures retain the underlying asset terms described in [asset credits](ASSET_CREDITS.md).

## Startup, progress and errors

`assetTransfer.js` reads fetch streams incrementally, including packed map parts. `loadingScreen.js` aggregates received bytes against compressed map sizes and startup file sizes recorded in `public/generated/asset-manifest.json`. Planned downloads include the route, street/building packs, road collision model, Ferrari and saved garage vehicle when applicable.

The percentage describes **asset downloads**. Decompression, texture preparation, road contact and shader compilation report their actual stages separately. Unknown totals display received bytes without inventing a percentage. Loading artwork and the room-window mask are separate from these planned download totals. `pack-assets` refreshes the manifest sizes when repacking game assets.

The game skips rendering the unfinished city. Map preparation yields between batches so the loading screen can repaint. Government House detail, its settled flag cloth, independent room lights, the room-window mask and tree crown coordinates are prepared before shader warmup. After compilation, the main menu renders behind the loading screen for two frames, then appears through a 1.1-second dissolve. Focus stays out of the underlying menu during that transition.

Timers, startup error listeners and image references are released afterward. Download, graphics and startup failures leave a readable explanation and retry button; chapter controls are disabled on failure. Retry reloads the page to start again.

## Regenerating the artwork

Install the project dependencies and Google Chrome as described in [verification](VERIFICATION.md). Use a development server: capture instrumentation targets `src/main.js` and does not apply to a production preview.

Start a server in one terminal:

```sh
npm run dev -- --port 5186 --strictPort
```

In another terminal, using PowerShell:

```powershell
$env:GAME_URL = 'http://127.0.0.1:5186'
npm run capture-loading-art -- --preview
npm run capture-loading-art
npm run verify-loading
```

In POSIX shells, use `export GAME_URL=http://127.0.0.1:5186` before the same commands. Both capture and interface-browser scripts otherwise default to `http://127.0.0.1:5188`; set `GAME_URL` to the server actually running.

Preview mode writes 1920 × 1080 PNG compositions and metadata to ignored `artifacts/liquid-glass/scenes/`. Full capture overwrites the four runtime WebP files and `public/assets/loading/captures.json`. The capture script instruments the current game in its own Chrome session, disables hot reload during capture, settles each view and encodes at WebP quality 96. It adds no production debug hooks. Review the images and run the artwork checks before committing regenerated files.

## Verification

```powershell
$env:GAME_URL = 'http://127.0.0.1:5186'
npm run verify-loading
npm run verify-interface-browser
```

`verify-loading` covers streamed progress, unknown totals, cancellation, HTTP failures, manifest accuracy, native 4K dimensions and image budgets. It runs within the standard non-browser verification suite.

`verify-interface-browser` checks loading layouts at 1440 × 900, 1920 × 1080, 390 × 844, 844 × 390 and 320 × 568. Main menu, pause and HUD checks use the same sizes with 1280 × 720 in place of 1920 × 1080. It exercises chapter selection, pause/resume, reduced motion, error/retry, SVG rendering and vertical centering, time/audio icon changes, the multiplayer form, garage selection, controls, aid keyboard states and return to the menu. Screenshots and `verification.json` remain under ignored `artifacts/liquid-glass/`.

The loader's progress/error scenarios are isolated from heavy map downloads, followed by a real game startup for menu and driving checks. The multiplayer check covers its form, not joining a relay. Browser checks do not establish universal contrast, sustained frame rate or full-route visual fidelity; also review a throttled production load before release.
