# DriveAtBAku

A fan-made browser driving game set around the Baku City Circuit. Choose a Ferrari 458 Italia, a 2012 Elantra/Avante, a Mercedes-AMG or a Toyota Prado, customize the paint, and explore the circuit by day or night in sunny, overcast, wet, rainy or snowy conditions.

## Play locally

```powershell
npm install
npm run dev
```

Open the local address printed by Vite. The playable circuit assets are included in `public/generated/` as compressed, upload-safe parts; a fresh clone does not need the original `levels/` folder to run.

The pause menu includes saved **Performance**, **Balanced**, and **Cinematic** graphics settings. Cinematic is the default for fresh settings; existing preferences are respected. Balanced and Cinematic combine SMAA with supported HDR MSAA (up to 2x / 4x) and half-resolution ambient occlusion. Cinematic uses 4096-pixel sun shadows and local car reflections; Balanced uses 2048-pixel shadows and smaller captures. Performance uses direct rendering and sky reflections. AO can be disabled separately, and optional 125% / 150% render resolution improves fine edges at added GPU cost.

The wider pause menu groups drive actions, graphics, and atmosphere/audio into columns. Saved **Render Distance** (400–6,000 m) and **Props Distance** (100–3,000 m) sliders apply live and independently. Keep roads and buildings visible while bringing trees and small props closer; prop fades and distance haze soften transitions. Full world distance retains the original atmosphere. See the [graphics settings update](docs/GRAPHICS_SETTINGS_UPDATE.md) for rendering details and verification commands.

The city uses spatial frustum culling, conservative facade occlusion, selective backface culling, static transforms, and material batching where the GPU supports it. Dry asphalt has filtered, matte grain, pavement has fine surface detail, and local car reflections blend smoothly. Weather changes clouds, fog, illumination, wetness/snow and precipitation; it currently changes appearance without changing driving physics. A separate saved **Rain / Snow Amount** slider adjusts falling precipitation from 0–200%. Sliding tires leave fading rubber marks and subtle smoke. The Elantra uses the supplied wheel GLB, visually reduced by 5%, and the Ferrari uses real shadows/AO without an attached shadow rectangle. See the [graphics roadmap](docs/GRAPHICS_REALISM_ROADMAP.md), [graphics/weather verification](docs/GRAPHICS_WEATHER_UPDATE.md), [reflections/tire/wheel update](docs/REFLECTIONS_TIRES_WHEEL_UPDATE.md), and [latest asphalt/idle/precipitation corrections](docs/ASPHALT_IDLE_WEATHER_FIXES.md).

For development measurements, append `?graphicsDebug=1` to the game URL. Compare the same view with `?graphicsDebug=1&occlusion=off` to bypass occlusion while retaining frustum culling. The overlay reports candidate triangles, all-pass draw counts, CPU timings, and reflection captures; it does not measure GPU time. The normal game view has no diagnostic overlay.

Use **WASD** or the arrow keys to drive, **Space** for the handbrake, **C** to switch camera, **R** to recover in place, **Shift+R** to return to the start, and **Esc** to pause. Open **Controls** on the main or pause menu for the complete key list. The pause menu also has day/night and engine-volume controls.

The heading-up minimap uses the circuit's actual road geometry, including its bends and road widths. The circuit appears in cyan, surrounding roads in grey, with pavement, green areas and the coastline for context. It follows the displayed car position and direction, shows more road ahead, and includes a 100 m scale and a start marker. The map is baked once during loading and reused while driving. Run `npm run verify-minimap` to check coordinate alignment and all 14 route checkpoints against the supplied track.

The garage includes the supplied AMG and Prado bodies and wheels, separate saved paint for each car, and saved vehicle selection. Their assets load on first selection and are reused when switching back. See the [garage vehicle update](docs/GARAGE_VEHICLES_UPDATE.md) for model fitting and validation.

The **License Plate** section supports Azerbaijani civilian plates on all four cars. Toggle plates on/off, edit the three registration groups directly on the plate preview, choose **Long** or **Square** (the compact two-row plate), and show or hide **RFID + hyphens** together. Edits update the preview and mounted plates immediately and save separately for each car. **View Front / View Rear** inspect the individually fitted mounts and stamped metal plates. See the [plate implementation and validation](docs/AZERBAIJANI_LICENSE_PLATES.md).

## Build and deploy

```powershell
npm run build
npm run preview
```

