# Contributing to DriveAtBaku

Use Node.js 22.12+ or 24+, install with `npm ci`, and start the client with `npm run dev`. The relay is optional for single-player work; its setup is in [server/README.md](server/README.md).

Before submitting a change, run:

```sh
npm run verify
npm run build
```

Run the relevant [browser checks](docs/VERIFICATION.md) for rendering, weather, UI or multiplayer changes. A production build and Node checks cannot prove visual quality or GPU performance. Include the actual browser, adapter, drawing-buffer size, preset, weather, viewpoint and measurement method when making a performance claim.

For interface changes, run `npm run verify-interface-browser` against a running development server. `npm run verify-loading` checks loading artwork dimensions/budgets and download reporting within the standard suite. The [interface and loading guide](docs/LOADING_EXPERIENCE.md) documents the shared glass styles, SVG icons and commands for previewing/regenerating the 4K game captures. Keep selected public screenshots in `docs/images/` current when the visible interface changes.

Environment changes have dedicated [foliage](docs/FOLIAGE_LIGHTING.md), [Government House and flag](docs/GOVERNMENT_HOUSE.md), and [room-light](docs/ROOM_LIGHTS.md) checks. Changes to room-window profiles or source atlases require regenerating and committing both the mask image and its metadata with `npm run build-window-lighting`, followed by the room-light checks. Keep historical benchmark reports identified as historical when adding current geometry or shading work.

Keep pull requests focused. Preserve vehicle tuning, collision coverage, asset fidelity and graphics settings unless those are the intended subject of the change. Use the existing JavaScript modules and verification tools before adding dependencies or abstractions. Match nearby formatting; avoid repository-wide formatting changes in a functional patch.

Do not commit `artifacts/`, build output, dependencies, saved benchmark baselines, credentials or original local level exports. Packed map parts, the asset manifest, runtime audit JSON and bundled asset notices belong in Git. Update the documentation when commands or behavior change, and keep historical measurements clearly identified as such.

Native Android changes follow the [Android build guide](android/README.md). Run `android/build.ps1 -Target Verify` for simulation/contact fixtures, controls, presentation and interface checks. UI changes also need the rendered full-game and isolated device flows in the [mobile interface guide](docs/android/MOBILE_INTERFACE.md); the headless check cannot establish appearance. Audio/lighting/network changes require the relevant checks in [device verification](docs/android/DEVICE_RESULTS.md), including the [real Android/web horn test](docs/android/HORN_MULTIPLAYER.md) when changing horn behavior. Finish Godot exports before USB relay tests, since editor shutdown can remove ADB reverse tunnels. Commit native source, Godot scene/resource UIDs, import/export settings and selected documentation evidence; exclude generated assets, SDK/tool downloads, libraries, APKs, raw recordings, signing credentials and private keystores. QA packages use separate application IDs to preserve the primary app's preferences.

When reporting a bug, include steps to reproduce, expected and observed behavior, browser/OS, vehicle, graphics settings and any useful console errors. A screenshot or short clip helps with visual problems. For a pull request, describe the problem, resulting behavior, checks run and remaining limitations.

New or replacement assets need a traceable source and explicit redistribution terms. Document them in [asset credits](docs/ASSET_CREDITS.md) and retain the required notices. The repository currently has no project-wide source license, and several existing asset terms remain unresolved; contribution guidance does not grant reuse rights.
