# Multiplayer horns

The Android horn button drives the native simulation's horn flag, which is
sent as protocol-v1 `in.hn`. Both the Android and web clients reconstruct the
other driver's horn through their existing positional audio routing. Normal
listener volume and the existing 105 m distance envelope apply.

## Reliability changes

- Native horn press/release bypasses the normal state-send interval.
- Native received horns follow the latest packet, independently of the 120 ms
  vehicle interpolation buffer.
- Web pause clears the horn and immediately publishes its released state.
  Non-driving and hidden web states cannot advertise a held horn.
- Web remote audio silences after 1.5 seconds without a newer state sequence,
  matching the native stale-peer protection. Repeated relay snapshots do not
  keep an abandoned horn alive. Fresh updates restore the voice normally.
- Leaving a room disposes the remote audio graph. The Android button now uses
  a classic automotive trumpet/bulb horn icon instead of a megaphone.

The existing public relay already preserves `in.hn`; no server update is
required. Publish the updated web build to apply the web pause and stale-peer
fixes to live browser players. Android players need the updated APK.

## Verification

`verify_horn_multiplayer.mjs` starts the actual web game in Chrome, enters
multiplayer through the real Join button, then connects a full native game.
Native presses use the touch control and simulation; web presses use H key
events. It isolates unrelated engine/tire voices and measures horn audio in
the receiving mix rather than accepting a network flag as proof of sound.

Ten scenarios cover quiet, native hold/release, web hold/release, simultaneous
horns, native pause, web pause, resume, and leaving while honking. Packet-loss
injection verifies silence during a stalled peer and recovery after fresh
updates in both directions. Native WAV captures and both clients' RMS results
are saved under `artifacts/android/horn-device/` or `horn-desktop/`.

The separate public-relay check joins two diagnostic peers far outside the
playable city and verifies each peer receives the other's on/off state across
five combinations. It tests transport only; the connected-game test verifies
the audio output.

```powershell
# Complete the Android build guide's preparation/export setup first and set
# GODOT_BIN to the Godot 4.6.1 console executable.
node android/tools/verify_horn_multiplayer.mjs
& $env:GODOT_BIN --headless --path android/game --export-debug 'Android Horn QA' ../build/DriveAtBaku-horn-qa.apk
# Finish exports before this command; editor shutdown can remove ADB tunnels.
node android/tools/verify_horn_multiplayer.mjs --android
node android/tools/verify_horn_relay.mjs wss://server.driveatbaku.games/
```

The phone runner installs the separate `games.driveatbaku.hornqa` package.
It reads the complete native report from the app's saved JSON, avoiding Android
log-line truncation. Generated horn audio, QA APKs, raw WAV files and logs stay
ignored. This test does not install 0.5 over the primary game package.

The physical test uses the SM-G960F Galaxy S9 on Android 10 with native Vulkan
and the current repository web client in Chrome. This is an Android ↔ web test;
it does not claim a separate run with two physical Android devices.

Recorded result on 2026-10-16: **56 native checks and all 10 browser scenarios
passed**. The final native Master mix measured approximately 0.022 RMS while
receiving the web horn and 0.0000015 RMS when released. The browser listener
also measured nonzero horn output while Android honked and silence afterward.
Both dropped-update checks, recovery and leaving while honking passed. The
public relay passed all five two-way on/off combinations without a server
change. See [saved verification results](horn-verification.json).
