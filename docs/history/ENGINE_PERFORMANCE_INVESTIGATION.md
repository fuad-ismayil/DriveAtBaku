# 1080p engine performance investigation — 11 October 2026

> Historical engineering report. Settings, measurements and verification counts describe the recorded development stage. See [current rendering](../RENDERING.md) and [verification](../VERIFICATION.md) for the maintained implementation and commands. Referenced `artifacts/` evidence is generated locally and is not included in Git.

The engine retains the authored city, vehicle materials, weather, wet-road and car reflections, shadow resolutions, HDR, MSAA, SMAA, AO, bloom, draw distances, 120 Hz physics, collisions and multiplayer. The pause menu now saves Native / 1920×1080 / 1600×900 / 1280×720 rendering independently of the window. Native retains the existing preset DPR cap and supersampling preference. Fixed choices fit within the selected dimensions at the viewport's aspect ratio, fill the CSS canvas and keep DOM UI at its usual resolution.

The measured improvement is hardware-dependent. On Iris Xe, repeated Balanced 1080p samples reduced median GPU time by about **12–13%**, across all seven tested views/replays. On RTX 3050, the tested 1080p replays comfortably exceed 60 FPS, but whole-frame GPU timing improvements are small and inconsistent. Selecting RTX is a separate hardware change; its large advantage over Iris Xe is **not** attributed to the engine changes. Iris Xe still falls short of 60 FPS at native 1080p with these effects.

## Scope and baseline

Before editing rendering, the entire current `src` directory and `index.html` were copied to `artifacts/engine-investigation/baseline/`. This includes the user's already-uncommitted city/ground/collision work. The benchmark compares against that working source, rather than an older Git revision or previous published performance claims. Public assets and dependency versions remain identical.

Existing performance/graphics reports, the existing profiler/comparison tools, rendering modules, static batching/culling, shadow cache, local probes, particles, materials, car animation, main loop, ground contacts, collisions, HUD/minimap and networking were inspected. Current runtime inventory at the reference view is **1,524,163 world triangles, 9,130 chunks, 416 render objects, 203 batches and 30,043 potential facade occluders**. Historical reports describing 2.39 million triangles apply to the earlier event map.

## Existing pipeline and findings

| System | Existing implementation / measured finding | Decision |
| --- | --- | --- |
| Renderer | WebGL2, canvas antialiasing, high-performance preference, ACES/sRGB. Actual adapter was Intel by default despite the preference. | Retain renderer settings; record actual adapter. |
| Presets / resolution | DPR caps 1 / 1.5 / 2, multiplied once by saved 1 / 1.25 / 1.5 supersampling. | Preserve Native; add independent fixed pixel budgets. |
| Beauty / AA | One half-float scene target, depth texture, supported HDR MSAA 2x / 4x in Balanced / Cinematic; canvas AA also supported. | Retain samples, formats and depth. |
| AO | Half-resolution GTAO and denoising reconstruct from beauty depth; no duplicate scene/G-buffer render. | Retain algorithms, radius, sample counts and dimensions. |
| Bloom / grading | Quarter-resolution extraction, five blur mips, full-resolution additive bloom followed by full-resolution grading. | Combine bloom addition with grading. |
| SMAA / output | Three SMAA draws, half-float binary edge flags, then another full-resolution output draw. | Exact RG8 edge flags; tone-map/output in final SMAA blend. |
| Geometry | Static identity batching, released staging arrays, smaller chunks for multi-draw; authored positions/UVs/normals preserved. | Retain batching; no city rewrite or texture reduction. |
| Culling | Static AABB trees, cached unchanged camera, conservative facade occlusion, verified solid backfaces, separate shadow/reflection visibility. | Accept fully-inside tree nodes without retesting descendants. |
| LOD | Spatial partitioning and distance rejection; no authored geometry LOD/HLOD. | No LOD added: pixel/pass scaling was the demonstrated GPU problem, and geometry changes need separate asset/visual evidence. |
| Shadows | 1024 / 2048 / 4096 maps, 150 m caster selection, exact validity checks; moving cars update immediately. | Keep cache and accuracy; idle shadow work was already negligible. |
| Local reflections | One face/frame at 128 / 256, six-face filtering, stable published texture, 0.9 s blend, movement/cooldown scheduling; car/smoke excluded; sun map reused. | Retain capture fidelity and scheduling. Wet roads reuse the completed probe. |
| Sky / particles | Sky already draws after opaque depth; particles and tire effects are bounded and update changed ranges. | Retain. |
| Physics / collisions | Fixed 120 Hz integration, spatial broad phases and exact triangle/BVH contacts. | No equations, contacts, controls or synchronization changed. |
| CPU / allocations | Visibility and material/submission processing dominate sampled active CPU work; loading heap and occasional stutters remain. | Improve existing hierarchy; do not add another culling system or change physics. |

