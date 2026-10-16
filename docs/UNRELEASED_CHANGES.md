# Changes since 03bb820

Reviewed on 16 October 2026 against `03bb820` — **Refine Android Liquid Glass
UI and multiplayer horns**. This covers tracked edits and new source/docs in
the working tree. Generated city/vehicle assets, APKs, SDKs and raw captures
remain ignored; approved branding masters and derived icon assets are tracked.

The current local native export is **0.7.2-native-preview**, Android version
code **11**, with approved A1 branding. Earlier 0.6–0.7.1 measurements and
screenshots are retained as history; the 0.7.1 gameplay layout supersedes the
larger 0.7.0 instrument card and remains the basis of 0.7.2.

## Implementation review

| Area | Change and effect | Principal sources |
| --- | --- | --- |
| Menus/settings | Aligned settings rows; readable values/units; explicit On/Off switches; section selection and saved scroll; reduced-motion/high-contrast behavior; keyboard/safe-area handling | `android/game/scripts/interface.gd` |
| Garage | Vehicles, Registration and Driving aids sections; busy feedback and disabled duplicate selection; selection updates the existing sheet instead of rebuilding it | `interface.gd`, `game.gd` |
| Inline plate editor | Exactly three native inputs inside long/compact previews; framed AZ; DIN typography; full-registration paste; sanitization, debounce and per-car persistence; front/rear inspection | New `plate_editor.gd`; `preferences.gd`, `game.gd` |
| Vehicle preparation | At most one detached previous local model, no inactive peer models; same-car no-op; lights retire with their model; measured loading/assembly/paint/plate/audio phases; memory-pressure cleanup | `vehicle_view.gd`, `game.gd` |
| Shared resources | Immutable shader definitions, per-vehicle material uniforms, up to eight plate templates per builder, up to twelve shared PCM streams, metadata parsed once | `vehicle_water.gd`, `signal_material.gd`, `license_plate.gd`, `engine_audio.gd` |
| Prado front badge | Water-material variants preserve authored back/front/disabled culling, including the two-sided Toyota emblem; original geometry is retained | `vehicle_water.gd`; new `verify_badge.gd` |
| Manual/touch input | Transmission controls follow actual simulation mode; minimum driving targets and safe insets; clutch/shift column beside pedals; held input cleared on mode/menu transitions; HUD touches excluded from camera gestures | `driving_controls.gd`, `interface.gd`, `game.gd` |
| Visibility-first HUD | Background-free 264 × 62 readout; compact 64-unit toolbar pitch with 56-unit glass; circular 144-unit minimap inside a 152-unit target; redundant normal-status text removed | `interface.gd`; new `minimap_mask.gdshader` |
| Maps/multiplayer | City atlas from web geometry; white local/gold remote markers; interpolated positions and headings; 100ms refresh and 3s stale expiry; expanded pan/pinch/zoom/locate/fit; Back restores driving | New `map_view.gd`; `game.gd` |
| Asset preparation | Existing DIN fonts copied locally; shared 2048px map atlas baked from 104,049 road triangles and the web surface layers; GPU compression/mipmaps configured | `android/tools/prepare_interface.mjs`, `configure_imports.mjs` |
| Verification/builds | Cache/isolation and badge scenes added to native Verify; layout, inline-input and full-game tests extended; QA runner supports reuse and exits early if its process dies; primary/OpenGL/interface QA presets use code 10 | `android/build.ps1`, `export_presets.cfg`, `verify_*.gd`, `verify_interface_device.mjs` |

The new `.gd.uid`/`.gdshader.uid` files and test scenes belong with their source.
Selected device screenshots and the compact verification JSON belong in docs;
raw recordings/logs, generated map/fonts and exported binaries do not.

Web gameplay, vehicle equations, relay protocol and city/vehicle source geometry
have no functional edits in this diff. The native minimap reuses the web's
surface collector; it does not replace the street network with checkpoint lines.

## Analysis and limits

The switching change removes repeated preparation work. It does not eliminate
first-use resource reads, renderer uploads or driver pipeline stalls. Sharing
Shader resources does not share mutable paint, lamp or wetness state between
cars. Cache eviction drops idle references, while active playback/models retain
their resources. See [the measurements](android/UI_POLISH_AND_SWITCHING.md).

The latest S9 run recorded cached AMG at **4.6ms CPU / 44.4ms to first frame**
and cached Prado at **5.2ms / 33.5ms**. These are individual fixture observations,
not cold-start, percentile, sustained-FPS or thermal guarantees.

The full-game flow passes **67 checks** on S9 Vulkan and checks HUD overlap
against the projected mesh bounds of all four vehicles in the default follow
view. Desktop layout/render checks cover Vulkan/OpenGL, three window shapes,
both touch layouts, mirrored controls and 75–135% control sizes. The separate
cache regression recorded **64 checks**. The map fixtures inject periodic
protocol snapshots; they are not a new public-relay multiplayer test.

Preserved limitations:

- One initial 0.7.1 phone run exited during city preparation without a Godot
  script/shader diagnostic; relaunch passed the full flow. Its cause is unknown.
- Seven texture RID warnings remain at full-game renderer shutdown. This pass
  does not establish that sustained native memory behavior is solved.
- Physical testing is on the Galaxy S9. Current OpenGL UI evidence is desktop;
  it does not certify the latest OpenGL APK across Android hardware.
- TalkBack traversal, large system text, real keyboard interactions and cutouts
  need wider physical QA. Reference-unit target sizes are not universal dp.
- Map opening releases inputs and pauses local simulation; remote markers keep
  updating. Remote cars remain non-colliding ghosts. No new wire fields are added.

The saved evidence is in [ui-polish-verification.json](android/ui-polish-verification.json).
Earlier physics/audio/browser measurements retain their original scope and
version; they are not relabeled as fresh runs for this documentation review.

## Approved A1 branding and final validation

The user approved **A1 — Old City Drive** after the proposal review. Its
D/road/Maiden Tower-inspired identity now covers the web menu/loading wordmark,
SVG/PNG/ICO favicons, touch icon, native menu/loading/project/boot icons,
Android legacy/adaptive/monochrome resources and Windows executable/taskbar.
All 11 Android presets configure the complete icon set. The old car master is
replaced. The Android monochrome Godot resource and disabled Windows resource
replacement found in the initial audit are corrected.

The branded main/OpenGL/interface QA exports are **0.7.2, code 11**. Production
masters and reproducible raster/ICO generation are documented in
[branding](branding/README.md); final results and hashes are recorded in
[branding verification](branding/VERIFICATION.md). Draft comparisons remain
review history. The user-approved sequence is implementation, verification,
documentation, then commit and push.

During final verification, Windows PowerShell treated an existing Godot stderr
warning as a terminating error before the build wrapper could inspect its exit
code. `Invoke-Checked` now collects stderr and checks exit status plus script,
parse and shader diagnostics explicitly. Warnings remain visible; real faults
still fail the build. The complete native Verify target was rerun successfully.

## Documentation and review checks

The changes since `03bb820` were reviewed across UI, plate editing, minimap,
manual controls, model/material/audio caches, badge culling, build tools,
verification fixtures and documentation. The reports above distinguish older
phone results from the final desktop, new 0.7.2 S9 and packaged-resource checks. Current
validation is summarized in [branding verification](branding/VERIFICATION.md).
