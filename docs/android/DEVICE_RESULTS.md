# Native preview verification — 16 October 2026

Device: Samsung SM-G960F / Galaxy S9, Android 10 (API 29), ARM64, Mali-G72.
The device successfully ran both OpenGL ES 3.2 and Vulkan 1.1.108 exports.

Latest maintenance results: [0.4 plate lamps and audio](AUDIO_AND_PLATE_FIXES.md).

| Check | Result | Evidence under `artifacts/android/` |
| --- | --- | --- |
| Original vehicle equations, Windows | 32 scenarios, 57,600 scalar samples; maximum difference 0 | `physics-verification.log`, `physics-reference.json` |
| Original vehicle equations, S9 ARM64 | Same fixtures; maximum difference 0 | `physics-arm64.log` |
| City ground and swept collisions | 135 road queries, 520 swept contacts; ground error at most 2.27374e-13, sweep error 0, Windows and S9 | `world-reference.bin`, `world-arm64.log` |
| Native touch controls | Independent analog pedals/steering, release/cancel, one-shot shifts and steering response assertions pass | `full-native-verification.log` |
| Fresh offline Android installation | Separate APK without Internet/network permission loads all four cars, audio and city; driving smoke test passes | `device-offline.log`, `offline-permissions.txt` |
| Real Android/browser interoperability | Native Android and actual browser client exchange vehicle, gear, indicator and wheel state through unchanged local relay | `network-verification-android.json` |
| Desktop/browser interoperability | Same protocol integration passes with desktop native client | `network-verification.json` |
| Existing web regression checks | All 26 verification suites and production build pass | `web-verification.log`, `web-build.log` |

Reference driving scenarios run for 20 seconds at 120 Hz. They exercise launch,
braking, proportional pedals, steering, manual shifting, reverse, handbrake,
aids and idle for each vehicle. Samples contain 45 scalar values every 60
steps. Exact agreement in this fixture set does not cover every possible input,
camera behavior, device touch latency or every city contact.

The offline verification uses a separate package with no Internet permission;
the primary app retains Internet permission for multiplayer. Network tests use
a temporary local relay and actual web client, not the public production room.
The Android network test removes its temporary app and port forwarding.

## Renderer decision

Vulkan is the main preview's default because the user reports substantially
better performance while driving on this S9. OpenGL remains an alternative
export. Short startup measurements did not predict that driving experience:

| First 600 frames at a stationary startup view | OpenGL Compatibility | Vulkan Mobile |
| --- | --- | --- |
| Median frame time | 35.606 ms | 36.111 ms |
| 95th percentile frame time | 37.500 ms | 45.792 ms |
| Sample draw calls | 817 | 809 |
| Sample triangles | 907,834 | 907,834 |

These are separate short runs at a 720-pixel internal render height, not a
controlled sustained driving benchmark. Shader warmup, scene position and
thermal state can affect them. They support no general renderer ranking or
60 FPS guarantee. Native renderer resource counters were about 240 MB, while
Android process memory was substantially higher; the counters are not a
complete memory budget. Loading peaks and sustained thermal behavior remain
to be measured.

## 0.2 presentation and sound verification

- `parity-native-verification.log`: unchanged driving equations still match all
  57,600 values exactly. Collision fixtures and analog multi-touch checks pass.
  New fixtures match 144 web engine-mix targets and independently scheduled room
  events/states over one simulated hour; parking-camera and audio lifecycle
  checks pass.
- `parity-web-verification.log` and `parity-web-build.log`: all 26 original web
  suites and the production build pass after shared helper exports/name labels.
- `web-reference/`: actual browser captures of dry/wet, day/night, headlights
  and Government House. Captures completed without browser errors.
- `device-final-visual.log`, `device-final-sky-visual.log` and `visual/`: actual Vulkan S9 captures show original
  embossed plates on all four cars, front/rear indicator changes, restored
  window/facade illumination, moving flag cloth, wet road reflections and car
  beads. The separate visual QA APK has no Internet permission.