## What changed

1. `renderingResolution.js` computes one effective pixel ratio. Fixed choices ignore DPR/supersampling, retain the viewport aspect ratio, and never resize the browser or shrink the CSS canvas. Composer targets use **actual physical drawing-buffer dimensions with composer pixel ratio 1**, avoiding double DPR and intermediate resize allocations. Invalid stored values fall back to Native. Preset changes are idempotent rather than unnecessarily reallocating the same sun map or updating shader variants.
2. `StreetSMAAPass` keeps the original edge threshold, searches, lookup textures, floating-point blending weights and neighbourhood blend. Its R/G edge values are binary: RG8 stores them exactly, replacing RGBA16F and saving **11.87 MiB at 1080p**. It explicitly clears discarded non-edges to zero, rather than inheriting the blue scene clear color. Renderer clear state is restored even on failure. The existing renderer tone mapping and output conversion run **after** the final linear-HDR blend in that fragment, removing one fullscreen draw/write/read.
3. `StreetBloomPass` retains Three r180's extraction, five blur levels and weighted bloom composite. Grading samples the completed bloom alongside beauty, removing its preceding fullscreen additive draw. AO-off rendering also avoids the former full-resolution beauty copy, since bloom now reads rather than modifies beauty.
4. `SpatialIndex.queryFrustum` uses the same conservative plane/AABB rejection as Three. Fully-contained hierarchy nodes append their entries directly. Intersecting leaves use the original tests. No visibility is shared between main, reflection or shadow cameras, and collision indices retain their original query method/order.
5. `GpuTimer` is shared by the debug overlay and profilers. It polls asynchronously, bounds outstanding queries, drains results before reporting, invalidates **all** pending results on disjoint/context loss, and rejects partial samples when queries are dropped. Unsupported GPU timing is reported as unavailable. CPU submission and browser frame intervals remain separate. The newer harness records pass timings, driver program/upload counters, heap, resources, repeat ordering, raw rows and screenshots; the existing profiler now also drains queries and reports full frame statistics.
6. Startup now compiles the actual HDR beauty and direct-canvas shader variants, and primes the tire-mark/smoke buffers with zero draw ranges while the loading screen is present. Earlier startup compiled for the canvas only; the first HDR tire mark triggered another shader link and a roughly 75–80 ms CPU stall. Warm-up restores visibility/draw ranges even on failure, advances no simulation state and emits no marks or puffs. Its independent experiment is reported separately from steady GPU savings.

The Three r180 SMAA/bloom subclasses intentionally rely on that installed implementation. Revalidate them before upgrading Three. No effect strength, AA sample count, draw distance, road geometry, shadow resolution, reflection size or physics setting was reduced.

## Why larger windows hurt

In the isolated original Balanced stationary pass profile, 1280×720 → 1920×1080 increased pixels by **2.25x** and median GPU elapsed time from **15.59 → 33.89 ms**. Main geometry/visibility was held at the same camera and aspect ratio. CPU time was much smaller than GPU time.

| Original pass / group | 720p GPU median | 1080p GPU median | Ratio |
| --- | ---: | ---: | ---: |
| Beauty scene, including HDR resolve | 9.42 ms | 17.31 ms | 1.84x |
| AO evaluate + denoise | 1.92 ms | 4.41 ms | 2.30x |
| AO composition | 0.59 ms | 1.34 ms | 2.29x |
| Bloom | 0.58 ms | 1.66 ms | 2.85x |
| Grading | 0.51 ms | 1.96 ms | 3.85x |
| SMAA | 2.15 ms | 6.14 ms | 2.85x |
| Output conversion | 0.32 ms | 0.94 ms | 2.92x |

This supports a pixel/shading/render-target bottleneck on Iris Xe rather than a geometry-count explanation. Superlinear fullscreen scaling is consistent with cache/bandwidth pressure, but no hardware bandwidth or shader-ALU counters were collected: these measurements do not uniquely separate those mechanisms. Shader/program switching counts and CPU profiles are available; they are not measurements of GPU shader instruction counts.

