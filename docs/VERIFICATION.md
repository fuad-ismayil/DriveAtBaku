# Verification

Install the locked client dependencies with `npm ci` and relay dependencies with `npm ci --prefix server`. `npm run verify` runs all 26 non-browser suites sequentially and stops on the first failure. These cover vehicle handling and idle drivetrain, both cameras, engine audio, minimap, models/plates/loading, ground and world collision, rendering invariants, foliage, independent room lighting, Government House window geometry and materials, flag cloth physics, tire effects, culling/distance, GPU-timer/resolution logic, indicator state/lens fitment and an isolated three-client indicator relay test.

```sh
npm run verify
npm run build
```

The GitHub **Verify** workflow runs these checks, the production build and a local relay traffic test on Node.js 24/Linux. It does not make GPU-performance or visual-quality claims. Vite currently reports a large JavaScript chunk; the warning is retained and the build succeeds.

## Native Android and cross-platform checks

The [Android build guide](../android/README.md) covers Windows prerequisites,
preparation and `android/build.ps1 -Target Verify`. Native verification checks
the original equations/contact fixtures, touch controls, PCM loops, mixer
targets, light states and protocol compatibility. Generated fixtures, SDKs,
exported binaries and raw recordings stay outside Git; Godot source UIDs and
import/export configuration remain versioned.

The [16 October S9 results](android/DEVICE_RESULTS.md) record exact agreement
for 57,600 physics samples, 564 plate/audio checks, and 155 checks in the full
Android/Chrome multiplayer run over 16 phases and four cars. The web test uses
the actual Join gesture under normal autoplay policy, measures remote audio,
and acknowledges each measured phase before advancing. It checks engine
RPM/load/shift targets, actual wheel-slip sound, distance, pause and room
cleanup; the native master recording also contains output for every phase.
See the [audio/plate report](android/AUDIO_AND_PLATE_FIXES.md) for reproduction,
idle boundary measurements and the remaining public-client deployment step.
The Linux workflow does not run the Godot toolchain or certify device behavior.

The pre-push review against `73e94a2` reran all 26 web suites and the production
build successfully. All 29 staged JavaScript modules/tools passed syntax
checks, all 79 checked local documentation links resolved, and the staged diff
passed whitespace checks. The staged source contains no large generated
artifacts; ignore checks cover assets/cache, native libraries, APKs, local CMake
configuration and signing credentials. Raw release-review output remains in
ignored `artifacts/android/push-web-verification.log` and `push-web-build.log`.

## Browser checks

Browser scripts use the declared `playwright`, `pngjs` and `sharp` development dependencies. Install Google Chrome separately; the runners launch its `chrome` channel. Use a hardware-accelerated WebGL 2 session. Some checks reject software rendering or require GPU timer queries, so generic headless CI is insufficient for their measurements.

Start a dedicated client server in one terminal:

```sh
npm run dev -- --port 5186 --strictPort --config scripts/performance.vite.config.mjs
```

In another terminal, set the common game URL. In PowerShell:

```powershell
$env:GAME_URL = 'http://127.0.0.1:5186'
npm run verify-interface-browser
npm run verify-resolution-browser
npm run verify-graphics-settings-browser
npm run verify-city-map-browser
npm run verify-city-cleanup-browser
npm run verify-foliage-browser
npm run verify-government-house-browser
npm run verify-room-lights-browser
npm run verify-weather
npm run verify-vehicle-water
npm run verify-vehicle-water-distance
npm run verify-indicators-browser
```

In POSIX shells, use `export GAME_URL=http://127.0.0.1:5186` before the same commands. Generated screenshots/JSON remain in ignored `artifacts/`.

| Suite | Main coverage |
| --- | --- |
| `verify-resolution-browser` | Presets, Native/fixed sizes, DPR/aspect ratios, AO switching, persistence and resource cycling |
| `verify-graphics-settings-browser` | Menu layout/navigation, independent distances, persistence and rendering |
| `verify-interface-browser` | Liquid Glass layouts at five viewport sizes, 4K scenes, slideshow controls, reduced motion, progress/retry, icon rendering/centering, time/audio icon state, garage, controls, HUD aid states and pause navigation |
| `verify-city-map-browser` | City visibility, occlusion, weather and driver fallback |
| `verify-city-cleanup-browser` | Audited areas, moving-camera replay and optional two-client replication |
| `verify-foliage-browser` | Rounded crown lighting, edge-on cards, winding continuity, no emission, three presets, weather/day/night and both batching paths |
| `verify-government-house-browser` | Landmark views, flag motion/attachment/fold lighting, night-only lighting, presets/weather, both batching paths and stable resources |
| `verify-room-lights-browser` | Actual window pixels, independent activity, day gating, presets/weather, both batching paths and stable resources |
| `verify-weather` | Rain, wet-road reflections and dry restoration |
| `verify-vehicle-water` | Water, drying and unchanged dry pixels on all four cars |
| `verify-vehicle-water-distance` | Droplet detail versus wet film across cars, views, paints and lighting |
| `verify-indicators-browser` | Four cars, all five weather presets/day/night, lamp pixels, mode/input guards, garage/pause/reset, stable resources and real two-client replication/reconnect/loading cleanup |