- `audio-analysis.json`: recorded native idle (14.84 seconds) and driving
  (10.66 seconds) have zero clipped samples and zero fully empty 10 ms blocks
  after startup fade. Idle source seam jump falls from 0.00885 to 0.00107 after
  the source overlap conditioning. WAV imports explicitly use PCM instead of
  Godot's default QOA blocks. These measurements cannot establish perceived
  sound quality through the phone speakers.
- `device-final-audio-flinger.txt`: this app's active Android audio track reports
  zero underruns while Vulkan runs. Historical global mixer counters are not
  the app's track counters.
- `network-verification-android.json`: current Android and browser exchange
  indicator/vehicle/wheel state through the local relay (nine native updates).
- `device-primary-0.2.log`: the installed primary version 0.2 starts with Vulkan
  and reaches `NATIVE_READY` with the previously selected Prado. The saved
  preferences file hash matches exactly before/after installation
  (`preferences-update-verification.json`). The temporary visual QA app was
  removed after collecting its captures; the comparison app remains installed.
- `relay-capability.json`: the public relay preserves plates but removes the
  signal fields. The packaged replacement passes the same echo diagnostic
  (`relay-bundle-capability.json`). Public indicators remain pending deployment
  on the second PC; see [restart instructions](RELAY_UPDATE.md).

Short wet-night profiles at a 720-pixel internal height, performance quality:

| Scene, 300 frames | Median | 95th percentile | Draw calls | Triangles |
| --- | --- | --- | --- | --- |
| Stationary near Government House | 33.932 ms | 49.067 ms | 739 | 1,061,500 |
| Actual native acceleration/braking | 34.117 ms | 50.776 ms | 672 | 968,101 |

These are short development samples, not sustained thermal benchmarks or a
guarantee of smooth 30/60 FPS. GPU resources in the stationary sample were about
197 MB textures and 149 MB buffers, excluding other process memory. Further
optimization and longer driving measurements remain necessary.

The Android QA app reports seven texture RID cleanup warnings on process exit.
No shader/script errors or native crash appeared in the completed Vulkan test.
The cleanup warning remains unresolved; it is not evidence of an in-session
crash. A Windows headless shutdown crashed once during development; subsequent
standalone runs and the final full verification passed after lifecycle cleanup.

## 0.3 tire, lamp and multiplayer verification

- `final-native-verification.log`: all 57,600 physics values still match
  exactly; world contact fixtures and analog/multi-touch controls pass. The
  final headless feature run passes 266 checks, including early connection
  rejection/retry and cancellation.
- `feature-device/feature-qa/`: actual S9 Vulkan captures cover all four cars
  from the front/rear with lamps off, low/high beams, braking and reverse.
  Both AMG tails respond symmetrically; Prado bulbs illuminate visibly;
  Elantra tail/brake changes and the Ferrari lamps remain functional.
  The device completed 264 checks and 33 captures without a script/shader error.
- `feature-device/feature-qa/tire_marks_smoke.png`: the device renders trails
  and soft smoke; the contact/slip fixture generated 149 segments and 11 puffs.
  Airborne/wet-road/recovery cases verify suppression and trail breaks.
- `final-browser-lamps.log`: the existing real-browser lamp/indicator suite
  passed all 40 weather/time cases and five replicated mode transitions,
  including vehicle changes, with no page or shader errors.
- `final-web-verification.log` and `final-web-build.log`: all 26 original web
  suites and the production build pass. Engine checks additionally cover
  authoritative owner/remote targets for all four banks and car-change state.
- `final-parity.log`: PCM engine/shift imports, RPM/load targets, moving shift
  transients, focus handling and audio-bus cleanup pass.
- `multiplayer-features-android.json` and `multiplayer-device/`: the actual S9
  full game passed 107 checks over 16 idle/rev/load/coast/shift phases on all four
  cars, plus distance attenuation, replicated brakes, Leave Room, single-player
  resume and rejoin. The real browser received 1,920 native snapshots, selected
  all four complete audio banks and observed both server-side departures.
  The device's full phase report has no failures; its 77.81-second stereo
  recording contains zero clipped samples (peak 0.0484 at volume 0.32 with the
  normal remote distance envelope). Loading/vehicle-change gaps are expected.
