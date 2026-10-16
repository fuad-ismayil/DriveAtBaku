# 0.4 plate lamps and cross-platform vehicle audio

This maintenance pass precedes the loading/menu/Liquid Glass redesign. It does
not change the vehicle equations, physics timestep or control sampling.

## Causes and changes

- The exported registration spotlights had zero intensity and no native switch
  controller. glTF export also loses Three.js's separate spotlight targets.
  The exporter now captures the web's actual mount-relative positions, targets,
  color, intensity, range and cone settings. The native vehicle creates two
  spotlights for its selected rear plate, switches them with low/high beams and
  gives the plate meshes the same receiver layer as the vehicle. Hidden formats
  and disabled plates switch their lamps off. The plate remains non-emissive.
- Godot 4.6's WAV mixer reads the end frame inclusively while wrapping at an
  exclusive loop endpoint. Ending at the PCM allocation's size therefore reads
  a zero frame once per loop. A constant-signal reproduction proves this;
  merely shortening the loop changes the source period. Native loops now retain
  the complete conditioned source and append its first whole PCM frame as a
  decode guard, covering mono and stereo. Gain, filtering, source samples,
  buffering and RPM equations are unchanged. See Godot's
  [WAV mixer](https://github.com/godotengine/godot/blob/4.6-stable/scene/resources/audio_stream_wav.cpp).
- Native remote reconstruction discarded wheel state, and web remote voices
  lacked a tire sample source. Both now consume the transmitted grounded/slip
  fields and use the local tire mix thresholds. Normal braking without tire
  slip remains quiet, as in the web implementation. The native tire balance
  retains the preceding 15% reduction. Tire sound shares engine distance/pan.
- Web remote voices previously fed the local engine master, which becomes
  silent in pause/menu/map. A separate listener gain now follows global volume
  and mute independently of local driving. Join also activates Web Audio inside
  the actual user gesture before awaiting the multiplayer module download.
  Remote voices use the selected complete engine bank and authoritative
  RPM/load/shift/acceleration, with throttle fallback for older clients.

## Device evidence

`artifacts/android/audio-plate-device/` contains the S9 Vulkan result, 24 original
captures, eight-second steady idle recordings of all four cars, an OFF/LOW/HIGH
comparison and numerical analysis. All 564 lamp/receiver/switch checks pass.
The selected plate crop becomes about seven times brighter with the lamps on;
low and high beam captures have identical plate illumination, matching the web
lamp switch. The close-up camera uses a short orthographic depth range so the
sub-millimetre flag/letter artwork remains precise.

The settled historical Ferrari recording has 54 channel-sample steps above
0.002; all four new idle recordings have zero. Ferrari RMS is 0.04700 versus
0.04703 historically at the same 0.32 volume. Maximum new steps are at most
0.000641 and no sample clips. This is a loop discontinuity correction, not a
gain reduction. The AudioFlinger snapshot identifies the QA process's active
44.1 kHz stereo track with zero underruns; historical/global counters are not
used as evidence for that track.

The constant PCM probe additionally renders the faulty/guarded loops through
Godot's real mixer: the faulty signal jumps to zero, the guarded signal stays
constant. `artifacts/android/audio-boundary/` retains the raw reproductions.

## Reproduction

Run native verification and export both **Android Audio Plate QA** and
**Android Multiplayer Features** before the USB tests. Editor shutdown can kill
ADB and remove reverse tunnels, so do not export during the network test.

```powershell
./android/build.ps1 -Target Verify
node android/tools/verify_audio_plate_device.mjs
python android/tools/analyze_audio_plate.py
node android/tools/verify_multiplayer_features.mjs --android --real-web
npm run verify
npm run build
```

The full-web mode uses the real game, real Join button and browser autoplay
policy. Instrumentation supplies explicit owner drivetrain/slip fixtures through
the production network serializer; it does not replace remote voices, decoder,
relay, audio samples or audio graph. Both listeners measure actual audio output
for idle/load/coast/shift/braking on four cars. Checks include distance, local
pause versus listener volume, replicated brake lamps, leave/rejoin and bus
cleanup. Cold vehicle/shader loading must finish and fresh peer sound must
resume before a phase is measured. These are short device runs, not a prolonged
thermal benchmark or a claim of sample-identical audio across different mixers.

## Public website and delivery

The public relay was probed again for this pass and now preserves authoritative
engine state, indicators and plates (`relay-capability-public-0.4.json`). It
does not need the earlier relay replacement again. The public website still
serves an older remote-audio implementation. The matching updated web build is
`android/build/DriveAtBaku-web-0.4.zip`; publish its contents as the static site,
or deploy this checkout's `npm run build` output. The matching Android build is
`android/build/DriveAtBaku-native-debug.apk` (version 0.4.0-native-preview).
Successful local cross-platform tests do not mean the older public website
has been updated. No website publication is performed by these test tools.