Set `HEADED=1` for `verify-resolution-browser` to exercise native normal/maximized/fullscreen window states. Set `CITY_MAP_FALLBACK=1` for the city-map check or `MULTI_DRAW_OFF=1` for the graphics-settings check to test the non-multi-draw path.

For the indicator browser suite, run the updated relay with `npm start --prefix server` first. Its default address is `ws://127.0.0.1:8787`; `INDICATOR_TEST_SERVER` overrides it. The standalone `verify-indicator-network` test starts its own relay on an available port, so it does not need a separately running server. Screenshots and results stay under ignored `artifacts/indicators/`.

For the two-client case, start the relay with `PORT=8788`, then set `CITY_MULTIPLAYER_TEST=1` and run `verify-city-cleanup-browser`. `CITY_TEST_SERVER` overrides the default `ws://127.0.0.1:8788`. The [relay load test](../server/README.md#load-test) is separate.

## Profiling

`npm run profile-engine` records the current renderer at 1080p/720p across presets and scenarios; `npm run profile-performance` retains the earlier harness. Both need the running game server. Use `GAME_URL` consistently and run profiling without other GPU-heavy checks at the same time.

For a shorter current-source matrix in PowerShell:

```powershell
$env:GAME_URL = 'http://127.0.0.1:5186'
$env:VARIANTS = 'current'
$env:QUALITIES = 'balanced,performance,cinematic'
$env:RESOLUTIONS = '1080,720'
$env:SCENARIOS = 'idle,urban,drive,night,rain,garage'
$env:REPEATS = '1'
$env:FRAMES = '120'
$env:WARMUP = '60'
npm run profile-engine -- artifacts/performance/release
```

`node scripts/probe_adapter.mjs` compares adapter selection in default/high-performance Chrome launches. `compare_engine.mjs` and `compare_performance.mjs` require saved measurements for both variants; they cannot invent a baseline from a fresh clone. `report_engine.mjs` updates the historical 1080p report from its original comparison directories. See [that investigation](history/ENGINE_PERFORMANCE_INVESTIGATION.md) for pass profiling, repeat ordering and timing limitations.

For release review, also check a production preview, required asset requests, fresh and saved settings, day/night and precipitation, camera motion, and local multiplayer. Automated checks cover specific scenarios; they do not establish full-route visual fidelity, sustained FPS or long-session stability on every device.

## Environment update verification — 15 October 2026

The complete environment changes since `e843971` were reviewed on Windows with Node.js 24.13.1. Browser checks used Chrome, Intel Iris Xe through ANGLE/Direct3D 11, and device pixel ratio 1. The three new environment suites each exercised both `WEBGL_multi_draw` and the forced fallback path.

| Check | Result |
| --- | --- |
| `npm run verify` | All 26 non-browser suites passed, including collision/geometry preservation, room activity, landmark detail, flag cloth and foliage |
| `npm run build` | Passed; the existing large JavaScript chunk warning remains |
| `npm run build-window-lighting` | Both generated files reproduced byte for byte: 57 layouts, 139 bindings and 1,678 window templates |
| `npm run verify-government-house-browser` | Passed at 1600 × 1000: seven views, cloth motion, three presets, day/night restoration, weather, occlusion and stable resources |
| `npm run verify-room-lights-browser` | Passed at 1440 × 900: real window pixels, independent activity, excluded glass, day gating, presets/weather and stable resources |
| `npm run verify-foliage-browser` | Passed at 1100 × 800: three street views, all presets, five weather modes, day/night, isolated crown depth and winding continuity |
| Production preview | Passed at 1440 × 900: fresh startup, generated mask requests, driving/camera motion, pause, all presets, night rain/snow, saved-settings reload and return to sunny day; no asset or shader failures |
| Local relay traffic | Four clients for three seconds; states and snapshots exchanged with zero errors |
| Source and documentation checks | All 16 changed JavaScript modules/scripts passed syntax checks; current local documentation links resolved and `git diff --check` passed |

Reports and screenshots remain in ignored `artifacts/government-house/browser/`, `artifacts/room-lights/browser/`, `artifacts/foliage-volume/browser/` and `artifacts/release-review/`. No new FPS benchmark was recorded; the historical measurements retain their original revision and hardware limits.

## Interface update verification — 15 October 2026

The interface and loading changes since `6c2ddfb` were reviewed on Windows with Node.js 24.13.1. Chrome browser verification used device pixel ratio 1. The committed previews in `docs/images/` show the final neutral glass material; raw screenshots and the browser report remain under ignored `artifacts/liquid-glass/`.

| Check | Result |
| --- | --- |
| `npm run verify` | All 26 non-browser suites passed, including loading streams, manifest sizes, native 4K image dimensions and artwork budgets |
| `npm run build` | Passed; the existing large JavaScript chunk warning remains |
| `npm run verify-interface-browser` | Passed with no page errors: responsive loading/menu/pause layouts, non-overlapping HUD instruments, chapter selection, slideshow pause/resume, reduced motion, failure/retry, SVG rendering/centering, time/audio icon state, garage selection and menu/driving navigation |
| Loading art | All four images and recorded drawing buffers are 3840 × 2160; each encoded image is below 2,200,000 bytes |
| Source and documentation | Changed JavaScript modules/scripts passed syntax checks, current local documentation links resolved, and `git diff --check` passed |

Loading layouts cover 1440 × 900, 1920 × 1080, 390 × 844, 844 × 390 and 320 × 568; menu/pause/HUD checks substitute 1280 × 720 for the 1920 × 1080 case. The multiplayer check exercises the form, not a live relay session. This update records interface behavior and image quality checks, with no new frame-rate claim or full-route/long-session certification.

## Android 0.5 and horn update verification — 16 October 2026

The changes since `0ddd64b` replace the native development tabs with mobile
Liquid Glass menus/loading, preserve game/preferences/navigation behavior,
refine pedal/handbrake controls and add a hold-to-sound horn. Web changes clear
the horn on pause and silence stale remote audio using fresh sequence receipt.
Protocol version and relay implementation remain unchanged.

| Check | Result |
| --- | --- |
| `npm run verify` | All 26 non-browser suites passed again during final source/documentation review |
| `npm run build` | Passed again; existing large JavaScript chunk warning remains |
| `android/build.ps1 -Target Verify` | Passed again during final review: 57,600 physics comparisons, ground/swept contacts, controls, presentation, features, audio/plate, interface, four-car smoke and native/browser relay checks |
| Native controls | Button/slider input, scale/mirroring, multi-finger horn, release/cancellation/menu clearing and handbrake bounds passed |
| Native feature / audio-plate checks | 266 / 584 checks passed; the latter includes generated PCM horn and audio lifecycle regressions |
| Standalone native interface | Progress/retry, destinations, Back, reconnect, support URL, held-input clearing, selection context and four landscape sizes passed; rendered desktop OpenGL inspection completed |
| Full-game UI | Desktop Vulkan and Galaxy S9 Android 10 Vulkan each passed 18 checks; selected device screenshots and a compact result are committed |
| Actual Android ↔ Chrome web horn audio | Final S9 run passed 56 native checks and all 10 browser scenarios, including both directions, simultaneous hold, pause/release, stale-peer silence/recovery and departure |
| Public-relay horn transport | Five two-way on/off combinations passed; no relay update needed for `in.hn` |
| Main Android APK | Final Vulkan development APK exported/signed successfully; no primary 0.5 upgrade/install is claimed |

Use the [native build guide](../android/README.md),
[rendered interface and isolated phone commands](android/MOBILE_INTERFACE.md)
and [horn QA export/test commands](android/HORN_MULTIPLAYER.md) to reproduce
these checks. Finish Godot exports before USB multiplayer tests; editor exit
can remove ADB reverse tunnels. Full preparation includes generated interface
artwork, a guarded PCM horn loop and the second import after configuring WAVs.

The 18-check UI screenshot run predates the final driving-control refinements;
those passed subsequent control, rendered-interface and physical horn checks.
The 584-check audio/plate result is desktop; the earlier 0.4 phone run remains
564. The [device report](android/DEVICE_RESULTS.md) distinguishes these runs
and the isolated UI package's verified primary-preference hash. The upgrade
helper permits only accessibility keys absent before an update; previously
saved accessibility values remain part of its preservation check. An
unavailable preference file is reported as unverified, not as unchanged.

Selected screenshots and compact functional JSON are in `docs/android/`;
raw captures, WAVs and logs stay ignored. No new sustained-performance or
thermal benchmark, two-physical-Android test or public web deployment is
claimed. Install the updated APK and publish the matching web build for live
players to receive the fixes. See [remaining UI work](android/UI_ROADMAP.md).
The final headless audio/plate process emitted an ObjectDB leak warning at
exit; the rendered UI device run retains the seven texture-RID shutdown
warnings described in the device report. These checks do not resolve
long-session resource behavior.