- `relay-capability-public-0.3.json`: the public relay preserves indicators and
  plates but removes authoritative engine state. The portable replacement's
  echo test preserves all three (`relay-bundle-capability-0.3.json`).
- `device-primary-0.3.log`: primary version `0.3.0-native-preview` (code 3) is
  installed and reaches `NATIVE_READY` on Vulkan with the saved Elantra. The
  preferences hash is identical before installation, after installation and
  after launch (`preferences-0.3-verification.json`). Temporary 0.3 QA apps were
  removed after collecting their artifacts.

The engine tests establish matching bank/state/mixer behavior. They do not
establish sample-identical audio through different devices or subjective
speaker quality. The captures and short tests are not sustained thermal or
peak-memory benchmarks. The UI overhaul was still pending at this stage;
the 0.5 results below cover its implementation.

The known seven texture RID warnings still occur at renderer shutdown. The
completed 0.3 S9 run has no script/shader error or native crash, and remote audio
buses return to their original count after each leave. These short runs do not
establish a long-session memory bound. Early USB tests were invalidated by the
Godot editor shutting down ADB during a concurrent export; the accepted device
run starts after all exports. A separate startup attempt was removed from the
Android task list before initialization, with no recorded game crash.

## 0.4 plate lights, idle discontinuity and bidirectional audio

- `0.4-native-verification.log`: all 57,600 scalar physics samples match exactly;
  contact, controls, presentation, native feature, smoke and protocol checks pass.
  `0.4-final-parity.log` additionally verifies remote grounded/airborne slip and
  brake decoding. The actual mixer renders guarded constant mono/stereo loops
  without a zero impulse; every imported PCM engine loop retains its complete
  source and a matching wrap guard.
- `audio-plate-device/`: the actual S9 Vulkan run passes 564 checks and captures
  all four cars with both plate sizes under OFF/LOW/HIGH lighting (24 captures).
  Lamps are real spotlights, plate materials receive their light, hidden plates
  switch off, and low/high modes retain identical plate illumination. The
  comparison sheet and original captures preserve the plate artwork.
- `audio-plate-device/analysis.json`: four eight-second settled idle recordings
  contain no channel-sample step above 0.002 and no clipping. At the same 0.32
  volume, Ferrari RMS is 0.04700 versus 0.04703 in the settled historical
  recording, which contains 54 such jumps. The active QA process's AudioFlinger
  track has zero underruns in its captured snapshot. Loop duration and volume
  have not been reduced to suppress the tick.
- `multiplayer-features-android-real-web.json` and `multiplayer-device-0.4/`:
  the full S9 game and actual Chrome web game pass 155 native checks over 16
  phases. The browser receives 2,519 native snapshots and records audible
  Android idle/load/coast/shift/braking output for all four banks. Each phase
  stays active until its web audio measurement is acknowledged through the
  normal serialized state. Native voice-bus captures, mixer target checks and
  the master recording verify the reverse direction. The 93.11-second native
  master recording has no clipped samples; the phase windows all have nonzero
  output, with expected model-loading transitions.
- The real Join button unlocks Web Audio with Chrome's normal autoplay policy.
  Local pause mutes the owner's engine while retaining remote sound. Web
  distance measurements at 5/55/140 metres yield RMS 0.03219/0.00826/0.000038;
  native checks verify the same 105-metre cutoff. Braking slip yields native
  tire gain 0.119 and web gain 0.14, preserving the earlier native balance.
  Idle/load/shift phases without slip are silent on the tire layer. Leave,
  single-player resume, rejoin, both departures and bus cleanup pass. There
  are no browser page/console errors in the accepted run.
- Early full-web attempts exposed test timing around cold model loading and
  the first idle phase. The accepted run waits for fresh audio and a measured
  phase acknowledgement, instead of counting an unmeasured phase as passing.
- `0.4-web-verification.log`: all 26 web suites pass. The added engine checks
  cover independent listener mute/volume and remote wheel/brake fields;
  airborne wheel silence also passes. `0.4-web-build.log` builds successfully.
