# DriveAtBaku native preview

A native Godot 4.6.1 Android client for the existing game. There is no WebView
or JavaScript runtime in the APK. The web client remains the reference for
vehicle handling, assets and the multiplayer protocol.

This is a playable development preview, not a finished visual replica.

## Run

The current build is `build/DriveAtBaku-native-debug.apk`. It targets ARM64 and
has been tested on a Samsung Galaxy S9 (SM-G960F, Android 10). Vulkan is the
default, following substantially better driving performance reported on that
device. The Android manifest minimum is API 24; other devices and Android
versions have not been validated.

Open the landscape app, choose a vehicle and press Drive. Single-player uses
packaged assets and requires no connection. Multiplayer connects only when
Join is selected. The default endpoint is the existing public relay; a local
relay can be selected in the Multiplayer tab.

The Driving tab offers buttons or sliders, steering sensitivity, steering
weight, rapid steering response, self-centering, control size and mirrored
controls. Slider mode supports independent steering, accelerator and brake
fingers. Manual mode adds clutch and shift controls. The Garage tab contains
all four vehicles, paint, plates and driving aids. Preferences persist locally.

Desktop controls: WASD/arrows, Q/E shifting, T transmission, C camera and R
recovery. See `game/scripts/driving_controls.gd` for the complete bindings.

## Build on Windows

Prerequisites used for this preview:

- Node.js and the repository's npm dependencies (`npm ci`).
- Godot 4.6.1 Windows console executable and matching Android export templates.
- JDK 21, Android SDK, build-tools 35.0.0, NDK 27.0.12077973 and SDK CMake 3.22.1.
- Git, LLVM-MinGW and Chrome (used only to prepare original vehicle assets and
  verify browser interoperability).

`setup_tools.ps1 -DownloadTemplates` installs the pinned LLVM-MinGW toolchain
and downloads the matching export templates if needed. It does not install
Godot, Java, Chrome or the Android SDK. Tool downloads use upstream releases.

From the repository root:

```powershell
.\android\setup_tools.ps1 -DownloadTemplates
.\android\build.ps1 -Target Prepare
.\android\build.ps1 -Target Verify
.\android\build.ps1 -Target Android -Install
```

With multiple connected devices, add `-Device` followed by the serial reported by `adb devices`.
The script detects local tools or accepts `-GodotBinary`, `-AndroidSdk`,
`-JavaSdk` and `-NativeCompiler`. Environment alternatives are `GODOT_BIN`,
`ANDROID_HOME`, `JAVA_HOME` and `DAB_CXX`.

`Prepare` regenerates city and car assets from this repository. Subsequent
Android builds reuse those prepared assets. Run Prepare again after changing
original map or vehicle assets. Generated assets, native libraries, imports,
build outputs and downloaded tools are ignored by Git.

For the alternative renderer:

```powershell
.\android\build.ps1 -Target Android -Renderer OpenGL
```

This produces `build/DriveAtBaku-native-opengl.apk`. It uses the same application
ID, so installing it over the main preview preserves preferences. Vulkan is
the default for subsequent builds. Exports are debug-signed development APKs;
release signing and store distribution are not configured.

Open `game/project.godot` in Godot after Prepare to edit the native project.
`-Target Desktop` exports a Windows preview. `-Target All` prepares resources,
runs verification and exports both platforms.

## Implementation and verification

- `native/simulation.hpp` ports the original 120 Hz equations using doubles.
  The vendored V8 math functions preserve the web engine's arithmetic behavior.
  There is no replacement engine vehicle controller.
- `native/world.hpp` queries prepared road layers, swept wall contacts and
  finite tree trunks. Asset preparation uses the original city collision audit.
- `native/extension.cpp` converts coordinates only at Godot's presentation
  boundary; simulation coordinates retain the original Z-up convention.
- Native GDScript implements touch input, menus, presentation, audio and
  protocol-v1 JSON WebSocket networking. Remote cars remain collision ghosts.
- All runtime city, car, font and audio resources are packaged in the APK.
  Asset conversion may use a browser during development; the exported app does
  not require one.

Recorded tests cover 32 twenty-second driving scenarios across four cars:
57,600 scalar comparisons had zero difference on both Windows and the S9's
ARM64 CPU. This establishes parity for those inputs and conditions; it does
not establish that every possible maneuver or touch response is identical.
Ground and swept collision fixtures, touch controls, offline installation and
real Android/browser networking also passed. See
[device results](../docs/android/DEVICE_RESULTS.md) for evidence and limits.

The original 26 web verification suites and production build still pass.
The web name labels now use clean text without the old background or border.
Shared audio and plate helpers are exported for preparation; their web behavior
is preserved.

## 0.2 presentation and audio pass

