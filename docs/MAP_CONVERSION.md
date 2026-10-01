# Baku map conversion notes

## Source inventory

The supplied `levels/baku` directory is a BeamNG level and identifies itself as a port of an Assetto Corsa track. It contains seven Collada scene files, 355 DDS textures, three WAV ambience files, BeamNG material and placement JSON, a dedicated collision mesh, a spawn point, and a 14-checkpoint closed race route.

The source is meter-scale, Z-up, and approximately 2.8 × 2.1 km across for collision coverage. The principal visual source includes surrounding/background geometry extending farther from the route. The circuit metadata states a 6.003 km lap.

## Conversion

`scripts/convert_map.py` reads the source without modifying it. It:

1. Converts the principal circuit and buildings from Collada to GLB.
2. Preserves UVs and material groups, resolves the source's stale absolute texture references by filename, converts DDS textures to optimized 1024 px JPEGs or alpha-preserving PNGs, and embeds the resulting materials. Foliage receives a cutout threshold suited to its texture; road and marking textures use the source material's much lower alpha threshold.
3. Converts the supplied collision geometry separately for invisible, accelerated road-contact queries.
4. Extracts the original spawn and ordered checkpoints into `route.json`, and derives the starting heading from the first two checkpoints.
5. Writes measured output statistics to `conversion-report.json`.

## Preserved and pending

Preserved now: circuit geometry, buildings, UV layout, most diffuse textures, source scale and orientation, collision geometry, spawn, and checkpoint order.

Trackside fences and barriers use their visible geometry to supplement the supplied collision mesh at runtime. The boundary families include `FENCE`, `BARRIER`, `PITWALL`, `ARMCO`, `TWALL`, `CMWL`/`CMWLA`, and concrete bollards. These static meshes get accelerated triangle queries without changing the visual index order or requiring a map reconversion. Wheel/road queries still use the original collision mesh.

Vehicle-body contact uses a swept, oriented box sized for the selected car. The continuous translation check prevents tunnelling through thin barriers, and bounded rotational sweeps protect the corners. Impacts remove velocity into the wall while retaining movement along it; sloping rail faces do not lift the car over the barrier. Actual openings remain open, and low curbs stay with the suspension/road system. This is an approximation of the vehicle body, not a deformation or damage simulation.

Fence and barrier meshes remain eligible for shadows even when the source batches span kilometres. Nearby shadow selection uses transformed mesh bounds rather than a maximum mesh radius. Alpha cutouts still control the fence's shadow silhouette.

Run `npm run verify-barriers` for side, corner, reverse, speed, sliding, rotation, opening, and transformed-mesh regression checks. The test also loads the packed track geometry without textures, checks shadows at spawn, verifies twelve sampled gaps in the original collision mesh, and simulates both cars driving into a wall on the real map.

Not yet integrated: secondary prop/lighting Collada files, original ambient audio, BeamNG-only sky/material effects, vehicle deformation/damage, and event rule logic. Material behavior is rebuilt as browser PBR; it is not a byte-for-byte reproduction of BeamNG shaders.

Asset ownership and redistribution terms were not included in the supplied level. The game is therefore presented as a local fan-made development project; do not redistribute the source or generated map assets until their reuse terms are confirmed.