The actual normal 1280×720 **outer** Chrome window had a 1264×625 CSS viewport. Maximized Chrome had **1920×945**, and native fullscreen had **1920×1080**, at DPR 1 and zoom 100%. Maximizing therefore increases native pixel work by about **2.30x** relative to that small window; fullscreen adds another **14.29%**. Native can additionally supersample through DPR/preset density and the saved render-scale preference. A physical 1080p monitor does not guarantee a 1080p drawing buffer.

Chrome used `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics ... D3D11)` in the default test launch. An isolated `--force_high_performance_gpu` launch selected `ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU ... D3D11)`. Both are real hardware adapters, with GPU timer support; software renderers are rejected by the harness. No Windows or normal Chrome profile preference was changed.

## Measurements

<!-- MEASUREMENTS_START -->
Headline reference: Ferrari, stationary city view, Sunny/day, lights off, AO on, Balanced, **Native 1920×1080**, DPR 1, scale 1, 2x HDR MSAA + SMAA, Chrome 155 / ANGLE D3D11 on **Intel Iris Xe**, hardware accelerated. Each version warmed 60 frames and measured 180 frames twice (360 valid GPU results); real frame intervals exclude each sample's first undefined interval. The seven-scenario comparison additionally used before/after/after/before context ordering. The 720p row below comes from that separate repeated full-view comparison.

| Metric | Before | After | Change |
| --- | ---: | ---: | --- |
| 1080p Balanced average FPS | 26.73 | 30.72 | 14.92% higher |
| 1080p Balanced median FPS | 27.47 | 31.35 | 14.11% higher |
| 1080p Balanced GPU median (ms) | 34.01 | 29.46 | 13.39% lower |
| 1080p Balanced GPU p95 (ms) | 35.73 | 30.36 | 15.03% lower |
| 1080p Balanced frame median (ms) | 36.40 | 31.90 | 12.36% lower |
| 1080p Balanced frame p95 (ms) | 72.50 | 64.20 | 11.45% lower |
| 1080p Balanced frame p99 (ms) | 99.80 | 67.00 | 32.87% lower |
| 1080p Balanced 1% low FPS | 9.59 | 12.04 | 25.62% higher |
| 1080p Balanced CPU main-frame median (ms) | 5.80 | 5.70 | 1.72% lower |
| 1080p Balanced CPU render submission median (ms) | 5.40 | 5.30 | 1.85% lower |
| 1080p Performance GPU median (ms) | 16.25 | 16.33 | 0.50% higher |
| 1080p Cinematic GPU median (ms) | 40.03 | 35.56 | 11.17% lower |
| 720p Balanced GPU median (ms) | 15.84 | 14.53 | 8.26% lower |
| All-pass draw calls | 256.00 | 254.00 | 0.78% lower |
| All-pass rendered triangles | 707401.00 | 707399.00 | 0.00% lower |
| Tracked offscreen attachments (estimated MiB) | 185.44 | 173.58 | 6.40% lower |

Performance's small negative delta is reported honestly; its direct rendering path has no fullscreen post effects to remove. All-pass triangle reduction represents the two removed fullscreen triangles; authored world geometry is unchanged. Resource estimates are a tracked subset, not total VRAM. Shader/program inventory can increase when otherwise cold effect variants are prepared early.

In this Native sample, intervals over 50 ms fell from **67 to 39 / 358 measured intervals**; worst interval was **108.60 → 95.30 ms**. These are short-run counts, not a long-session guarantee.

| Repeated Balanced 1080p scenario | GPU before / after (ms) | Average FPS before / after | GPU reduction |
| --- | ---: | ---: | ---: |
| idle | 34.16 / 29.88 | 26.75 / 30.26 | 12.53% |
| urban | 35.07 / 30.72 | 26.11 / 29.76 | 12.40% |
| drive | 34.51 / 30.30 | 25.81 / 29.12 | 12.21% |
| fast | 35.49 / 31.08 | 24.99 / 28.09 | 12.43% |
| night | 34.07 / 29.70 | 25.49 / 28.68 | 12.83% |
| rain | 35.92 / 31.48 | 24.38 / 27.30 | 12.38% |
| garage | 34.95 / 30.49 | 25.92 / 29.41 | 12.76% |

