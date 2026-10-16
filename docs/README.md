# Documentation

Start with the [root README](../README.md) to run the game and [contributing guide](../CONTRIBUTING.md) for the development workflow.

| Guide | Contents |
| --- | --- |
| [Unreleased change review](UNRELEASED_CHANGES.md) | Analysis of all source/docs changes since 03bb820, current verification, remaining limits and approved A1 branding |
| [Brand identity](branding/README.md) | Approved A1 meaning, masters, platform icons, regeneration and proposal history |
| [Rendering](RENDERING.md) | Current presets, resolution, post-processing, visibility, shadows and reflections |
| [Verification](VERIFICATION.md) | Repeatable automated checks, browser prerequisites and profiling |
| [Multiplayer](MULTIPLAYER.md) | State replication, interpolation and known limits |
| [Relay setup](../server/README.md) | Local server, configuration, tunnels and load testing |
| [Native Android preview](../android/README.md) | Windows toolchain, asset preparation, ARM64/desktop exports and touch controls |
| [Android implementation](android/IMPLEMENTATION.md) | Original simulation port, native presentation, effects and protocol integration |
| [Android device verification](android/DEVICE_RESULTS.md) | S9 results, exact physics fixtures, audio/lighting checks and measurement limits |
| [Android audio and plate fixes](android/AUDIO_AND_PLATE_FIXES.md) | Real plate lamps, PCM boundary correction, remote braking audio and bidirectional tests |
| [Android mobile interface](android/MOBILE_INTERFACE.md) | 0.5 Liquid Glass menus/loading, touch controls, accessibility, device screenshots and QA |
| [Android UI polish and switching](android/UI_POLISH_AND_SWITCHING.md) | Current visibility-first HUD, multiplayer maps, inline registration, badge correction and bounded switching caches |
| [Multiplayer horns](android/HORN_MULTIPLAYER.md) | Android/web horn audio, stale-peer protection, reproduction commands and measured two-way results |
| [Android UI roadmap](android/UI_ROADMAP.md) | Completed mobile redesign and remaining device, layout and performance work |
| [Map conversion](MAP_CONVERSION.md) | Optional source conversion, packing and collision pipeline |
| [City map audit](CITY_MAP.md) | Audited event geometry exclusions and preservation checks |
| [City collisions](CITY_CLEANUP.md) | Event-enclosure removal, visible facades and tree trunks |
| [Ground surfaces](GROUND_SURFACES.md) | Asphalt, street markings, curb seams and terrain contact |
| [Graphics settings](GRAPHICS_SETTINGS_UPDATE.md) | Independent distance controls, UI and browser checks |
| [Foliage lighting](FOLIAGE_LIGHTING.md) | Rounded canopy shading, grazing-card coverage, leaf highlights and weather integration |
| [Government House](GOVERNMENT_HOUSE.md) | Landmark limestone, window relief, flag and night-only architectural lighting |
| [Room lights](ROOM_LIGHTS.md) | Independent room activity, window masks and nighttime city lighting |
| [License plates](AZERBAIJANI_LICENSE_PLATES.md) | Plate geometry, per-car mounting and garage controls |
| [Interface and loading](LOADING_EXPERIENCE.md) | Liquid Glass styling, vector icons, driving HUD, 4K artwork, slideshow controls, streaming progress and capture workflow |
| [Asset credits](ASSET_CREDITS.md) | Provenance, individual licenses and unresolved asset terms |

## Historical reports

[history/](history/README.md) preserves earlier rendering research, model-fitting decisions and measured investigations. These reports describe particular development stages and hardware, rather than the current defaults or universal performance guarantees. Screenshots, raw measurements and comparison baselines referenced there are local files under ignored `artifacts/`; they are not published evidence in this repository.

The selected gameplay and menu previews in `images/` show the current interface. Runtime collision audits in `src/` are executable data used to validate the supplied map, rather than temporary reports.

Android recordings, raw device logs, APKs and generated assets likewise remain local and ignored. Selected screenshots and compact functional verification summaries are committed under `android/` alongside the guides and reproduction commands. They do not imply that a local build has been published to the public website.
