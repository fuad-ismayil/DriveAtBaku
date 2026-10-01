# AMG and Prado garage update

Verified locally on October 2, 2026.

The garage now offers Mercedes-AMG and Toyota Prado alongside the existing Ferrari and Elantra. Each new car uses its supplied body and wheel GLBs, supports paint presets/custom colors, and saves its own paint and the selected car. Models load on first selection and are cached for subsequent switches. Four choices fit in a two-column desktop layout; narrow screens retain a single column.

## Model fitting

- Copied the four original files unchanged into `public/assets/vehicles/`; SHA-256 comparisons matched each original.
- Baked export transforms, normalized dimensions, and aligned the bodies with the game's forward/up axes. Both source bodies and both wheel files have independent scales and origins.
- Fitted wheel centers to the wheel arches and the physical contact positions. All wheels rest at their configured rolling radius, steer at the front, spin with road travel and follow suspension travel.
- Selected one AMG wheel assembly: its source file contains four overlapping copies. All four game corners share this geometry/material data instead of drawing those duplicates.
- Kept the Prado's authored brake caliper attached to the steering/suspension pivot, separate from rotating spokes. Preserved its underbody spare wheel and interior.
- Added body paint, restrained metallic/rubber/glass finishes, authored brake/headlight connections, and front/rear emission masks for the AMG's shared bulb meshes. Retained the embedded AMG plate image.
- Added gameplay profiles, recorded engine mixes, hood camera placement and a higher/more distant Prado chase camera. Existing Ferrari/Elantra profiles and driving behavior are unchanged.

The exact model variants, years and factory specifications were not supplied. The new dynamics are gameplay tuning. Audio reuses the existing licensed recordings and is not an authentic recording of either supplied car.

## Verification

- Production build passed.
- All 12 verification suites passed: handling, idle drivetrain, chase camera, drive camera controls, engine audio, minimap, graphics, barriers, world graphics, realism, tire effects and garage vehicles.
- The new geometry suite parses the actual supplied GLBs and checks scale, ground contact, physical/visual axle alignment, all four shared wheel assemblies, normalized normals, calipers, paint, lamps, suspension/steering/spin, forward acceleration, automatic shifts, braking and powered reverse. Its headless geometry checks skip embedded image decoding; the live browser inspection covers image loading.
- Existing Ferrari/Elantra profiles were compared against the previous Git revision and matched. Existing handling results remain 5.28 s / 12.09 s to 100 km/h and 41.6 m Ferrari braking distance.
- Both new cars completed live drive tests in the in-app browser using ANGLE/Direct3D 11 on the NVIDIA GeForce RTX 3050 Laptop GPU, with Cinematic graphics, AO enabled and 150% render resolution. Wheel animation, four grounded contacts, independent active audio banks and a stable reflection texture were observed. No WebGL errors or failed shader programs were detected.
- Visually inspected side/front model fits, garage rendering, paint changes and the AMG hood camera. Saved car/paint restoration and repeated switching among all four cars were checked in the browser.

Local inspection captures and drive traces are under the ignored `artifacts/` directory: `amg-garage.png`, `prado-garage.png`, `amg-hood.png` and `garage-live-drive-report.json`.

This verifies integration and visual fitting; it does not establish factory handling accuracy or benchmark GPU frame times.

## Wheel and lamp corrections

The AMG now saves the user's fitting-page setup: body height **0**, wheelbase **2.75 m**, visual track **1.74 m**, and body longitudinal offset **−0.015 m**. As in that page, body offsets are additional to the baked export normalization; the axle values are absolute. The four wheel centers use X=±0.87 m and longitudinal positions ±1.375 m. These are visual adjustments; existing dynamics, audio and camera profiles are unchanged.

The Prado's outer headlight covers and inner lenses now remain clear and unlit, revealing the supplied reflector bowls and projector detail. The L key cycles **off → one circular bulb per headlamp (low beam) → both circular bulbs per headlamp (high beam) → off**. High-beam emission is restricted to the larger outer circles within their shared chrome meshes. Mirror indicator lenses have a separate, unlit material and stay off throughout this cycle. Its lower clear rear-light bands and their reflectors illuminate white in reverse and fade off outside R. Reverse emission is masked below the amber sections and does not affect red brake lenses.

The Ferrari's circular rear lamps are exported as the separate `brakes` mesh. They now use the existing brake animation, brightening under braking and returning to their resting red level afterward. Existing Ferrari marker/reverse-light behavior is retained.

The AMG and Prado brake material properties and the AMG brake emission mask were compared with the pre-correction snapshot and matched exactly. All supplied mesh geometry matched as well; only the AMG's fitting transforms and the six targeted Prado lens/reflector/bulb material assignments changed. Browser checks confirmed reverse-gear activation, all three headlight modes, unlit mirror indicators, and Ferrari braking without WebGL/shader errors. The saved screenshot values and lamp transitions are covered by `verify-garage-vehicles` and `verify-realism`. The production build and all 12 suites passed again after the headlight-mode correction.

Local correction captures include `amg-wheel-placement-corrected.png`, `prado-headlight-detail-off.png`, `prado-reverse-in-game.png`, `ferrari-circles-braking.png`, `prado-one-bulb-low.png`, and `prado-two-bulbs-high.png`. The scope comparison is recorded in `artifacts/lamp-fix-scope-verification.json`, and the live RTX 3050 L-key cycle in `artifacts/prado-headlight-mode-verification.json`.
