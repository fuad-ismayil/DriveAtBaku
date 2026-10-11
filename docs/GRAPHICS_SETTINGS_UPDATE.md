# Graphics distances and pause menu

The pause menu now groups drive actions, graphics, and atmosphere/audio into
three columns. It keeps the game's dark teal, cyan and orange visual language,
with native keyboard controls, descriptive labels, live slider values, visible
focus, a focus loop, and a single-column layout on narrow screens. Small screens
retain vertical scrolling so no controls are inaccessible.

## Distance controls

| Setting | Range | Default | Step |
| --- | --- | --- | --- |
| Render Distance | 400–6,000 m | 6,000 m | 100 m |
| Props Distance | 100–3,000 m | 3,000 m | 50 m |

Both save independently in local storage, sanitize missing/invalid values, and
work even when browser storage is unavailable. Quality presets do not overwrite
these choices. Live edits ease toward the requested distance over approximately
half a second without shader recompilation.

The maximum world distance keeps the original camera far plane and atmosphere.
Lower settings cull chunks using their nearest AABB point rather than their
center. Geometry crossing a boundary remains available until all its bounds
are beyond it. Three.js's existing exponential fog conceals the world cutoff;
stronger weather fog is preserved. This fog applies only to the main camera and
is restored after each render, so local reflections retain the correct weather.

Recognized tree, hedge, bush, streetlight, lamp post, utility pole, bollard,
bench and similar prop names use the independent props limit. Buildings, roads,
markings, barriers, fences, bridges and grandstands keep the world limit. Unknown
or mixed surfaces also keep the world limit, avoiding accidental removal of
structural geometry. In this packed map the authored tree and hedge materials
are recognized directly; ambiguous generic materials are deliberately retained.

Props fade over the final 28% of their range using fixed ordered coverage.
The shader retains depth writing and authored alpha cutouts, and reuses the
existing PBR view-position varying. It adds no transparent sorting or animated
random noise. MSAA/SMAA remain available through the existing quality presets.
Sun shadows and reflection views retain their own visibility rules. The
distance-setting implementation preserves authored map geometry, collision
data and multiplayer state. Subsequent audited event exclusions are described
in [the city map guide](CITY_MAP.md).

## Rendering investigation

The installed Three.js r180 already provides native frustum and backface culling.
The game already uses spatial chunks, conservative opaque-facade occlusion,
verified winding before enabling backface culling, material batches, cached
shadows, and scheduled reflections. Those systems are extended rather than
duplicated. Existing distant-city geometry is retained; no automatic mesh
simplification or inaccurate building-box occluders are introduced.

One additional bottleneck was zero-length draw submission: r180 sets up programs,
materials and buffers even when the existing culling callbacks leave an empty
draw range or empty batch list. A tagged, camera-aware filter on the public
`renderBufferDirect` hook rejects these submissions before that work. Ordinary
vehicle meshes are excluded, and shadow/reflection views remain independent.
The diagnostic overlay reports distance rejection and skipped submissions.

Full-distance world materials keep their existing shaders. Only prop materials
receive a custom fade; world distance haze uses the engine's existing fog. This
avoids imposing a new fragment-shader workload on high-quality world rendering.

## Verification

`npm run verify-render-distance` checks storage, independent props/roads,
boundary overhangs, camera turns, easing, shader composition, fog restoration,
shadow/reflection independence and submission filtering. It also checks all 14
real route viewpoints at both 96 m and 256 m chunk sizes. The local geometry
report is `artifacts/distance-settings/geometry.json`.

With a development server running, `npm run verify-graphics-settings-browser`
checks desktop/mobile layouts, keyboard navigation, live edits, restart
persistence, shader compilation and all three presets at four distance pairs.
`GAME_URL` selects the server. `PROFILE_ONLY=1` skips UI checks, and
`TEST_VIEW=open` measures the longer city view at checkpoint 2.
`MULTI_DRAW_OFF=1` exercises older drivers. `SETTINGS_REPORT` changes the report
directory. `UI_ONLY=1` skips timing scenarios.

For an exact before/after comparison, copy the pre-change `src` directory into
`artifacts/distance-settings/baseline/src` and set `COMPARE_BASELINE=1`. All
instrumentation stays in the browser test runner; production has no test hooks
or fixed clock. Measurements separate CPU submission, frame intervals, draw
calls, triangles and asynchronous GPU timer queries. A fixed view is useful for
comparison but does not establish FPS everywhere around the circuit.

The existing performance, world graphics, realism, handling, drive camera,
barrier, foliage and minimap checks were also run.

## Local measurements

Chrome, Intel Iris Xe / ANGLE D3D11, 1280 × 720, device pixel ratio 1, native
resolution, sunny day, fixed checkpoint-2 camera. Each case warms for 60 frames
and measures 120 frames. These compare the final implementation at full ranges
(6,000 / 3,000 m) against 1,200 / 250 m, with the same preset and near geometry.

| Preset | Full ranges FPS | 1,200 / 250 m FPS | Full p95 frame | Reduced p95 frame |
| --- | ---: | ---: | ---: | ---: |
| Performance | 58.8 | 77.5 | 20.7 ms | 16.6 ms |
| Balanced | 41.8 | 51.3 | 31.4 ms | 27.5 ms |
| Cinematic | 34.5 | 40.7 | 35.0 ms | 32.5 ms |

Main-view world candidates fell from 1,875,589 to 772,723 triangles (59%).
Balanced/Cinematic all-pass draw calls fell from 586 to 400. Performance GPU
time fell from 15.9 to 11.7 ms; Balanced fell from 22.5 to 17.9 ms. The full
world-distance comparison retained exactly the same candidate geometry as the
pre-change renderer and omitted 16 empty main draws in this view. Full-distance
GPU times were close to the baseline (15.7 versus 15.9 ms in Performance);
these measurements do not establish a universal FPS increase at maximum range.

Reports and inspected images are in `artifacts/distance-settings/open/`. Timing
varies with scheduling, GPU temperature, route position and weather. Props-only
reductions are smaller in this map because props represent fewer triangles than
the city buildings. The shorter world range provides the larger saving while
preserving nearby detail. The disabled-multi-draw browser run also verifies the
older-driver path, including every preset and distance pair.
