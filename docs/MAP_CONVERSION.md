# Baku map conversion notes

## Source inventory

The supplied `levels/baku` directory is a BeamNG level and identifies itself as a port of an Assetto Corsa track. It contains seven Collada scene files, 355 DDS textures, three WAV ambience files, BeamNG material and placement JSON, a dedicated collision mesh, a spawn point, and a 14-checkpoint closed race route.

The source is meter-scale, Z-up, and approximately 2.8 × 2.1 km across for collision coverage. The principal visual source includes surrounding/background geometry extending farther from the route. The circuit metadata states a 6.003 km lap.

## Conversion

A normal clone already contains the packed runtime assets. Regeneration requires
the separately obtained original source at `levels/baku`, Python 3.10+ and the
conversion packages:

```sh
python -m pip install trimesh pycollada Pillow numpy
npm run convert-map
npm run pack-assets
```

`pack-assets` verifies gzip round-tripping and writes parts below GitHub's
single-file limit. Its `--clean` option removes unpacked GLBs and intermediate
textures after packing; the npm script includes this option. Keep the manifest,
compressed parts, collision GLB and route JSON together in Git.
Route JSON uses LF line endings on every platform so its manifest byte count
matches fresh checkouts as well as local conversions.

The Elantra bundle can be rebuilt separately from an original showroom export:
`npm run extract-elantra -- /path/to/elantra.html`. This reads the supplied file
without modifying it; the showroom source is not included in the repository.

`scripts/convert_map.py` reads the source without modifying it. It:

1. Converts the principal circuit and buildings from Collada to GLB.
2. Preserves UVs and material groups, resolves the source's stale absolute texture references by filename, converts DDS textures to optimized 1024 px JPEGs or alpha-preserving PNGs, and embeds the resulting materials. Foliage receives a cutout threshold suited to its texture; road and marking textures use the source material's much lower alpha threshold.
3. Converts the supplied collision geometry separately for invisible, accelerated road-contact queries.
4. Extracts the original spawn and ordered checkpoints into `route.json`, and derives the starting heading from the first two checkpoints.
5. Writes measured output statistics to the local, ignored `artifacts/map-conversion/conversion-report.json`.

## Runtime environment preparation

Landmark details, independent room lights and tree shading are applied after the city audit and collision extraction. They do not rewrite the packed GLBs. [Government House](GOVERNMENT_HOUSE.md) derives its limestone/glass masks at startup and generates window surrounds and a simulated flag in code. [Foliage](FOLIAGE_LIGHTING.md) adds per-card crown coordinates before render partitioning, preserving the source vertices, indices and UVs.

The room-light atlas is a separate generated dependency. A normal clone includes both its image and metadata. After changing the packed facade textures or `scripts/windowAtlasProfiles.json`, regenerate them together:

```sh
npm run build-window-lighting
npm run verify-room-lights
npm run verify-room-lights-browser
```

The generator reads the packed assets directly; the original local level export is unnecessary. It writes `public/assets/environment/room-windows.png` and `src/windowLightingAtlas.json`. Review the glass masks and exclusions before accepting regenerated files. See [room lighting](ROOM_LIGHTS.md) for the audited regular-window placement and excluded glass walls.

## Preserved and pending

The conversion preserves circuit geometry, buildings, UV layout, most diffuse textures, source scale and orientation, collision geometry, spawn, and checkpoint order. The playable city loader then excludes the independently audited Formula 1 primitives without editing these original converted assets. See [the city map audit](CITY_MAP.md) for the removals, neutral curb finish and verification.

In the original event map, trackside fences and barriers supplement the supplied collision mesh. The city loader removes audited race boundaries, raised racing strips and both invisible event enclosures before colliders are registered. Ordinary road collision remains exact, and gaps exposed by race-strip deletion receive independent continuous asphalt support. Visible city facades provide spatially indexed wall collision; tree trunks use finite cylinders. See [the second cleanup report](CITY_CLEANUP.md). The existing boundary-collision implementation also remains available for original-asset regression checks.

Vehicle-body contact uses a swept, oriented box sized for the selected car. The continuous translation check prevents tunnelling through thin barriers, and bounded rotational sweeps protect the corners. Impacts remove velocity into the wall while retaining movement along it; sloping rail faces do not lift the car over the barrier. Actual openings remain open, and low curbs stay with the suspension/road system. This is an approximation of the vehicle body, not a deformation or damage simulation.

Fence and barrier meshes remain eligible for shadows even when the source batches span kilometres. Nearby shadow selection uses transformed mesh bounds rather than a maximum mesh radius. Alpha cutouts still control the fence's shadow silhouette.

Run `npm run verify-barriers` for side, corner, reverse, speed, sliding, rotation, opening, and transformed-mesh regression checks. The test also loads the packed track geometry without textures, checks shadows at spawn, verifies twelve sampled gaps in the original collision mesh, and simulates both cars driving into a wall on the real map.

Not yet integrated: secondary prop/lighting Collada files, original ambient audio, BeamNG-only sky/material effects, vehicle deformation/damage, and event rule logic. Material behavior is rebuilt as browser PBR; it is not a byte-for-byte reproduction of BeamNG shaders.

Asset ownership and redistribution terms were not included in the supplied level. The game is therefore presented as a local fan-made development project; do not redistribute the source or generated map assets until their reuse terms are confirmed.
