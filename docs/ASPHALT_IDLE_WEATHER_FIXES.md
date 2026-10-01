# Asphalt shimmer, idle drivetrain and precipitation control

Implemented and verified on 1 October 2026. This is a narrow correction to the existing graphics/vehicle package.

## Changes

- **Daytime asphalt shimmer:** the main asphalt bitmap includes bright, tiny baked aggregate specks. Disabling added micro-normals and sun shadows did not remove them; replacing the road bitmap with a flat test texture did. The asphalt shader now filters the aggregate with a minimum four-texel mip footprint and an additional screen-space footprint margin. Procedural grain fades when it is too small to resolve. Separate road markings, advertising and numbered texture atlases retain their existing sampling. UVs, source textures, sun color, AO, antialiasing settings and wet-road specular response are preserved.
- **Wrong-direction idle torque:** engine overrun was subtracted as a constant negative engine torque, even with stopped wheels. The signed gear ratio made this propel the car backward in a forward gear and forward in Reverse. Propulsion and overrun are now separate: overrun opposes each driven wheel's actual rotation and cannot exceed its momentum in a step.
- **Residual wheel spin:** the existing static-contact blend can leave small wheel angular velocity after suspension settling. Loaded, unpowered wheels synchronize with their road contact at near-rest speeds. Unpowered rolling opposite the selected gear uses the existing static-contact region to avoid a low-speed numerical limit cycle. Brake, ESC, powered wheelspin and airborne cases retain their existing integration paths. No vehicle tuning in `vehicleCatalog.js` changed.
- **Elantra tire size:** the supplied complete wheel assembly is uniformly 5% smaller visually, with diameter 0.646 m before the model's existing body normalization. Its physics rolling radius, inertia, suspension and gearing remain unchanged to preserve driving feel.
- **Elantra engine volume:** bank gain increases from 1.3 to 1.6, approximately 23% above the previous update. Master engine volume remains adjustable. Ferrari and tire-squeal levels retain their previous settings.
- **Rain/snow amount:** a separate saved **RAIN / SNOW AMOUNT** slider in the pause menu ranges from **0–200%**, defaulting to 100%. It adjusts the falling particles independently of the selected weather, surface wetness, snow cover and lighting. Amount combines with the existing graphics-preset density; changing graphics quality preserves the amount. Reserved particle buffers are reused. The control supports mouse and keyboard adjustment.

## Verification

The production build and all **eleven** verification suites pass. `verify-idle-drivetrain` adds both-car tests for 60-second Neutral/Reverse/first-gear idling at two headings, selected through the actual shift function; residual wheel spin; opposite-gear coasting; correct powered direction; airborne rotation; retained burnout spin; and gravity-driven downhill rolling. Existing handling, camera, audio, map, graphics, barriers, world graphics, realism and tire-effects checks also pass.

Direct comparison with the source saved immediately before this correction:

| Measurement | Before | After |
| --- | ---: | ---: |
| Ferrari 0–30 km/h | 1.875 s | 1.875 s |
| Ferrari 0–100 km/h | 5.283 s | 5.283 s |
| Elantra 0–30 km/h | 3.292 s | 3.317 s |
| Elantra 0–100 km/h | 12.067 s | 12.092 s |
| Ferrari braking distance from 100 km/h | 41.687 m | 41.613 m |
| Elantra braking distance from 100 km/h | 48.764 m | 48.617 m |

The Elantra launch difference is three 120 Hz physics steps. Two-second ordinary forward/reverse coasting and moderate-braking comparisons starting at 15 m/s match exactly; partial-throttle differences are floating-point roundoff. Ferrari steering-position differences in the sampled moderate turn remain below 0.002 mm. Low-speed corrections account for the small full-stop differences. No general handling or acceleration retuning was applied. The local [comparison data](C:/Users/Fuad/Desktop/DriveAtBaku/artifacts/idle-drivetrain-comparison.json) contains the scenarios and before/after traces.

## Live browser verification

The actual WebGL renderer reports **NVIDIA GeForce RTX 3050 Laptop GPU through ANGLE Direct3D11**. Tests used Cinematic, 150% render scale, daytime Sunny and AO enabled at a 1543 × 884 viewport.

- Quick left/right native mouse movement was recorded before and after the asphalt correction. After-recording frames were decoded and visually inspected: road grain is subdued instead of showing the previous bright specks. The retained [before clip](C:/Users/Fuad/Desktop/DriveAtBaku/artifacts/shimmer-before.webm) and [after clip](C:/Users/Fuad/Desktop/DriveAtBaku/artifacts/shimmer-after.webm) are illustrative motion checks, with different motion paths/durations, rather than a performance benchmark.
- On the actual circuit, both cars in manual Reverse and first gear at zero throttle show **0 rad/s on all four wheels**, including the corresponding Elantra visual pivots. After returning to spawn, wheel spin angles remain zero. Existing terrain settling produces only about 0.00006 km/h of numerical body drift, below 0.1 mm over each five-second sample. Flat-ground 60-second fixtures remain exactly stationary.
- The Elantra audio context is running with bank gain 1.6 and engine bus approximately 2.052, compared with approximately 1.667 before this correction. This verifies the gain change; subjective listening is not an automated check.
- Snow at 50% draws 600 flakes in Cinematic. Snow at 0% hides falling particles while preserving snow cover 0.9 and wetness 0.25; 200% draws 2400 flakes. Rain at 50% draws 280/520/800 droplets in Performance/Balanced/Cinematic while preserving wetness 1 and snow cover 0. The 50% choice survives a page reload. All amounts reuse the same allocated buffers. See [live precipitation data](C:/Users/Fuad/Desktop/DriveAtBaku/artifacts/precipitation-live-verification.json).
- WebGL error checks return 0. Temporary inspection hooks are removed before returning the preview to normal play. The development preview was restarted to clear stale source-module caching before final verification.

These are targeted visual and behavior checks; no sustained FPS claim is made by this correction. Screenshots and videos are local verification artifacts excluded from Git.