The urban row is a stationary checkpoint-7 view; drive/fast/night/rain are short deterministic spawn replays. An additional dense urban drive and low-beam night replay is recorded separately. Each scenario's raw JSON also contains FPS median, 1% low, median/p95/p99 interval, GPU p95, CPU phases, draw/triangle counts, program switches/uploads, heap and stutter counts.

The separate RTX runs retain the same 1080p workload, without treating GPU selection as a code speedup. Representative repeated results:

| RTX 3050, 1080p | GPU before / after (ms) | Average FPS before / after |
| --- | ---: | ---: |
| balanced / idle | 6.50 / 6.40 | 144.75 / 143.91 |
| balanced / drive | 6.48 / 6.54 | 128.54 / 129.59 |
| performance / idle | 2.44 / 2.47 | 144.24 / 144.65 |
| performance / drive | 2.36 / 2.41 | 140.72 / 141.57 |
| cinematic / idle | 6.69 / 6.67 | 144.27 / 144.37 |
| cinematic / drive | 6.67 / 6.52 | 133.03 / 135.22 |

RTX whole-render elapsed timings remain close, including small regressions in some cells, while the isolated output/bloom draws are measurably removed. No universal RTX GPU-time improvement is claimed. Approximately 144 Hz frame pacing limits stationary FPS; CPU/submission and occasional first-use events limit some driving rows.

| Actual maximized Chrome, Iris Xe | Buffer | GPU before / after (ms) | Average FPS before / after |
| --- | --- | ---: | ---: |
| balanced / idle | 1920×945 | 30.97 / 26.71 | 29.29 / 33.96 |
| balanced / drive | 1920×945 | 31.19 / 27.07 | 28.41 / 32.66 |
| performance / idle | 1920×945 | 15.18 / 15.11 | 56.18 / 56.35 |
| performance / drive | 1920×945 | 15.00 / 14.96 | 52.13 / 52.50 |
| cinematic / idle | 1920×945 | 35.87 / 31.72 | 25.96 / 29.05 |
| cinematic / drive | 1920×945 | 40.81 / 36.60 | 21.86 / 24.15 |

The emulated DPR 1.5 Native Balanced test at **1920×1080 CSS** produced **2880×1620 actual buffers**: GPU median **75.57 → 65.11 ms** on Iris Xe. This is a larger-than-1080p workload; it is not used as the native-1080p headline. Fixed choices were separately verified at DPR 1 / 1.25 / 1.5 / 2.

Raw evidence: Native Iris: `artifacts/engine-investigation/native-iris/results.json` (local only), Iris full scenario comparison: `artifacts/engine-investigation/final/results.json` (local only), RTX full matrix: `artifacts/engine-investigation/rtx-matrix/results.json` (local only), RTX repeated CPU/GPU samples: `artifacts/engine-investigation/render-range-rtx/results.json` (local only), RTX pass profile: `artifacts/engine-investigation/rtx-passes/results.json` (local only), maximized Iris: `artifacts/engine-investigation/maximized-iris/results.json` (local only), DPR test: `artifacts/engine-investigation/dpr-native-iris/results.json` (local only), resolution/window/resource checks: `artifacts/engine-investigation/resolution/results.json` (local only), and matched image comparison: `artifacts/engine-investigation/final/comparison.json` (local only).

The separate tire-effect warm-up experiment compares the already optimized renderer against the additional startup warm-up:

| Warm-up experiment, 1080p Balanced drive | Shader links during measurement | Peak CPU (ms) | Peak uploaded buffer bytes |
| --- | ---: | ---: | ---: |
| prewarm-baseline / repeat 0 | 1 | 70.60 | 344064 |
| prewarm-baseline / repeat 1 | 0 | 32.30 | 336 |
| current / repeat 0 | 0 | 32.50 | 672 |
| current / repeat 1 | 0 | 27.10 | 336 |

The fresh cold run linked one shader and allocated the 344,064-byte tire-mark buffers. Prepared runs linked none and used the existing small range uploads. The second unprepared replay already had its shader cached. This demonstrates removal of that first-use event; steady-state GPU/frame-pacing savings are not assigned to warm-up. Buffer counters account for WebGL2 source offset/length; earlier exploratory counters counted backing arrays and should not be read as actual transferred bytes.

Additional genuine RTX 1080p replays on the completed warm-up source:

