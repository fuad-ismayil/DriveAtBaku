# DriveAtBaku

A fan-made browser driving game set on Baku's streets. Explore the city in four vehicles, change the weather and time of day, or drive alongside other players through a WebSocket relay.

**[Play DriveAtBaku](https://www.driveatbaku.games/)** · [Vercel mirror](https://driveatbaku.vercel.app/) · [Documentation](docs/README.md)

![Ferrari 458 driving through Baku with the minimap and driving HUD visible](docs/images/baku-gameplay.webp)

*Gameplay captured from the production build in Chrome.*

## Features

- Baku city geometry, surrounding streets and coastline, with audited race-event structures excluded from the playable scene.
- Ferrari 458 Italia, Elantra/Avante, Mercedes-AMG and Toyota Prado; saved vehicle selection, individual paint colors and configurable Azerbaijani license plates.
- Fixed-step vehicle dynamics, suspension, automatic/manual transmission, ABS, traction and stability aids, world collisions and follow/hood cameras.
- Day/night lighting, headlights, engine and tire audio, skid marks, and a heading-up minimap with a full-map view.
- Independent nighttime room lights, [Government House](docs/GOVERNMENT_HOUSE.md) stone and window detail with a wind-driven Azerbaijani flag, and [rounded tree shading](docs/FOLIAGE_LIGHTING.md).
- Sunny, overcast, wet-road, rain and snow modes, adjustable precipitation and vehicle surface water. Weather affects appearance; it does not change driving grip.
- Performance, Balanced and Cinematic graphics presets, independent render/props distances, ambient occlusion and rendering-resolution controls. Balanced/Cinematic use HDR, SMAA and supported scene MSAA, cached shadows and local car reflections.
- Multiplayer with interpolated remote vehicles, player names and replicated vehicle appearance/effects. Remote cars are visual ghosts and do not collide with one another; a separate relay is required.

## Getting started

Use **Node.js 22.12+ or 24+**, npm, and a modern browser with hardware-accelerated WebGL 2. Browser verification targets Google Chrome. The first load downloads roughly 240 MiB of map and vehicle data; loading time depends on the connection and device.

```sh
git clone https://github.com/fuad-ismayil/DriveAtBaku.git
cd DriveAtBaku
npm ci
npm run dev
```

Open the local URL printed by Vite. Packed map assets and vehicle files are included; the original `levels/` directory and Python conversion tools are unnecessary for normal development. The relay has its own install and startup steps in [server/README.md](server/README.md).

## Build and deploy

```sh
npm run build
npm run preview
```

The production site is `dist/`. Netlify and Vercel configuration files already specify the build command and output directory. Keep `public/generated/asset-manifest.json`, its compressed asset parts, collision data and route data together. The build also includes the generated room-window mask under `public/assets/environment/`; its source metadata is `src/windowLightingAtlas.json`. Static hosting serves the game; it does not run the multiplayer relay.

See [map conversion](docs/MAP_CONVERSION.md) for optional asset regeneration and [verification](docs/VERIFICATION.md) for the checks to run before a release.

## Controls

| Input | Action |
| --- | --- |
| W / S or ↑ / ↓ | Throttle / brake and reverse |
| A / D or ← / → | Steer |
| Space | Handbrake |
| T; Q / E; X | Toggle automatic/manual; shift down/up; clutch |
| 1 / 2 / 3 | Toggle ABS / traction / stability aids |
| C; mouse; middle mouse | Follow/hood camera; look around; hold to look behind |
| L; H | Cycle low beams / high beams / off; horn |
| Comma (,); Period (.); Slash (/) | Left turn signal; right turn signal; hazard lights |
| M | Full map |
| R; Shift+R | Recover in place; return to the start |
| Esc | Pause/resume |

Gamepad input supports steering, throttle, brake, handbrake, clutch and horn through the browser Gamepad API. The in-game **Controls** panel lists keyboard and mouse inputs. Graphics, atmosphere and audio settings are available in the pause menu and saved locally.

Turn signals toggle off when pressed again. Selecting the other side or hazards replaces the current mode. All lamps on a car blink together (400 ms on / 400 ms off). Signals continue through pause, garage visits and recovery; changing cars clears them. Typing and held-key repeats do not toggle signals. Multiplayer needs the updated relay as well as the client; it shares the mode and blink reference with joining and existing players.

## Technology and structure

The client uses JavaScript modules, Three.js r180, `three-mesh-bvh`, WebGL and Web Audio, built with Vite. The multiplayer relay uses Node.js and `ws`. Python is used only for optional source-map/model conversion. Playwright and image-analysis packages support the browser checks.

| Path | Purpose |
| --- | --- |
| `src/main.js`, `src/startup.js` | Game loop, UI integration and startup |
| `src/` | Vehicle dynamics, graphics, weather, cameras, audio, maps and collision modules |
| `src/net/` | Multiplayer transport, state replication and remote vehicles |
| `src/governmentHouse.js`, `src/flagCloth.js`, `src/roomLights.js`, `src/roomLightActivity.js`, `src/foliageLighting.js` | Landmark detail, flag simulation, independent rooms and canopy shading |
| `public/assets/`, `public/draco/` | Vehicle, environment, audio, font, loading and decoder assets |
| `public/generated/` | Packed map geometry, collision geometry, route and transfer manifest |
| `scripts/` | Asset tools, regression checks, profilers and plate-fit inspector |
| `server/` | Standalone WebSocket relay and load test |
| `docs/` | Maintained technical guides, asset credits and historical engineering reports |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, verification commands and information to include when reporting a problem. Keep changes focused and provide reproducible evidence for changes to rendering, performance, handling or collisions.

## Credits and licensing

This repository currently has **no project-wide source-code license**. Public availability does not establish permission to reuse the source or all bundled assets. Third-party files retain their individual terms; see [asset credits](docs/ASSET_CREDITS.md), [audio sources](public/assets/audio/engines/SOURCES.md) and the [font license](public/assets/fonts/AZ-DIN-OFL.txt).

Redistribution terms for the Baku map and several supplied vehicle models remain unconfirmed. The Ferrari, audio and font attributions do not cover those assets. DriveAtBaku is not affiliated with the vehicle manufacturers, Formula 1 or the original track's rights holders.
