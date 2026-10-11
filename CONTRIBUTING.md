# Contributing to DriveAtBaku

Use Node.js 22.12+ or 24+, install with `npm ci`, and start the client with `npm run dev`. The relay is optional for single-player work; its setup is in [server/README.md](server/README.md).

Before submitting a change, run:

```sh
npm run verify
npm run build
```

Run the relevant [browser checks](docs/VERIFICATION.md) for rendering, weather, UI or multiplayer changes. A production build and Node checks cannot prove visual quality or GPU performance. Include the actual browser, adapter, drawing-buffer size, preset, weather, viewpoint and measurement method when making a performance claim.

Keep pull requests focused. Preserve vehicle tuning, collision coverage, asset fidelity and graphics settings unless those are the intended subject of the change. Use the existing JavaScript modules and verification tools before adding dependencies or abstractions. Match nearby formatting; avoid repository-wide formatting changes in a functional patch.

Do not commit `artifacts/`, build output, dependencies, saved benchmark baselines, credentials or original local level exports. Packed map parts, the asset manifest, runtime audit JSON and bundled asset notices belong in Git. Update the documentation when commands or behavior change, and keep historical measurements clearly identified as such.

When reporting a bug, include steps to reproduce, expected and observed behavior, browser/OS, vehicle, graphics settings and any useful console errors. A screenshot or short clip helps with visual problems. For a pull request, describe the problem, resulting behavior, checks run and remaining limitations.

New or replacement assets need a traceable source and explicit redistribution terms. Document them in [asset credits](docs/ASSET_CREDITS.md) and retain the required notices. The repository currently has no project-wide source license, and several existing asset terms remain unresolved; contribution guidance does not grant reuse rights.