- `relay-capability-public-0.4.json`: the current public relay now preserves
  authoritative audio state, indicators and plates. `public-web-audio-0.4.json`
  still identifies the older published web client. The ready static web update
  is `android/build/DriveAtBaku-web-0.4.zip` (47 files, checksum in
  `builds-0.4.json`). Public-site deployment remains necessary.
- `device-primary-0.4.log` and `preferences-0.4-verification.json`: version
  0.4.0-native-preview (code 4) is installed and reaches `NATIVE_READY` on the
  S9 with the saved AMG. The preference hashes are identical before updating,
  after installation and after launch. Temporary audio/plate and multiplayer
  QA packages were removed after collecting their recordings and reports.

These checks use the real audio mixers and production network paths with
explicit test drivetrain states. They establish functional cross-platform
reconstruction and output, not sample-identical speakers or long-session
thermal behavior. The mobile UI redesign followed in the 0.5 pass below.

## 0.5 mobile interface, controls and multiplayer horns — 16 October 2026

The main APK preset now uses `0.5.0-native-preview`; OpenGL uses
`0.5.0-native-preview-opengl` (both code 5). The final primary APK was exported and signed successfully, but this pass
did **not** install it over the primary app. Device verification used separate
`games.driveatbaku.interfaceqa` and `games.driveatbaku.hornqa` packages. The
0.4 primary-install result above remains the last recorded upgrade test.

- Desktop Vulkan and SM-G960F Android 10 Vulkan full-game interface flows each
  passed 18 navigation checks. Main menu, loading and pause screenshots are
  published in the [mobile interface guide](MOBILE_INTERFACE.md), with a
  [compact device result](interface-verification.json). The UI QA run verified
  that the primary app's saved-preference hash remained unchanged.
- The standalone interface check exercised loading progress/retry, navigation,
  Back, reconnect feedback, coffee presence/URL, input cancellation and bounds
  at 1480 × 720, 1280 × 720, 1600 × 720 and 1024 × 768. Rendered desktop OpenGL
  inspection also covered the menus and loading shader. This does not record
  a new physical-device OpenGL run.
- The final pedal icons, right-edge handbrake and steering-area horn followed
  the 18-check screenshot run. Expanded controls checks cover button/slider
  layouts, scale/mirroring, independent fingers, cancellation and held-input
  clearing. Native feature checks passed 266 assertions; the expanded desktop
  audio/plate suite passed 584, including horn PCM, release, pause and focus.
- The final full-city S9 ↔ actual Chrome web-game horn run passed **56 native
  checks and all 10 browser scenarios**. Native touches and web H events drove
  the real controls. Measurements isolate horn output through the receiving
  audio mix, including the native Master bus after spatial gain/pan. Both
  directions, simultaneous horns, release, pause, lost updates/recovery and
  departure while held passed. See [horn details](HORN_MULTIPLAYER.md) and the
  [saved functional report](horn-verification.json).
- The separate public relay passed five two-way `in.hn` on/off combinations.
  That establishes transport at the time of the probe, not deployment of the
  updated web client. Public browser players still need the matching web build
  for the new pause/stale-audio fixes; Android players need the updated APK.

These are functional and visual checks on the recorded device and desktop,
not a sustained FPS, thermal, memory or two-physical-Android benchmark. The UI
run still reports seven texture RIDs at renderer shutdown, without script or
shader compilation errors. That known shutdown warning does not establish
long-session allocation behavior. Raw logs, screenshots, audio and APKs stay
under ignored `artifacts/android/` and `android/build/`; only selected previews
and compact functional reports are committed.

The final `build.ps1 -Target Verify` rerun passed physics, contacts, controls,
presentation, features, 584 audio/plate checks, interface, four-car smoke and
native/browser network checks. Its headless audio/plate process emitted an
ObjectDB leak warning at exit; this remains separate from the rendered-device
texture-RID warning. All 26 web verification suites and the production build
also passed again during final source/documentation review.
