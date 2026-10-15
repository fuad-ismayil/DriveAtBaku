# Government House

`src/governmentHouse.js` enhances the existing Hökumət Evi in place. The five
`bak_building_high_19_[af]_*` bindings in the **buildings** asset identify the
landmark. The separately named uppercase street/plaza material in **baku** is
not included. Original model vertices, indices, photographic textures, tower
proportions, open galleries, pinnacles, U-shaped courtyard, foundations, steps,
landscaping and neighboring streets remain in their authored locations.

The supplied nighttime reference guides the golden architectural wash. The
[building contractor's Government House project photographs](https://cbg.az/en/ongoing-projects/17/198)
and [front elevation photograph](https://commons.wikimedia.org/wiki/File:Governement_house_-_panoramio.jpg)
were used for visual comparison, including the central flagpole. Reference
photographs are not shipped as textures. This is an enhancement of the supplied
model, not a surveyed reconstruction or a claim that every architectural detail
has been independently measured.

## Materials and depth

Two runtime surface textures derive shallow limestone relief and neutral glass
masks from the existing atlases. Warm stone remains rough and nonmetallic;
subtle high-frequency bump detail follows its blocks, joints and carvings.
Cool grey panes receive darker interiors and restrained reflections. Brown
stone arch interiors are excluded from the glass treatment. All material hooks
compose with the existing weather and static batching shaders.

The atlas UV islands place **360** additional physical window surrounds on the
existing office facades. Negative and repeated UVs are respected. Projecting
sills, lintels and jambs add 17,280 triangles in one merged source mesh before
the normal spatial batching stage. Their positions follow the authored windows;
the model's large tower arches and columns already have real open geometry.
The centered flagpole sits on the existing front plinth. Its flag has a
procedural tricolor, crescent and eight-pointed star. Its original 7.2 × 3.6 m
fabric uses a 32 × 16 cloth grid, stepped at 120 Hz with gravity, aerodynamic
pressure, damping, structural/shear constraints and softer bending constraints.
Gentle gusts and traveling eddies vary the folds; the entire hoist stays pinned
to the original pole. Updated surface normals light the folds on both sides,
and conservative deformation bounds keep the moving fabric inside world culling.

## Night mode

Interior windows now use the city's [independent room activity](ROOM_LIGHTS.md).
The landmark's architectural wash remains steady while individual occupied rooms
occasionally turn on or off on their own schedules.

`setNightMode()` explicitly enables or disables the landmark's shared lighting
uniform and the flag/surround illumination. Architectural washes and occasional
interior window illumination are **zero in day mode**, including when loading
saved day settings or toggling back from night. They do not depend on rain,
overcast weather, headlights, or graphics quality.

At night, the textured wash emphasizes the three loggia tiers, columns,
cornices, main facade and retaining wall. It preserves the source atlas's dark
arch recesses and keeps horizontal roof surfaces out of the facade wash. This
uses bounded material lighting rather than adding hundreds of shadow-casting
lights. It does not illuminate nearby unrelated objects or simulate a full
light-transport solution. Existing sun shadows, AO, weather, tone mapping and
reflection rendering continue to operate.

The geometry is added after environmental collision extraction, before render
partitioning. It therefore preserves road contact, vehicle barriers, the minimap
and every existing collision surface. Extra visible meshes enter the usual
distance, shadow and reflection paths.

## Verification

```sh
npm run verify-government-house
npm run verify-flag-cloth
npm run verify-government-house-browser
```

The Node suite checks the actual landmark bindings, tiled atlas placement,
window geometry, unchanged source buffers and glass/stone classification.
Cloth checks cover pole attachment, unchanged UVs, fold lighting normals,
deformation bounds, local strain, a resumed tab and equal motion at 30/60/144 Hz.
The Chrome suite requires the normal local game server (`GAME_URL`, default
`http://127.0.0.1:5186`). It captures front, close, courtyard, rear, overview,
distant and flag views; advancing wind motion; day/night; three graphics presets;
overcast/rain/snow; and both multi-draw and fallback rendering. It checks day/night/day restoration,
occlusion equivalence, shader errors and resource stability during mode changes.
Screenshots and reports are saved in ignored `artifacts/government-house/`.
