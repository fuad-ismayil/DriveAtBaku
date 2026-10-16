# Windows and native release verification

Verified locally on 16 October 2026 with Godot 4.6.1, Windows x64 and an
NVIDIA GeForce RTX 3050 Laptop GPU. The release is v1.0.0; see the
[publication guide](../docs/RELEASE.md) for both native downloads.

## Current checks

- Both native builders completed. Controls, presentation/audio parity, mobile
  interface, desktop graphics, desktop interface and application quit checks passed.
- The rendered desktop interface suite passed 49 checks, including Auto display
  sizing, 4:3 rendering, version labels, 176 px circular map, compact instruments,
  persistent garage selection, pause cursor visibility and visible Resume/Quit.
- The packaged Windows release drove all four cars headlessly. Earlier rendered
  package checks on the same graphics implementation passed Vulkan/Forward+ and
  OpenGL/Compatibility, with finite positions, four grounded wheels and second gear.
- A rendered quit check clicked Quit with mouse input, confirmed driving/input
  shutdown and exited successfully. Native main/pause menus contain Quit game and
  no Download action; quitting saves preferences and closes network/audio sessions.
- Android exports version name 1.0.0/code 10000 and includes arm64 Godot and driving
  libraries. APK Signature Schemes v2 and v3 verify. The SDK badging tool emits a
  manifest attribute-type diagnostic; XML inspection confirms the version, and
  Godot export and signature verification succeed. No phone installation was
  performed for this update. The APK uses the existing development signing key.
- Web regression checks passed 29 suites. Desktop browser checks cover display
  sizing, map centering/zoom/fit/locate, pause navigation, transparent instruments
  and white multiplayer names with the shared native size and fade.
- The production mobile matrix passed 81 cases in Chromium, Firefox and WebKit,
  including Android desktop mode and iPad desktop identities at narrow and wide
  sizes, with zero attempted game requests. See the
  [device policy](../docs/MOBILE_DOWNLOAD_GATE.md) for scope and limitations.

The release library must use `GODOTCPP_TARGET=template_release`. A debug-template
library caused a startup heap failure in the release executable despite passing
editor checks. The Windows builder selects the correct target and checks the
packaged executable before creating the ZIP.

## Visual review and evidence

Inspected native Performance, High and Ultra captures, wet daylight, rainy night,
desktop settings, menus, garage and driving HUD. Desktop clouds use seamless,
mipmapped noise; foliage retains leaf color and alpha coverage on both sides;
tree decorations emit at night. The latest 4:3 capture shows the complete circular
map, and the garage keeps its selected-car highlight after mouse exit.

Logs and images remain ignored under `artifacts/`. Current release checks are in
`release-review/` (native captures in `release-review/native/`); earlier graphics
samples are in `windows/final-qa/`, and earlier interface captures are in
`desktop-parity/` and `desktop-polish/`. `npm run stage-release` records package
sizes and SHA-256 values in `artifacts/releases/v1.0.0/manifest.json` and produces
checksums for publication. The manifest contains local paths and is not a release
attachment.

## Performance sample and limits

An earlier 120-frame static-camera sample at 1600 × 900, native rendering height:

| Scene | Median frame time | 95th percentile |
| --- | ---: | ---: |
| Day, Performance | 5.97 ms | 6.90 ms |
| Day, High | 13.72 ms | 17.73 ms |
| Day, Ultra | 26.87 ms | 32.60 ms |
| Rainy night, High | 14.94 ms | 19.14 ms |

These short samples do not establish sustained-driving performance or results on
other hardware. Other runs varied with GPU load and memory pressure. High uses
two shadow cascades over 160 metres and a 32-step reflection pass; Ultra adds the
longer four-cascade pass, PCSS, extra MSAA and indirect lighting.

Vulkan reports seven texture RIDs retained at shutdown. The process exits
successfully; sustained memory growth has not been established. Android uses its
separate mobile renderer; this work makes no new phone performance claim.

Run `./windows/build.ps1` for the release and default checks. Additional rendered
checks are documented in [README.md](README.md).
