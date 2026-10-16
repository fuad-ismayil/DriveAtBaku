# Native Android port

The Android client lives in `android/`. The existing web client remains the
reference implementation for handling and the multiplayer wire protocol.

## Technical decisions

- Godot 4.6.1 native Android export with Vulkan Mobile as the default on the
  Galaxy S9, following the user's driving comparison. An OpenGL Compatibility
  APK remains available through the same build script.
- C++ GDExtension for the vehicle simulation. The core uses double-precision
  math, Z-up coordinates, and the original 120 Hz equations. Godot transforms
  are converted only at the presentation boundary.
- Reuse the existing city audit and collision-building tools during asset
  preparation. Package prepared geometry and all runtime resources locally.
- Preserve protocol-v1 JSON over secure WebSocket; do not use an incompatible
  engine multiplayer protocol.
- Keep the web build independent of Android tools and generated files.

## Acceptance criteria

- Native physics agrees with recorded JavaScript trajectories for all four
  vehicles, including partial pedals, aids, manual shifting and reverse.
- Both touchscreen modes support independent fingers, cancellation, weighted
  analog steering and persistent preferences.
- A fresh installation starts single-player without network access and includes
  all four vehicles, audio and required resources.
- Browser and Android players share the existing relay, appearance and state.
- Android application remains landscape and restores preferences after restart.
- Measure loading peaks, sustained frame times and memory on the S9; do not
  claim performance or exact handling parity without the relevant evidence.

## Progress

A playable native preview now includes all four cars, prepared city geometry,
native double-precision vehicle simulation, touch buttons and sliders, manual
shifting, saved preferences, local audio and the existing multiplayer protocol.

The Windows and S9 ARM64 simulation each match all 57,600 recorded scalar
samples exactly. Ground/swept-contact fixtures, multi-touch behavior, a fresh
Android installation without Internet permission and Android/browser relay
interoperability passed. The original web verification and production build
also pass.

Visual fidelity and sustained device performance remain unfinished. See the
[native project guide](../../android/README.md) and
[device results](DEVICE_RESULTS.md) for build instructions and test limits.

## 16 October presentation pass

The vehicle equations and analog input logic remain unchanged. Read-only native
engine-load/shift values now feed a mixer derived from `src/engineMix.js`.
Asset preparation runs the original web loop conditioning and forces PCM WAV
imports rather than QOA. Native parity fixtures cover 144 web mixer targets,
independent room schedules over an hour, camera return and audio lifecycle.

Preparation exports the web plate bases and individual embossed glyphs separately
to avoid loading every possible glyph for every car. Vehicle metadata retains
the actual plate carriers and water-material eligibility. The runtime selects
exact plate formats and batches only the required characters.

The original procedural room-light geometry, room mask, Government House relief
and stone textures are now prepared alongside the city. Independent room timers
use the source random sequence and dwell/fade behavior. Native flag cloth keeps
the source constraints and 120 Hz stepping, with presentation updates at 30 Hz
nearby. Neither system modifies vehicle simulation.

Wet roads reuse the source world-space pattern; car water shader helpers and sky
fragment logic are generated from the original files. A small cached reflection
probe excludes vehicles and updates infrequently. Native lighting units require
calibration against browser captures rather than copying numeric intensities.

Indicator state already passed through the project relay at this stage. The deployed public
relay removes it, confirmed by an own-state WebSocket echo. The source bundle
and [restart instructions](RELAY_UPDATE.md) are ready, but that separate PC must
be updated before public cross-platform indicator synchronization can work.
This historical limitation was resolved by the 0.4 public-relay probe below.

## 0.3 tire, lamp and multiplayer pass

The presentation snapshot now exposes wheel load, surface grip and contact
normal without changing the 120 Hz equations. Native bounded instanced pools
reproduce the web tire-effect conditions, fade, smoke heat/credit and wet-road
suppression. Tire squeal gain is reduced by 15%.

Vehicle export records material identity separately from its list of light
roles. This prevents a brake/reverse material from losing a role and prevents
the wet-surface shader from freezing animated lamp emission. Original colors,
headlight scales/high-beam flags and authored local-coordinate masks survive
the GLTF boundary. One runtime path serves all cars and remote observers.

Protocol 1 has optional `au` engine-load/shift/acceleration state and wheel
contact normals. Browser remote engines share the owner's complete bank update
function; Android uses the corresponding verified mixer, private buses,
distance gain/pan and a quiet moving-shift transient. A car change discards the
previous bank's presentation state rather than blending different engines.

Leave Room cancels reconnects, polls the old socket's close handshake, removes
remote models/effects/audio and returns to the menu. Single-player and rejoin
remain available. Immediate connection rejection now enters retry handling.

The 0.3 public-relay audit preserved indicators but removed `au`. The portable
replacement bundle preserves engine state, indicators and plates in its echo
test. Public-room fidelity requires that relay update and the updated web
build. The [0.5 mobile interface](MOBILE_INTERFACE.md) now implements native
loading/navigation, the main menu, pause and supporting screens.

The 0.4 public-relay audit now preserves `au`, indicators and plates. The
remaining web publication is the updated client bundle. Actual registration
spotlights, guarded PCM boundaries, remote grounded-slip audio and independent
web listener routing are described in the [0.4 audio/plate report](AUDIO_AND_PLATE_FIXES.md).

## 0.5 mobile interface and horns

`interface.gd` now owns native main/pause navigation and supporting pages;
`loading_interface.gd` owns packaged artwork, slideshow transitions and actual
preparation progress. `game.gd` preserves garage/pause context across car
loads, handles threaded-load failures/retry and Android Back, and clears held
driving input on menu/focus transitions. System fonts and `ui_icons.gd` replace
the original development tabs. Accessibility adds reduced-motion and glass
contrast preferences without renaming saved settings.

`glass_panel.gd` and `liquid_glass.gdshader` share one scene copy for transparent
rounded lenses. Performance samples once per fragment; Balanced samples five
times. Loading uses its own artwork capture. `prepare_interface.mjs` derives
two 1920-pixel-wide images from the repository's web captures; all runtime
resources remain packaged and no browser runtime is introduced. See the
[interface guide](MOBILE_INTERFACE.md) for screenshots, touch layouts and limits.

`prepare_audio.mjs` also generates a guarded PCM horn loop through
`prepare_horn.mjs`. The native engine-audio node plays it independently of RPM
through existing listener gain/pan. Native edge sends and latest-packet horn
decoding complement web pause release and sequence-based stale-audio muting.
These remain protocol-v1 changes; no relay code changed. Separate interface
and horn QA presets exercise the actual game with isolated app IDs. See
[multiplayer horns](HORN_MULTIPLAYER.md) for measured two-way output.
