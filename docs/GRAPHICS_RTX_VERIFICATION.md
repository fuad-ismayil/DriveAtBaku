# RTX 3050 browser verification — 1 October 2026

This report records the first graphics package before the newer rims, MSAA, AO and weather effects. See [the current graphics/weather report](GRAPHICS_WEATHER_UPDATE.md) for the heavier combined configuration and its timings. The results below remain historical adapter/baseline evidence.

The Codex in-app browser now renders the game on **NVIDIA GeForce RTX 3050 Laptop GPU**. At native **1920 × 1080**, the short Cinematic starting-straight samples averaged approximately **78–79 FPS**, with about **6.6 ms median GPU time**. This view meets the 16.7 ms frame budget for 60 FPS. Sustained driving and full-route performance acceptance remain outstanding.

## Environment and method

- Local game: `http://localhost:5173/?graphicsDebug=1`, Codex in-app browser.
- Actual WebGL renderer: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
- Display: 1920 × 1080; controlled viewport and framebuffer at 1280 × 720 or 1920 × 1080; device pixel ratio 1. Multi-draw, floating-point render targets, and disjoint GPU timer queries are supported.
- Each sample warmed up for 60 frames and measured 240 frames. GPU elapsed queries bracketed the complete game frame's WebGL work, including shadows, scheduled local reflections, and post-processing. CPU submission time was measured separately. CPU and GPU work overlap; these timings must not be added together.
- Frame intervals use animation-frame timestamps; approximate FPS is 1000 divided by the mean interval. All reported samples completed without timeout, GPU-disjoint events, or context loss.
- The Elantra was stationary at spawn with a recovered follow camera and neutral mouse position. Day samples used headlights off; the night sample used low beams. All preset samples had occlusion enabled.
- Two exploratory 1080p samples used an accidentally rotated camera and were excluded. Their raw results remain under `exploratoryProfiles`. Small count differences between accepted repeats reflect idle suspension/camera settling.
- The browser was visible and focus emulation was enabled during measurements. Timing instrumentation and CPU/GPU power conditions can affect results. These are short live samples, rather than a continuous driving benchmark.

## Preset samples

All times are milliseconds. FPS values are rounded.

| Resolution / lighting | Preset | GPU median / p95 | CPU submission median | Mean frame interval | Approx. FPS |
| --- | --- | --- | --- | --- | --- |
| 1280 × 720 / day | Performance | 4.43 / 6.84 | 11.70 | 12.73 | 79 |
| 1280 × 720 / day | Balanced | 5.73 / 7.05 | 11.80 | 12.70 | 79 |
| 1280 × 720 / day | Cinematic | 5.88 / 7.53 | 11.70 | 12.59 | 79 |
| 1920 × 1080 / day | Performance | 5.25 / 6.51 | 11.60 | 12.73 | 79 |
| 1920 × 1080 / day | Balanced | 6.17 / 8.26 | 11.70 | 12.59 | 79 |
| 1920 × 1080 / day | Cinematic | 6.56 / 8.77 | 11.80 | 12.76 | 78 |
| 1920 × 1080 / night, low beams | Cinematic | 6.05 / 8.20 | 11.50 | 12.73 | 79 |

The [earlier Intel Iris Xe run](GRAPHICS_BROWSER_VERIFICATION.md) measured 22.25 ms median GPU time and approximately 41 FPS for Cinematic day at 720p. The RTX sample at that resolution measured 5.88 ms and approximately 79 FPS: about 3.8 times lower GPU elapsed time and 1.9 times the observed frame rate. The runs used different sample lengths and runtime/power conditions, so this is an observed comparison, rather than a controlled hardware-only speedup claim.

CPU submission exceeds median GPU time throughout the RTX samples. Reducing graphical quality barely changes the observed frame rate at this position, suggesting CPU submission and frame scheduling are the current constraints. More GPU effects still require measurement in busier and moving views.

## Repeated occlusion comparison

Cinematic, 1080p, Elantra, day, headlights off, same spawn view. Samples ran in the order **on → off → off → on**; each used the same 60-frame warm-up and 240-frame measurement.

| Sample | Occlusion | GPU median / p95 | CPU submission median | Mean frame interval | Approx. FPS |
| --- | --- | --- | --- | --- | --- |
| 1 | On | 6.51 / 7.71 | 11.70 | 12.70 | 79 |
| 2 | Off | 6.90 / 8.22 | 11.00 | 11.89 | 84 |
| 3 | Off | 6.80 / 8.40 | 11.10 | 11.98 | 83 |
| 4 | On | 6.43 / 8.06 | 11.70 | 12.59 | 79 |

At this position, occlusion rejected 161–164 chunks, reducing candidate triangles from 315,834 to approximately 310,969–310,988 and all-pass draw calls from 593 to 591. GPU median time fell by about 0.37–0.39 ms, while CPU submission rose by about 0.6–0.7 ms. Both comparison orders therefore had longer mean frame intervals with occlusion enabled. This supports optimizing its CPU cost; it does not establish its net benefit across the whole circuit. No culling setting or game source was changed permanently.

## Rendering, evidence, and remaining work

The inspected native-resolution day and night views render the road, fence openings, car reflections, and lighting without browser errors or context loss. Balanced still emits the previously documented FXAA compiler warnings about gradients in varying loops and a potentially uninitialized variable. These warnings did not stop rendering.

![Cinematic day on RTX 3050 at 1080p](../artifacts/graphics-rtx3050-cinematic-1080p.png)

![Cinematic night with low beams on RTX 3050 at 1080p](../artifacts/graphics-rtx3050-cinematic-night-1080p.png)

The screenshot diagnostics are separate rolling readings; the benchmark tables use the recorded 240-frame samples. Raw evidence: [rtx3050-graphics-verification.json](../artifacts/rtx3050-graphics-verification.json). Generated evidence remains local in the ignored `artifacts/` directory.

Temporary timing hooks and inspection helpers were removed, the original world-update method and native animation scheduling were confirmed restored, and focus/viewport overrides were removed. Day mode, Cinematic quality, Elantra, headlights off, and the main menu were restored before closing the inspection tab. This run changed documentation only; the build and eight-suite results are recorded in the earlier report and were not rerun for the adapter switch.

This completes adapter confirmation and short native-resolution measurements. Full-route RTX timings with both cars, sustained driving, compilation/stutter monitoring, and long-duration resource checks remain outstanding. The roadmap's later lighting, material, shadow, AO, reflection, and asset phases remain unimplemented; switching GPUs does not complete those features.
