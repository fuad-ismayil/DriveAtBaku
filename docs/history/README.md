# Historical engineering reports

These reports retain the reasoning, test scenarios and measurements behind earlier changes. Their settings and test counts apply to the recorded stage. For current behavior and commands, use [rendering](../RENDERING.md), [verification](../VERIFICATION.md) and the [documentation index](../README.md).

| Report | Purpose |
| --- | --- |
| [Graphics research](GRAPHICS_RESEARCH.md) | Initial sky, lighting and HDR pipeline |
| [Graphics roadmap](GRAPHICS_REALISM_ROADMAP.md) | Culling, batching, reflections and research tradeoffs |
| [Browser verification](GRAPHICS_BROWSER_VERIFICATION.md) | Early integrated-GPU inspection and limitations |
| [RTX verification](GRAPHICS_RTX_VERIFICATION.md) | Early discrete-GPU measurements |
| [Weather update](GRAPHICS_WEATHER_UPDATE.md) | MSAA, AO and visual weather implementation |
| [Reflections and tires](REFLECTIONS_TIRES_WHEEL_UPDATE.md) | Reflection blending, tire effects and wheel fitting |
| [Asphalt and idle drivetrain](ASPHALT_IDLE_WEATHER_FIXES.md) | Shimmer filtering, idle-wheel corrections and precipitation controls |
| [Garage vehicles](GARAGE_VEHICLES_UPDATE.md) | AMG/Prado fitting, calipers and lamp corrections |
| [Performance optimization](PERFORMANCE_OPTIMIZATION.md) | Static batching, shadow caching and resource ownership |
| [1080p investigation](ENGINE_PERFORMANCE_INVESTIGATION.md) | Resolution, HDR bandwidth, SMAA/bloom fusion and GPU timing |
| [Vehicle cameras](vehicle-camera-research.md) | Camera references and chosen driving behavior |

Raw captures, benchmark JSON and saved before-change source are intentionally local in `artifacts/`. Follow each report's reproduction instructions and retain a matching baseline when making a new comparison. Reported historical results have not been independently rerun on every supported device.
