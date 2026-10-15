# Independent nighttime rooms

The city has about 48,500 individually scheduled room lights across 138 facade
material bindings in the supplied map. Roughly one third start illuminated.
`roomLightActivity.js` assigns each room its own random stream, current state,
fade and next event. A room switching off changes only that room. There is no
fixed count of illuminated windows, replacement rule, shared activity interval
or repeating global cycle. Offscreen rooms continue on their own schedules.

After startup, occupied rooms stay on for at least 75 seconds, plus an
exponentially distributed wait averaging 345 seconds. Dark rooms stay off for
at least 90 seconds, plus an exponential wait averaging 750 seconds. Long,
unequal dwell times keep activity subtle; individual fades take 0.65–1.9 seconds.
Startup uses independently sampled residual waits, so a whole city does not
wait through the same initial timeout. The average durations are seven minutes
on and fourteen minutes off, rather than a periodic seven/fourteen-minute cycle.

Day mode hides all room-light geometry and pauses its activity clock. Returning
to night resumes the existing independent room states and remaining waits.
Weather and graphics quality do not change occupancy or timing. Activity is a
local visual effect and is not replicated over multiplayer.

## Actual window placement

`scripts/windowAtlasProfiles.json` restricts glass detection to visually audited
facade regions. The generator reads packed map textures, identifies panes,
groups panes separated by narrow mullions into rooms, and retains the dark
mullions in a padded mask atlas. Only regular windows are included; continuous
glass walls and curtain-wall room grids are excluded. Mixed atlases restrict
lighting to their separate conventional windows. Material aliases with
identical source-image hashes share layouts.
The tower in the supplied reference retains its curved side-window lighting;
its central glass panel is excluded by its separate authored UV band, even
though both sections share one material and texture.
These are inferred visual rooms, not surveyed architectural interiors.

`roomLights.js` projects those windows through the original UV islands, including
negative and repeated UVs, and clips light surfaces against the actual source
triangles. Pieces crossing a triangle seam share a physical room ID; another
building reusing the same atlas receives its own independent IDs. Light geometry
sits just above the glass and retains depth testing, so walls, balcony rails,
columns and trees can occlude it. The original map geometry, textures and
collision surfaces are unchanged.

The mask atlas is generated from existing map artwork; no external photographs
or remote assets are added. The supplied Government House architectural wash
remains separate. Its old static interior-window selection and the old blanket
emission on generic window materials are replaced by this room system.

## Rendering and regeneration

Window surfaces add 164,860 triangles and reuse normal spatial culling, scene
fog and reflection rendering. They add no point lights or shadow maps. A single
float state texture stores transition endpoints/times; ordinary changes upload
only the affected texels. A priority queue processes due room events instead of
scanning every room each frame. Daytime hides the entire room-light group.

```sh
npm run build-window-lighting
npm run verify-room-lights
npm run verify-room-lights-browser
```

Regeneration reads the committed packed map files and writes
`src/windowLightingAtlas.json` and `public/assets/environment/room-windows.png`.
The current generator emits 57 source-atlas layouts, 139 material bindings and
1,678 window templates. City filtering leaves 138 of those facade bindings in
the runtime room geometry. Regenerating the current inputs reproduces both
generated files byte for byte.
When source atlases change, review the profiles and generated masks visually
before accepting regeneration. The existing map's asset terms continue to apply.

The Node suite checks independent streams, an off event without any replacement,
soft fades, sparse activity, day gating, clipped room IDs and original source
buffer preservation. The direct geometry fixture produces 48,465 room IDs; the
Chrome-loaded scene produces 48,462. Both contain 164,860 light-surface triangles
across 138 facade bindings. The Chrome suite compares actual lit/unlit pixels and a
ten-minute activity advance, checks day mode, all presets, rain/snow, both
multi-draw and fallback rendering, shader errors and stable resource counts.
It needs the normal development server (`GAME_URL`, default port 5186).
Screenshots and results stay in ignored `artifacts/room-lights/browser/`.
