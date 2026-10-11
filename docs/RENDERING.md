# Rendering

The game uses Three.js r180 and a WebGL 2 renderer. `src/graphics.js` owns the street pipeline; the garage retains its studio environment. Settings persist in browser local storage and apply while the game is running.

## Presets and resolution

| Preset | Street rendering | Sun shadows | Car reflections |
| --- | --- | ---: | --- |
| Performance | Direct rendering with canvas antialiasing; no post-processing AO | 1024 px | Sky environment |
| Balanced | Linear HDR, supported MSAA up to 2x, SMAA, bloom/grading and optional half-resolution AO | 2048 px | 128 px local captures |
| Cinematic | Linear HDR, supported MSAA up to 4x, SMAA, bloom/grading and optional half-resolution AO | 4096 px | 256 px local captures |

Cinematic is the default for fresh preferences. Existing choices are retained. Unsupported floating-point rendering falls back to direct rendering; supported sample counts depend on the GPU.

**Rendering Resolution** is independent of preset and browser size: Native, 1920×1080, 1600×900 or 1280×720. Fixed targets preserve the viewport aspect ratio within the selected bounds and fill the canvas. Native uses the preset pixel-ratio budget and optional 125%/150% scale. Menus and HUD remain at normal browser resolution. See `src/renderingResolution.js` and `npm run verify-resolution-browser`.

Render Distance (400–6,000 m) and Props Distance (100–3,000 m) are independent saved controls. Their maximum values preserve the full scene ranges. [Distance settings](GRAPHICS_SETTINGS_UPDATE.md) describes easing, prop fades and separate shadow/reflection visibility.

## Pipeline and visibility

`StreetAOPass` reconstructs contact shading from resolved scene depth at half resolution. `StreetBloomPass` retains the bloom extraction and blur chain while combining bloom with grading. `StreetSMAAPass` stores binary edges in RG8 and combines its final HDR blend with tone mapping/output conversion. These changes reduce full-resolution copies without reducing authored scene geometry or effect sample counts.

Spatial chunks, AABB hierarchies and frustum rejection select world geometry. Conservative occlusion uses real opaque facade triangles; uncertain edges, openings, transparent surfaces and cutouts remain visible. Compatible materials batch through `WEBGL_multi_draw`; other drivers use regular meshes. Collision geometry remains independent of render visibility.

`shadowCache.js` invalidates cached sun shadows when relevant lights, casters, geometry, materials or selections change. `localReflections.js` schedules city cubemap faces and blends completed captures; vehicle, teleport, lighting and weather changes invalidate them. Performance quality uses the sky environment. Resource ownership and cleanup are covered by the verification suites.

Weather combines sky illumination, fog, surface wetness/snow and camera-following precipitation. `vehicleWater.js` shades surface water on the existing car materials. Weather does not alter the vehicle dynamics. Surface detail, foliage cutouts and ordinary street markings retain their dedicated handling.

## Diagnostics and measurement

Append `?graphicsDebug=1` for drawing-buffer size, geometry candidates, draw counts, CPU submission and available asynchronous GPU timings. `&occlusion=off` supports matched-view culling comparisons. GPU timings are unavailable when the timer extension is absent, disjoint or the context is lost; CPU submission and frame intervals are separate measurements.

Use [verification](VERIFICATION.md) for current commands. The [1080p investigation](history/ENGINE_PERFORMANCE_INVESTIGATION.md) records the optimization methodology and historical measurements, including small regressions and hardware limits. It does not establish a frame-rate guarantee.