| Preset / replay | GPU before / after (ms) | Average FPS before / after |
| --- | ---: | ---: |
| balanced / urban-drive | 7.91 / 7.26 | 83.77 / 99.97 |
| balanced / night-lights | 7.57 / 6.91 | 95.63 / 105.82 |
| performance / urban-drive | 2.99 / 3.04 | 94.73 / 98.47 |
| performance / night-lights | 2.64 / 2.52 | 105.87 / 115.11 |
| cinematic / urban-drive | 8.36 / 8.24 | 93.94 / 94.38 |
| cinematic / night-lights | 7.70 / 7.85 | 101.35 / 99.87 |

These are single short samples per cell, including real checkpoint-7 driving and night driving with low beams. They confirm playable 1080p on this adapter, and retain the cells with small regressions. Raw evidence: dense/night replay: `artifacts/engine-investigation/dense-night-rtx/results.json` (local only).

A final current-source 1080p Native check after adding shader warm-up measured GPU median **34.90 → 29.62 ms** on Iris Xe (one 120-frame sample per version). This agrees with the longer renderer comparison; it is not substituted for its repeated headline. The five matched captures remain visually consistent. Final-source results and image comparison: `artifacts/engine-investigation/completed-source/comparison.json` (local only).
<!-- MEASUREMENTS_END -->

## Controlled optimization attribution

The repeated Iris Xe 1080p SMAA experiments kept the same scene/effects and reversed experiment order. With output fusion already applied, black clear alone gave no reliable speedup. Changing exact binary edges from RGBA16F to RG8 reduced the SMAA group from **5.59 / 5.63 ms to 3.78 / 3.72 ms** in the two orders: approximately **1.8–1.9 ms** per frame. The black clear is a correctness fix; no independent GPU saving is claimed for it.

Separate before/after bloom samples measured median full GPU time **31.29 → 29.95 ms**. The bloom group fell from **1.72 → 0.81 ms**, and grading from about **1.99 → 1.75 ms**. That experiment also reduced one draw; AO-off removes an additional copy. Removing the output draw is separately visible in the pass profiles; its original Iris cost was about **0.94 ms** at this reference view. These individual timings come from separate instrumented runs and must not simply be added to predict the final improvement.

After warming both methods, alternating 240 same-view culling samples measured **1.00 → 0.80 ms** median at spawn and **0.70 → 0.60 ms** in the urban view, on the RTX test's CPU. Whole-frame CPU medians did not consistently improve on Iris Xe; its CPU p95 and frame pacing improved in the repeated final comparison. No broad CPU speedup is claimed from the hierarchy microbenchmark alone.

Changing zero-intensity headlight visibility was explored but gave variable timings, so it was not retained. Existing shadow caches, batching and reflection scheduling were retained instead of replaced with redundant systems. No GPU occlusion-query pipeline, HLOD system, reduced draw distance or compressed-texture rebuild was introduced without supporting evidence.

## Visual, resource and gameplay verification

Matched 1080p sunny, rain, snow, night and garage-lighting captures were compared numerically and inspected. Buildings, street surfaces/markings, car materials, lighting, AO, shadows, weather and reflections remain present. There is a small visible filtering difference: proper zero-cleared SMAA edges make fine details/markings slightly sharper. In the complete Iris comparison, mean absolute error was **0.62–1.06 of one 8-bit RGB channel level**; **1.42–2.40%** of pixels had any channel differ by more than eight levels. Silhouette/edge maxima are much larger. This is near-identical imagery, not pixel-exact output. Bloom-only mean differences were about 0.10–0.11 channel levels, mostly at antialiasing thresholds after removing half-float intermediate rounding.

The browser resolution verifier checked **51 preset/DPR/aspect cases**, Native and fixed buffer dimensions, live changes, saved selection after reload, narrow-screen menu bounds and actual Chrome normal/maximized/fullscreen states. At DPR 2, twelve 720p/1080p changes returned to the same **126 shader programs and 191 textures**, with no context loss or page/shader error. Fixed 720p in maximized Chrome used **1280×630** for its wider aspect ratio; fullscreen used **1280×720**. No stretching or black borders were introduced. Fullscreen was set through Chrome's native window-state API (the F11-equivalent window state), not DOM fullscreen.

Eight AO-off preset/DPR cases and the live GPU timing overlay also passed. The engine query/resolution/shader/state-restoration checks, production build, and existing performance, world graphics, render distance, realism, handling, idle drivetrain, cameras, audio, minimap, graphics, foliage, barriers, city map, city collisions, ground surfaces, garage vehicles, plates and tire-effect suites pass. They include all four cars' exact trajectories/contact checks, actual map geometry and independent shadow/reflection visibility. The two-client local relay check also passes: 197 trunk contacts, finite owner state, and **0.00051 m** final remote-position error, with no page or shader errors. The existing build bundle-size warning remains.

