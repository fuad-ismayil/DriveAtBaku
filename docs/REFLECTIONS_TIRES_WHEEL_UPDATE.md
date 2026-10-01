# Reflections, tire effects and supplied Elantra wheel

Implemented and checked locally on 1 October 2026.

## Result

- Dry asphalt uses .97 base roughness with a .94 floor, less normal perturbation, and 28% of the previous direct/environment specular response. The road atlas receives the matte finish without adding grain to its other tiles. Wet weather restores the full specular response and its existing puddle roughness; road markings and advertising materials retain their own shading.
- Car reflections retain a single published texture. Completed local probes crossfade into it over .9 seconds in linear HDR. The previous reflection remains visible during capture, weather changes and teleports. Captures take one face per frame, begin after sufficient movement, exclude cars and transient smoke, and reuse the sun shadow map. Garage and Performance retain their dedicated environments.
- Elantra engine gain is 30% higher. Tire squeal is 30% lower at moderate slip, with its ceiling reduced from .23 to .16. Wind, horn and Ferrari engine levels are unchanged. Existing engine-volume and mute controls still work.
- Grounded, loaded tires leave narrow rubber strips during appreciable slipping. Strips follow real contact points and surface normals, have soft edges/tread grooves, and fade over 55 seconds. Contact histories break across jumps, resets and loss of traction. Grass and airborne wheels produce no rubber strips.
- Smoke is limited to small wisps during sustained slipping. Puffs last .8–1.15 seconds, have at most .11 base opacity before soft-edge/fade attenuation, and are suppressed on wet/snowy ground. Fixed pools cap effects at 2,048 mark segments and 72 smoke instances for both cars.
- `public/assets/vehicles/elantra-wheel.glb` is an unchanged copy of the supplied `elantra left front wheel.glb` (SHA-256 `4a3aeddc46d2cbfb98b5367f69ac315ca8820464239818fb5a26d8e0d24097fc`). Its four tire/rim primitives replace the former generated wheel at all four corners, sharing geometry/materials. Export transforms are normalized to the original .68 m rolling diameter; opposite sides use rotation rather than inverted geometry. Aluminum and rubber finishes are tuned in code. Calipers remain on the steering/suspension pivots. Wheel suspension/spin indices now follow the actual side of the vehicle rather than the export's reversed left/right labels.

## Verification

The production build and all ten suites pass: handling, camera, drive camera, engine audio, minimap, graphics, barriers, world graphics, realism, and tire effects. Checks exercise the supplied GLB, wheel bounds/normals, stable reflection publication/crossfades, real audio gain targets, contact planes, teleport breaks, wet/snow/grass/airborne suppression, fading, bounded effects and disposal. The existing bundle-size warning remains.

Live WebGL again reported **NVIDIA GeForce RTX 3050 Laptop GPU through ANGLE / Direct3D11**. Dry and wet appearances, the supplied wheel, a short acceleration/handbrake/braking sequence, actual engine gain, no idle tire effects and quality switching were checked. No application errors, shader warnings or context loss were reported.

The first motion probe recorded ten monotonic reflection fades of 46–62 rendered steps each, with zero published-texture swaps; its handbrake maneuver peaked at eleven active puffs. A gentler final check recorded 543 blend draws, zero texture swaps, 134 mark segments and a peak of eight puffs. A close inspection of the finished wheel/rubber colors confirmed the same restrained smoke level. These are short local driving checks, not a full-route test. Audio gain was verified numerically; subjective listening was not performed.

Three Performance → Balanced → Cinematic cycles returned to the same resource counts each time:

| Preset | Geometries | Textures |
| --- | ---: | ---: |
| Performance | 736 | 917 |
| Balanced | 747 | 944 |
| Cinematic | 748 | 944 |

These counts cover the environments warmed during this session; they are not VRAM byte measurements or a long-duration leak test.

A completed-source stationary Elantra sample at spawn used Cinematic, 4x MSAA + SMAA, AO on, Sunny/day, lights off, **1543 × 884 viewport, DPR 1, 150% render scale, 2314 × 1326 framebuffer**. After 60 warm-up frames, all 240 GPU query samples completed: GPU median/p95 **12.51 / 14.33 ms**, CPU submission median **12.10 ms**, mean frame interval **13.92 ms** (approximately 72 FPS). No disjoint event, timeout or context loss occurred. This single short sample does not establish sustained performance and is not directly comparable with earlier native-1080p measurements under different conditions.

Local evidence is saved under ignored `artifacts/`: `polish-driving-verification.json`, `polish-driving-final.json`, `polish-quality-cycles.json`, `polish-gpu-verification.json`, `polish-elantra-wheel-final.png`, `polish-effects-close.png`, `polish-dry-elantra.png`, and `polish-wet-elantra.png`. Close inspection used a temporary camera pose; normal controls and all inspection hooks were restored afterward. Sunny/day, lights off, Cinematic, AO on and the pre-existing 150% render scale were restored, with Elantra selected.

This adds rubber skid marks and smoke. Weather-dependent grip, water spray, snow tracks/accumulation, wipers, shelter and city reflections in road puddles remain further work.
