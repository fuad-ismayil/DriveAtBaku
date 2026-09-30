# DriveAtBAku

A fan-made browser driving game set around the Baku City Circuit. Drive a Ferrari 458 Italia or a 2012 Elantra/Avante, customize the paint, and explore the circuit by day or night.

## Play locally

```powershell
npm install
npm run dev
```

Open the local address printed by Vite. The playable circuit assets are included in `public/generated/` as compressed, upload-safe parts; a fresh clone does not need the original `levels/` folder to run.

Use **WASD** or the arrow keys to drive, **Space** for the handbrake, **C** to switch camera, **R** to recover in place, **Shift+R** to return to the start, and **Esc** to pause. Open **Controls** on the main or pause menu for the complete key list. The pause menu also has day/night and engine-volume controls.

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

The packing step verifies the gzip data and splits the large visual GLBs into files below GitHub’s normal single-file limit. It then removes the unpacked copies and standalone conversion textures from `public/generated/`; the original source in `levels/` is not touched. The game does not need those extra textures because the GLBs embed them.

## Checks

Run `npm run verify-handling`, `npm run verify-camera`, `npm run verify-drive-camera`, `npm run verify-engine-audio`, and `npm run verify-minimap` for the driving-system checks. The 2012 Elantra asset can be regenerated from the supplied showroom file with `npm run extract-elantra -- "C:/path/to/elantra.html"`.
