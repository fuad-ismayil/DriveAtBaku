# Performance Optimization

The optimization preserves the existing graphics presets, render resolution,
texture filtering, lighting, 4096-pixel cinematic shadows, draw distance, bloom,
ambient occlusion, MSAA/SMAA, weather, vehicle models, physics and controls.
The supplied city still contains all 2,385,404 triangles.

## Measured Results

Chrome on Intel Iris Xe, ANGLE/D3D11, 1280 x 720, device pixel ratio 1,
cinematic preset, 4x scene MSAA, AO enabled, render scale 1. Each scenario uses
60 warm-up frames and 180 measured frames with a repeatable 1/60-second input
replay. GPU measurements use asynchronous timer queries; CPU submission and
frame intervals are recorded separately.

| Scenario | Median FPS Before | Median FPS After | Frame p95 Before | Frame p95 After |
| --- | ---: | ---: | ---: | ---: |
| Stationary | 23.4 | 39.1 | 52.8 ms | 32.3 ms |
| Driving | 24.5 | 29.4 | 64.0 ms | 45.9 ms |
| Rain | 21.1 | 25.2 | 61.5 ms | 52.5 ms |
| Night | 21.3 | 25.5 | 66.0 ms | 52.2 ms |
| Garage | 19.3 | 36.4 | 57.9 ms | 32.5 ms |

Driving CPU submission fell from 39.4 to 27.9 ms. Driving GPU time fell from
33.6 to 31.9 ms; stationary GPU time fell from 34.0 to 23.2 ms. The resource
inventory released 102.0 MiB of duplicate geometry arrays and reduced uploaded
GPU textures from 941 to 299 by eliminating identity-transform lookup textures.
Authored image textures and their quality are unchanged.

These measurements cover one integrated GPU and a short spawn replay. Timing
depends on the hardware, browser scheduling and route section; cinematic driving
on this tested device remains approximately 25-29 FPS.

## Bottlenecks and Fixes

- **Static batching used dynamic transforms.** Each city vertex fetched an
  indirect instance index and four matrix texels, even though every chunk's
  instance matrix was identity. The static world and its depth materials now
  compile with an identity batching matrix. Three's draw submission remains in
  place, including its native fallback when `WEBGL_multi_draw` is unavailable.
- **Shared shadow materials repeatedly switched shader variants.** City batches
  now own depth materials so ordinary and batched meshes do not repeatedly
  rebuild program parameters using the same depth material.
- **Unchanged shadows were rebuilt every frame.** An exact shadow-state cache
  checks light/target transforms, caster transforms and membership, geometry,
  alpha-mask textures/materials, quality and batch selection. Moving cars and
  wheels refresh shadows in the same frame. Reflection cameras cannot change
  this schedule. The existing shadow resolution, filtering and coverage remain.
- **Visibility work repeated across the whole city.** Static AABB hierarchies
  prune world/occluder candidates. Unchanged camera matrices reuse visibility;
  changed views are evaluated immediately. Shadow and reflection cameras use
  their own exact chunk bounds rather than repeating instance-matrix/sphere
  calculations. Occlusion still uses actual opaque triangles and the original
  safety margins, keeping openings, cutouts and grazing edges intact.
- **Fullscreen color copies wasted bandwidth.** Beauty feeds AO directly, and
  AO color-copy/multiply composition is fused into one draw. This removes two
  full-resolution passes without changing sample counts or effect dimensions.
  AO-off rendering retains a single-sample copy before in-place bloom. Bloom,
  grading, SMAA and output conversion use their existing algorithms.
- **Sky fragments shaded behind opaque geometry.** The same sky renders after
  opaque surfaces at far depth, allowing early depth rejection. Its cloud/star
  output is preserved; daytime skips unused night-star calculations.
- **Batched source geometry stayed allocated.** Once Three owns the batch data,
  detached chunks keep bounds/shadow metadata and release their duplicate arrays.
  Original collision meshes and BVHs retain their complete authored geometry.
- **Physics scanned unrelated meshes and allocated temporaries.** Road contact
  and barrier broad phases query static bounds. Closest-hit and collider tie
  order are preserved. Barrier resolution and body interpolation reuse scratch
  vectors/quaternions; simulation still runs at 120 Hz with the same equations.
- **Small updates uploaded entire effect buffers.** Tire marks/smoke use changed
  buffer ranges; reset uploads remain complete. Idle reflection updates avoid
  building visibility lists, and unchanged HUD text avoids DOM writes.

## Verification

All 15 verification scripts and the production build pass. Additional checks
cover 200 randomized spatial queries, 409 actual road contacts, exact positions,
rotations and velocities during eight-second trajectories for all four cars,
shadow invalidation, shader patch composition, batch ownership and camera changes.
Existing checks retain every city's triangle/normal/UV/winding across all 14
route views and exercise real barriers, suspension, tires and vehicle animation.

Matched sunny, rain, snow, night, garage and AO-off browser captures retain the
original appearance. Mean RGB differences in the five main captures are below
0.015 of one 8-bit channel level, including half-float rounding and subpixel
antialiasing differences. Browser captures also exercise a 390 x 844 viewport
with multi-draw disabled. There are no browser page errors in the verified runs.

## Repeating the Checks

`npm run verify-performance` runs the new CPU/physics/resource invariants.
`npm run profile-performance -- artifacts/performance/current` measures the game
served at `http://localhost:5173`. The browser harness needs Chrome and Playwright;
image comparisons additionally need Sharp. Packages can be installed locally or
located through `PLAYWRIGHT_MODULES` and `IMAGE_MODULES`.

For an uninterrupted benchmark server:

```powershell
npx vite --config scripts/performance.vite.config.mjs --port 5174 --strictPort
```

In a separate terminal:

```powershell
$env:GAME_URL = 'http://127.0.0.1:5174'
$env:SNAPSHOTS = '1'
npm run profile-performance -- artifacts/performance/current
```

The harness instruments served modules only. Production contains no benchmark
hooks or deterministic clock overrides. `PROFILE_CPU=1` saves CPU profiles;
`MULTI_DRAW_OFF=1` tests the older-driver fallback. `VIEWPORT_WIDTH`,
`VIEWPORT_HEIGHT` and `PIXEL_RATIO` control the test viewport without modifying
the game's graphics settings. `SNAPSHOT_ONLY=1` skips timing runs.

For a baseline, archive the desired Git revision's `src` directory into
`artifacts/performance/baseline/src`, then run with `BASELINE=1`. Compare captures
using `node scripts/compare_performance.mjs <before-directory> <after-directory>`.
Reports and screenshots remain in the ignored `artifacts/performance` directory.