The production site is the `dist/` folder. This repository includes `netlify.toml` and `vercel.json` with the build command and output directory. Keep `public/generated/asset-manifest.json` and the `.glb.gz.part*` files in Git; the game needs them at runtime. `node_modules/`, `dist/`, local screenshots, and the original source level are excluded by `.gitignore`.

Important: the supplied circuit identifies itself as a port of another game’s track. Its redistribution terms were not included. **Confirm permission for the circuit and vehicle assets before publishing this repository or deploying the site publicly.** See [asset credits](docs/ASSET_CREDITS.md) and [map conversion notes](docs/MAP_CONVERSION.md).

## Rebuilding the map from local source

If you have the original `levels/baku` source locally:

```powershell
npm run convert-map
npm run pack-assets
```

The packing step verifies the gzip data and splits the large visual GLBs into files below GitHub’s normal single-file limit. It then removes the unpacked copies and standalone conversion textures from `public/generated/`; the original source in `levels/` is not touched. The game does not need those extra textures because the GLBs embed them. Conversion statistics stay local in `artifacts/map-conversion/conversion-report.json` and are excluded from Git and the production site.

## Checks

Run `npm run verify-handling`, `npm run verify-camera`, `npm run verify-drive-camera`, `npm run verify-engine-audio`, and `npm run verify-minimap` for the driving-system checks. The 2012 Elantra asset can be regenerated from the supplied showroom file with `npm run extract-elantra -- "C:/path/to/elantra.html"`.

Run `npm run verify-graphics` to check the Elantra's repaired surface normals against the included showroom asset.

Run `npm run verify-idle-drivetrain` to check all four cars' reset/idle wheel rotation, unpowered gear direction, opposite-gear coasting, powered pullaway, airborne spin, burnout and downhill rolling.

Run `npm run verify-garage-vehicles` to check the supplied AMG/Prado geometry, scale, ground contact, axle alignment, shared wheels, stationary Prado calipers, paint, lamp masks, animation and forward/reverse/braking behavior.

Run `npm run verify-license-plates` to check Azerbaijani input/storage, real plate dimensions and embossing, removal of supplied plate artwork/holders, and front/rear clearance and bracket contact on every actual car in both formats. With the development server running, `/scripts/plate-fit.html` provides a vehicle/side/format/lighting inspector.

Run `npm run verify-realism` to check wheel geometry, Ferrari grounding/glass, weather transitions, precipitation amount/density, asphalt filtering and shader composition, cutout-preserving AO depth, resizing and resource cleanup.

Rain gradually wets all four cars with surface-attached beads and flowing water. Gravity and vehicle speed move the larger drops; paint and glass keep their original colors and textures. Water dries over roughly a minute in sunshine (longer under clouds), and garage views keep the original showroom finish. The existing PBR shaders draw the water without extra particles, geometry, textures, or draw calls; Performance quality skips fine beads and distant views filter unresolved droplets. Sunny asphalt uses a slightly warmer charcoal tone while fully wet roads retain their existing color.

With `npm run dev` running, `npm run verify-vehicle-water` checks buildup/drying, airflow, slopes, independent car materials and actual car rendering in all quality modes and day/night lighting. It verifies every dry car pixel is unchanged before rain and after drying, and saves comparison images to `artifacts/vehicle-water/`. `npm run verify-weather` checks rain, road reflections and dry road restoration in the full game.

Droplet reflections use analytic curved normals and area-preserving pixel filtering, so millimetre-scale beads remain readable at driving-camera distances without increasing their physical size. Glass and exterior trim share the same neutral water reflection layer; original material types, paint, textures and transparency are retained. `npm run verify-vehicle-water-distance` measures the droplet detail separately from the smooth wet film on all four cars at 7 and 12 metres, including front, rear and side views, light/dark paints, sunshine, overcast light and headlights at night. Comparison images and measurements are saved to `artifacts/vehicle-water-distance/after/`.

Run `npm run verify-tire-effects` to check rolling/sliding tires, contact planes, wet/snow/grass/airborne suppression, teleport breaks, fading, bounded effects and cleanup.

Run `npm run verify-barriers` to check fence shadows, vehicle-body collisions, actual openings, and collision gaps against the packed track assets.

Run `npm run verify-world-graphics` to check geometry/UV/normal preservation in both culling paths, opaque facade occlusion, openings, mirrored faces, camera turns, independent shadow/reflection visibility, collision independence, and reflection scheduling/cleanup. It writes the local geometry report to `artifacts/world-graphics-verification.json`. These checks do not replace browser visual inspection or GPU benchmarking.
