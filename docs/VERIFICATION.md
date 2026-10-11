# Verification

Install the locked client dependencies with `npm ci` and relay dependencies with `npm ci --prefix server`. `npm run verify` runs all 23 non-browser suites sequentially and stops on the first failure. These cover vehicle handling and idle drivetrain, both cameras, engine audio, minimap, models/plates/loading, ground and world collision, rendering invariants, foliage, tire effects, culling/distance, GPU-timer/resolution logic, indicator state/lens fitment and an isolated three-client indicator relay test.

```sh
npm run verify
npm run build
```

The GitHub **Verify** workflow runs these checks, the production build and a local relay traffic test on Node.js 24/Linux. It does not make GPU-performance or visual-quality claims. Vite currently reports a large JavaScript chunk; the warning is retained and the build succeeds.

## Browser checks

Browser scripts use the declared `playwright`, `pngjs` and `sharp` development dependencies. Install Google Chrome separately; the runners launch its `chrome` channel. Use a hardware-accelerated WebGL 2 session. Some checks reject software rendering or require GPU timer queries, so generic headless CI is insufficient for their measurements.

Start a dedicated client server in one terminal:

```sh
npm run dev -- --port 5186 --strictPort --config scripts/performance.vite.config.mjs
```

In another terminal, set the common game URL. In PowerShell:

```powershell
$env:GAME_URL = 'http://127.0.0.1:5186'
npm run verify-resolution-browser
npm run verify-graphics-settings-browser
npm run verify-city-map-browser
npm run verify-city-cleanup-browser
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
| `verify-city-map-browser` | City visibility, occlusion, weather and driver fallback |
| `verify-city-cleanup-browser` | Audited areas, moving-camera replay and optional two-client replication |
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
