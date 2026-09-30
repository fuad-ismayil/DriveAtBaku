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

Not yet integrated: secondary prop/lighting Collada files, original ambient audio, BeamNG-only sky/material effects, full vehicle-body collision response, detailed suspension dynamics, and event rule logic. Material behavior is rebuilt as browser PBR; it is not a byte-for-byte reproduction of BeamNG shaders.

Asset ownership and redistribution terms were not included in the supplied level. The game is therefore presented as a local fan-made development project; do not redistribute the source or generated map assets until their reuse terms are confirmed.
