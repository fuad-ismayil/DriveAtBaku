# Wheels, grounding, antialiasing, AO and weather — 1 October 2026

The later [reflections, tires and supplied-wheel update](REFLECTIONS_TIRES_WHEEL_UPDATE.md) supersedes this package's generated Elantra wheels and reflection scheduling, and adds rubber marks/smoke. This report retains the measurements for this earlier package.

The second graphics package adds detailed Elantra alloys, removes the Ferrari's attached shadow rectangle, improves antialiasing, introduces ambient occlusion, neutralizes the orange sunlight, and adds all five requested weather modes.

## Changes and settings

- **Elantra wheels:** ten curved spokes in five pairs, beveled machined faces, recessed barrels, brake rotors, centre caps, lug nuts and valves. Calipers follow steering and suspension without spinning with the rims. Each complete wheel is merged into five material meshes, shared across the four wheels. Tire diameter and driving physics are preserved.
- **Ferrari grounding:** the generated gradient plane is removed. Grounding uses actual car shadows and AO. Transparent glass no longer writes opaque depth or casts a solid shadow. Live inspection found no attached plane or shadow-named mesh.
- **Antialiasing:** Balanced and Cinematic use SMAA, with scene-only HDR MSAA where supported: up to 2 samples for Balanced and 4 for Cinematic. Both counts were confirmed on the RTX. Alpha-tested materials use coverage smoothing. Fullscreen effects use single-sample targets. The pause menu adds **Native / 125% / 150% render resolution**; larger values improve fine edges at increased GPU cost.
- **Ambient occlusion:** half-resolution GTAO uses the actual scene render's resolved depth, reconstructing geometric normals instead of drawing solid override materials over fences. It respects the beauty pass's alpha cutouts, batching and animation; the sky, precipitation and transparent glass do not write that depth. It runs before bloom/output conversion and can be disabled in the pause menu. Performance releases these post-processing resources. This is a screen-space approximation, rather than ray-traced indirect lighting. [GTAOPass](https://threejs.org/docs/pages/GTAOPass.html), [render target MSAA](https://threejs.org/docs/pages/RenderTarget.html).
- **Sunlight:** the direct light changes from warm `#ffe3b8` to restrained `#fff7ee`. Sun glow, the sun disc, cloud highlights and ground fill also lose their orange bias.
- **Weather:** choose it from the main menu or pause menu. The choice is saved, works independently of day/night, updates sky illumination, and invalidates local car reflections. Sky environments cache three cloud levels for each lighting mode, with at most six maps.

| Mode | Appearance |
| --- | --- |
| Sunny | Natural daylight, drifting clouds, dry surfaces |
| Overcast | Cloud cover, weaker direct sun, diffuse illumination and haze |
| Wet roads · no rain | Darker damp materials and uneven glossy patches, without falling rain |
| Rain | Wet surfaces, cloud cover, reduced visibility and animated rain streaks |
| Snow | Snowflakes, brighter rough snow cover on upward-facing world surfaces, overcast light and haze |

Rain and snow use bounded particle fields following the camera, with reduced density on lower presets. Precipitation is hidden in the garage. Existing road detail, authored textures, cutouts and collision geometry are retained.

![Elantra split-spoke alloys](../artifacts/elantra-new-alloys.png)

Additional captures: [Ferrari without the shadow rectangle](../artifacts/ferrari-real-ground-shadow.png), [sunny](../artifacts/realism-sunny-elantra.png), [overcast](../artifacts/realism-overcast-elantra.png), [wet roads](../artifacts/realism-wet-elantra.png), [rain](../artifacts/realism-rain-elantra.png), [refined snow](../artifacts/realism-snow-elantra.png), [Elantra rainy night](../artifacts/realism-elantra-rain-night.png), [Ferrari rainy night](../artifacts/realism-ferrari-rain-night.png).

## Verification and performance

Production build and all nine verification suites pass: handling, camera, drive-camera, engine audio, minimap, graphics, barriers, world graphics, and the new realism suite. The latter checks rim bounds/normals, stationary calipers, Ferrari glass/grounding, weather transitions, road-shader composition, cutout-preserving AO depth, half-resolution resizing and cleanup. The build retains its bundle-size warning.

The Codex browser's actual WebGL adapter was **NVIDIA GeForce RTX 3050 Laptop GPU through ANGLE / Direct3D 11**. All five day-weather views, both garages, rainy-night views with both cars, AO switching and 125% rendering were inspected. Live inspection confirmed that AO shares the scene depth and never renders an override G-buffer. Brief throttle, recovery and follow/hood switching completed; this was not a full-route motion or shimmer test. No browser errors, shader warnings or context loss were reported during inspection.

Completed-source samples below used the Elantra at spawn, Cinematic, 4x MSAA, SMAA, AO on, **1920 × 1080, DPR 1, native render scale**. Each warmed up for 60 frames and measured 240. GPU queries covered the complete frame's WebGL work, including shadows, scheduled reflections and post-processing. CPU submission was measured separately; CPU/GPU timings overlap and must not be added.

| View | GPU median / p95 | CPU submission median | Mean frame interval | Approx. FPS |
| --- | --- | --- | --- | --- |
| Sunny, day, headlights off | 11.74 / 15.64 ms | 15.90 ms | 17.62 ms | 57 |
| Snow, day, headlights off | 11.66 / 17.26 ms | 17.60 ms | 19.12 ms | 52 |
| Rain, night, low beams | 11.50 / 14.86 ms | 16.60 ms | 18.23 ms | 55 |

All samples completed with 240 GPU results, no disjoint events and no timeout. These short stationary tests do **not** establish sustained 60 FPS. The [earlier RTX report](GRAPHICS_RTX_VERIFICATION.md) measured the lighter first package before MSAA/AO/weather; its approximately 79 FPS result is historical. Power conditions and CPU load also varied between sessions, so the two runs are not a controlled feature-cost benchmark. During this session's tuning, a same-view AO on/off pair measured approximately **1.93 ms additional median GPU time** with AO on. Earlier tuning measurements are separated from completed-source measurements in the raw evidence.

After loading both cars and warming the bounded weather-environment cache, three Performance → Balanced → Cinematic cycles returned to identical resource counts each time:

| Preset | Geometries | Textures |
| --- | --- | --- |
| Performance | 737 | 921 |
| Balanced | 748 | 947 |
| Cinematic | 749 | 947 |

These are resource counts, not VRAM bytes or a long-duration leak test. Raw evidence: [realism-weather-verification.json](../artifacts/realism-weather-verification.json). Screenshots and raw evidence stay local under ignored `artifacts/`. Temporary inspection/timing hooks, focus and viewport overrides were removed; Elantra, day, Sunny, headlights off, Cinematic, native resolution and AO on were restored.

## Next realism work

This weather version changes appearance. It does not yet change tire grip, model standing-water depth, create tire spray/tracks, add wipers, stop precipitation under roofs, accumulate snow over time, or reflect the city/car in road puddles. Wet materials currently use environment lighting rather than screen-space or planar road reflections. Street lamps and shadow-blocked headlights remain outstanding.

The next useful steps, based on the observed game, are:

1. Add street fixtures and headlights blocked by buildings, then tune night exposure against comparable real scenes.
2. Author matched road/stone/concrete normal and roughness maps and recover selected higher-resolution facade textures.
3. Add convincing wet-road reflections, tire spray, windshield rain/wipers, and weather-dependent grip. Give snow proper accumulation, shelter and tire tracks.
4. Improve shadow/contact stability and profile CPU culling/submission. Validate the combined effects during sustained driving with both cars, including corners, teleports, fence shimmer and longer resource monitoring.

These remain further roadmap work; this package does not complete the entire realism roadmap.