- The engine mixer uses the web RPM/load targets, coast/load layers, smoothing,
  pitch and filtering. Prepared PCM loops use the original overlap conditioning;
  disabling Godot's default QOA compression prevents new block discontinuities.
  Android focus changes pause the sound graph cleanly.
- Plates reuse the actual web geometry, embossed DIN lettering, sizes, graphics,
  measured mounts and material settings. Plate settings persist per vehicle and
  travel through the existing multiplayer appearance payload.
- Rain uses the source wet-road pattern and car bead/flow shader, with one small
  cached city reflection probe. Headlight position, spread and aim follow the
  original profiles, with illumination calibrated against browser captures.
- Prepared room geometry restores 48,465 independently scheduled window lights;
  Government House has its source stone textures, window relief and facade wash.
  The flag uses the original fabric constraints and wind model in native C++.
- The camera retains manual yaw/pitch below 8 km/h and gradually returns as speed
  rises toward 32 km/h. Analog control visuals are refreshed; their sampling,
  hit areas and response remain unchanged.
- Source sky colors, clouds, stars and sun/moon are converted to a native sky.
  Clouds stay static to avoid continuous radiance rebuilding on this phone.

The public relay now preserves indicators and plates, but drops the 0.3 engine
state fields. The app reports that limitation while keeping multiplayer
connected. Updating the server on the second PC and publishing the updated web
client are required for complete public-room engine fidelity; see
[relay update instructions](../docs/android/RELAY_UPDATE.md). Generate the small
portable ZIP with `node android/tools/package_relay.mjs`.

## Remaining work

The complete original rendering pipeline is not yet reproduced. Post-processing,
world shadows, foliage, reflection fidelity and full map UI still need work.
Wind and native horn audio remain unfinished. The mobile loading screen,
main menu and Liquid Glass interface are the next milestone; see the
[UI roadmap](../docs/android/UI_ROADMAP.md).
Sustained driving performance, thermal behavior and peak memory still need
controlled measurement and optimization. There is no 60 FPS claim.

Credits and third-party licenses are accessible from the in-game menu and
generated into the packaged notices file. Original asset credits are retained.

## 0.3 tire effects, lamps and multiplayer

- Tire trails and smoke use actual grounded contact, wheel load, surface grip,
  contact normal and slip, with web thresholds, dry/wet suppression and bounded
  instanced pools. Recovery and car changes break the trails. Tire squeal is
  15% quieter; the driving simulation and analog sampling are unchanged.
- Export metadata preserves every lamp role, original emissive colors,
  headlight scales/high-beam flags and authored masks. Animated lamps no longer
  get replaced by a water shader. Materials serving both brake and reverse
  functions retain both roles. Local and remote models use the same code.
- Remote engines reconstruct the complete selected bank with authoritative
  RPM, engine load, acceleration and shift state. Both platforms retain their
  normal distance/pan envelope. Native gear changes also have the web's quiet
  band-pass shift transient.
- Leave Room is visible while connecting/online and in the Multiplayer menu.
  Closing sockets continue polling their handshake after gameplay disconnects;
  remote models/effects/audio are removed, and single-player/rejoin remain usable.

Additional checks:

```powershell
& $env:GODOT_BIN --headless --path android/game res://tests/features.tscn
node android/tools/verify_multiplayer_features.mjs
# Export Android Multiplayer Features first; this runs the full game on the S9.
node android/tools/verify_multiplayer_features.mjs --android
```

The feature QA export records front/rear lamp states and tire effects without
loading the city. The multiplayer QA export runs the complete city/game,
exchanges state with an actual browser, records the reconstructed engine phases,
and verifies cleanup, return to single-player and rejoin. Separate packages keep
the primary app's preferences intact.

Finish Godot editor/import/export processes before starting USB relay tests.
The editor's default ADB shutdown on exit removes reverse tunnels. The test tool
uses the configured SDK's ADB and creates its tunnel after export, so running a
second editor/export concurrently invalidates the test connection.

## 0.4 plate lamps and audio

Registration lamps now recreate the web's actual light sources and switching.
PCM loops have a whole-frame boundary guard that removes the recurring idle
impulse without reducing engine volume. Both remote mixers consume actual
grounded wheel slip for braking/tire sounds. The web listener has independent
volume/mute routing and Join unlocks audio before its asynchronous imports.

See [causes, recordings and deployment details](../docs/android/AUDIO_AND_PLATE_FIXES.md).
Export **Android Audio Plate QA** and **Android Multiplayer Features**, then run:

```powershell
node android/tools/verify_audio_plate_device.mjs
python android/tools/analyze_audio_plate.py
node android/tools/verify_multiplayer_features.mjs --android --real-web
```

The full-web test uses the actual Join interaction without an autoplay override
and measures both output graphs, remote braking, listener distance and pause.
Install the matching Android build and publish the matching web build together;
the public relay already preserves the required state as of the 0.4 probe.
