# Graphics browser verification — 1 October 2026

The local game opened successfully on the retry. Rendering and the sampled culling comparisons pass. The measured adapter does **not** meet a sustained 60 FPS Cinematic target, and the current occlusion implementation did not improve frame time in the two short controlled comparisons.

## Environment and method

- Codex in-app browser, `http://localhost:5173/?graphicsDebug=1`.
- WebGL reports **Intel Iris Xe**, through ANGLE / Direct3D 11. This is the adapter actually used by the browser; this run does not establish performance on a separate dedicated gaming GPU.
- Controlled viewport and drawing buffer: **1280 × 720**, device pixel ratio **1**. Multi-draw, floating-point render targets, and disjoint GPU timer queries are supported.
- The initial background/focus-throttled attempt produced no usable timing samples and was excluded. Valid measurements ran after bringing the page to the foreground.
- Each valid timing sample warmed up for 30 animation frames, then measured 120 frames. GPU elapsed queries bracketed the WebGL work submitted by the complete game frame, including shadows, reflections when scheduled, and post-processing. No GPU-disjoint events were reported. CPU submission and frame intervals were recorded separately.
- For image comparisons, temporary inspection helpers moved the car to the 14 authored route checkpoints, settled its suspension and camera, completed the local reflection capture, and froze animation. The same view was then rendered with occlusion on and off. These are sampled route views, rather than a continuously driven full-lap test.
- Temporary inspection helpers, timing hooks, focus emulation, and viewport overrides were removed afterward. Day mode, Cinematic quality, and the originally selected Elantra were restored. No game source was changed.

## Rendering and culling results

Both cars were inspected at all 14 checkpoints by day and night: **56 views and 112 screenshots**. All 56 on/off image pairs were **pixel-identical** in the inspected areas. The changing diagnostics panel and transient toast were excluded, leaving 806,695 pixels per pair. The frozen screenshots' diagnostics timing text is not a benchmark; use the measurements below.

The views cover the starting straight, open sections, tree-lined streets, tight corners, the old-city climb, and the return straight. The inspected images preserve road markings, fence openings, buildings, car shading, and shadows when occlusion is enabled. Across these follow-camera samples, occlusion rejected up to **1,200 chunks**, reducing the conservative candidate estimate by as much as **90,481 triangles** in one view. Candidate counts are not exact GPU triangle submissions.

Runtime inspection confirmed:

- 2,385,404 world triangles, 10,480 culling chunks, 633 render objects, 321 material batches, and 127 materials using selective backface culling.
- Configured 1024² / 2048² / 4096² shadow sizes for Performance / Balanced / Cinematic, with the actual 4096² Cinematic shadow render target confirmed at runtime.
- Local car reflections complete and reach the paint materials; day/night changes, checkpoint moves, car changes, and quality changes refresh the capture. Balanced uses 128-pixel faces and Cinematic 256; Performance removes the local probe.
- Garage/car transitions, follow/hood switching, recovery to spawn, and brief throttle input work without rendering errors. This was a short motion check, not a sustained driving or camera-pop benchmark.
- Three complete quality cycles returned to the same renderer resource counts each time: Performance **735 geometries / 917 textures**, Balanced **746 / 933**, Cinematic **747 / 937**. No resource-count growth appeared in those cycles; these counts are not VRAM bytes or a long-duration leak test.
- No browser rendering errors or observed context loss. Balanced produced the already documented FXAA compiler warnings about gradients in varying loops and a potentially uninitialized variable. They did not prevent rendering.

Representative inspected view:

![Ferrari at the old-city turn](../artifacts/graphics-verified-ferrari-narrow-street.png)

Route contact sheets: [Ferrari day](../artifacts/graphics-route-ferrari-day-overview.png), [Ferrari night](../artifacts/graphics-route-ferrari-night-overview.png), [Elantra day](../artifacts/graphics-route-elantra-day-overview.png), [Elantra night](../artifacts/graphics-route-elantra-night-overview.png).

## Short timing samples

Initial preset samples, with occlusion enabled:

| View | GPU median / p95 | CPU submission median | Mean frame interval |
| --- | --- | --- | --- |
| Cinematic, Elantra, day, spawn | 22.25 / 23.78 ms | 19.40 ms | 24.24 ms |
| Cinematic, Elantra, night, low beams, spawn | 21.75 / 23.28 ms | 21.10 ms | 23.55 ms |
| Balanced, Elantra, day, low beams, spawn | 13.57 / 18.41 ms | 16.70 ms | 17.71 ms |
| Performance, Elantra, day, low beams, spawn | 13.70 / 16.18 ms | 14.30 ms | 15.80 ms |

These are short individual samples, with differing headlight states and runtime warm-up history. They do not establish a controlled improvement over the pre-package renderer or guarantee a preset's full-route frame rate. The initial Cinematic day sample averages approximately 41 FPS, below the 16.7 ms frame budget for 60 FPS.

Later controlled occlusion comparisons used the same car, day lighting, headlights off, preset, and position within each pair:

| View / occlusion | GPU median / p95 | CPU submission median | Mean frame interval |
| --- | --- | --- | --- |
| Spawn / on | 23.53 / 31.62 ms | 32.90 ms | 34.14 ms |
| Spawn / off | 22.61 / 29.57 ms | 30.50 ms | 31.36 ms |
| Narrow street, checkpoint 7 / on | 25.00 / 29.17 ms | 32.70 ms | 34.03 ms |
| Narrow street, checkpoint 7 / off | 26.00 / 29.75 ms | 30.70 ms | 32.34 ms |

At checkpoint 7, occlusion reduced candidate triangles from **337,443 to approximately 298,666**, and all-pass draw calls from **521 to 517**. Its CPU overhead outweighed the GPU saving in this short sample. Spawn also ran more slowly with occlusion enabled. These sequential, single-run comparisons identify a tuning concern; they are not a statistical benchmark across the whole circuit.

The later samples followed debugger-based route inspection and a longer runtime. CPU timings differ substantially from the initial samples, so compare the rows within each controlled pair rather than treating the two tables as one uniform benchmark. Browser instrumentation and CPU/GPU power conditions can affect timing. A native-resolution dedicated-GPU run, repeated comparisons in both orders, sustained driving, and longer resource/stutter monitoring remain necessary for performance acceptance.

The night views also retain existing lighting limitations: headlights are unshadowed, and nearby walls can have strong bright patches. The first package does not complete the roadmap's street-lighting and headlight-shadow work.

## Automated checks and evidence

Production build and all eight suites passed again: handling, camera, drive-camera, engine audio, minimap, graphics, barriers, and world graphics. The build retains its bundle-size warning. World-graphics checks still validate both partition paths, authored triangle data, openings, mirrored faces, independent shadow/reflection visibility, collision independence, shader composition, and reflection cleanup. The regular-mesh fallback was checked by that suite, rather than a second live GPU/browser configuration.

Raw evidence is stored locally in [browser-graphics-verification.json](../artifacts/browser-graphics-verification.json), [graphics-image-comparison.json](../artifacts/graphics-image-comparison.json), and [world-graphics-verification.json](../artifacts/world-graphics-verification.json). Screenshots and these generated artifacts remain local under the ignored `artifacts/` directory.