GPU attachment figures are estimates from tracked live render-target dimensions/formats/samples and depth storage. They exclude untracked pre-instrumentation sky/garage environment allocations, image/geometry textures, default canvas/compositor storage and driver padding/compression. They are not measured total VRAM. JavaScript heap varies substantially with loading garbage and browser process reuse; no heap reduction is claimed. CPU profiles record GC samples, but do not establish that every long frame is caused by GC. Multi-hour memory stability, a full-route replay and a broad range of devices remain future validation.

## Reproduce

Use a dedicated server with HMR off so edits do not interrupt runs:

```powershell
npx vite --config scripts/performance.vite.config.mjs --port 5186 --strictPort
```

```powershell
$env:GAME_URL = 'http://127.0.0.1:5186'
$env:HEADED = '1'
$env:WINDOW_STATE = 'fullscreen'
$env:VARIANTS = 'baseline,current,current,baseline'
$env:QUALITIES = 'balanced'
$env:RESOLUTIONS = '1080,720'
$env:SCENARIOS = 'idle,urban,drive,fast,night,rain,garage'
$env:REPEATS = '1'
$env:FRAMES = '180'
$env:WARMUP = '60'
$env:SNAPSHOTS = '1'
npm run profile-engine -- artifacts/engine-investigation/final
node scripts/compare_engine.mjs artifacts/engine-investigation/final
```

The saved baseline directory is required for baseline variants. Other archived stage names are supported. `GPU_PREFERENCE=high` requests the RTX test launch; adapter identity is still verified. `PASS_PROFILE=1` splits non-overlapping queries into scene/shadows, AO evaluation/denoising/composition, bloom, grading, SMAA edge/weight/blend-output and reflection face/PMREM/blend groups. `PROFILE_CPU=1` saves Chrome CPU profiles. `CPU_CULL_AB=1` measures warmed alternating same-view hierarchy variants. `WINDOW_STATE=maximized` tests the real browser client viewport; omitting it permits controlled CSS `VIEWPORT_WIDTH`, `VIEWPORT_HEIGHT`, and `PIXEL_RATIO`. `USE_NATIVE=1` retains preset DPR instead of requesting a fixed target. Raw data records actual buffers and must be used to interpret these cases.

The simulation replay fixes dt at 1/60 only in served benchmark instrumentation; frame intervals and GPU queries use real clocks. This gives identical trajectories independent of hardware speed, with two physics steps per rendered replay frame. It is a short per-frame stress replay, not a continuous real-time full-city session. HUD/menu layers are hidden for consistent scene measurements, while normal driving updates still execute. GPU queries cover WebGL work rather than all browser DOM/compositor work. Pass-query instrumentation and CPU profiling add overhead, so attribution runs are kept separate from headline comparisons.

Run `npm run verify-engine` and, with the server running, `npm run verify-resolution-browser` (`HEADED=1` for actual native window states). Run `node scripts/probe_adapter.mjs` to compare the adapters selected by isolated default/high-performance launches. Generated evidence stays in ignored `artifacts/`.

## Remaining work and research basis

Iris Xe's remaining expensive beauty/MSAA/HDR and AO passes still exceed a 60 FPS budget together. Further changes should be measured independently: GPU counters for bandwidth versus shader cost, unused fullscreen depth attachments, AO depth/normal reconstruction reuse, opaque material shading/overdraw, and larger controlled reflection/shadow movement samples. Geometry LOD is a future asset project with matched-view and collision validation, rather than a substitute for these pixel bottlenecks. High-end RTX samples are often limited by CPU submission or the observed approximately 144 Hz frame pacing; their small timing differences should not be described as universal speedups. CPU/frame spikes remain in some replays and need longer tracing.

Primary sources checked alongside the installed r180 source: [Three renderer drawing-buffer sizing](https://threejs.org/docs/pages/WebGLRenderer.html), [composer pixel sizing](https://threejs.org/docs/pages/EffectComposer.html), [SMAA linear-sRGB ordering](https://threejs.org/docs/pages/SMAAPass.html), [WebGL2 GPU timer availability/disjoint rules](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/), [renderable floating-point formats](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/), and [Chrome high-performance adapter guidance](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips).
