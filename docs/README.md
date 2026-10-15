# Documentation

Start with the [root README](../README.md) to run the game and [contributing guide](../CONTRIBUTING.md) for the development workflow.

| Guide | Contents |
| --- | --- |
| [Rendering](RENDERING.md) | Current presets, resolution, post-processing, visibility, shadows and reflections |
| [Verification](VERIFICATION.md) | Repeatable automated checks, browser prerequisites and profiling |
| [Multiplayer](MULTIPLAYER.md) | State replication, interpolation and known limits |
| [Relay setup](../server/README.md) | Local server, configuration, tunnels and load testing |
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
