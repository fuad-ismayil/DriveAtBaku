# Second city cleanup and environmental collisions

This records the second cleanup. The subsequent [asphalt and ground-contact
update](GROUND_SURFACES.md) completes the previously deferred road work and adds
continuous curb/terrain support. Use that report for current ground behavior.

At this development stage, the flat-gray road/texture problems were deferred
pending corrected locations. The later ground-surface update resolves that work.
This report covers event leftovers, invisible collisions, tree trunks and
building walls; its surface repairs cover gaps exposed by deleting race strips.

## What the screenshots revealed

The floating roof/stair/duct structures near the start belonged to three groups
in the main `baku` asset: `BAK_BUILDING_HIGH_18_C_01`,
`BAK_BUILDING_HIGH_18_C_02` and `BAK_ELECTRICAL_AC_D_01`. The first cleanup had
preserved them because their textures/material names were shared with ordinary
architecture. Isolated browser views confirmed their placement and structure.
Only these exact main-map groups are now excluded. The similarly textured real
buildings in the `buildings` asset remain unchanged.

The gray/white raised strips were the previously recolored racing curbs, not
ordinary city curbs. `RMBL`, `POLICE`, `sochi_saussage` and `ROADOR` are now
excluded entirely, along with the dedicated pit-line `ROAD_WHITELINE_A` overlay.
The city's `BAK_KERB_A`, `WHITELINE_A`, white/yellow lane markings, paving and
crossing material groups remain intact. No general white-material removal rule
is used.

The original `collision.dae` retained names that conversion had erased:

| Converted collision node | Original binding | Action |
| --- | --- | --- |
| colmesh-1-mesh_1 | RMBL | Remove race-strip contact |
| colmesh-1-mesh_3 | POLICE | Remove raised blocker contact |
| colmesh-1-mesh_4 | sochi_saussage | Remove racing curb contact |
| colmesh-1-mesh_5 | ROADOR | Remove raised racing pad contact |
| colmesh-1-mesh_6 | ghost | Remove pit/event enclosure |
| colmesh-2-mesh | ghost_001 | Remove the second invisible enclosure |

The second enclosure had 2,152 triangles, almost all vertical, spanning the
former circuit. It was missed in the first cleanup. Legitimate walls are now
represented by the visible city facades rather than an undocumented invisible
hull. Exact triangle counts, vertex counts, bounds and transforms for all six
removed collision nodes are recorded in `src/cityCollisionAudit.json`; a source
change that invalidates the audit stops loading.

There are now 217 audited visual event groups excluded. The packed map, source
DAEs and original texture files remain untouched and recoverable.

## Collisions and strip continuity

`src/cityCollisions.js` derives static collision data before render partitioning
can dispose staging geometry. Rendering, camera visibility and distance settings
therefore cannot remove physical walls or road contact.

- **Trees:** 1,219 narrow finite cylinders, one per crossed billboard pair. Bases
  come from the actual lower tree-card vertices, including sloping bases. The
  audited trunk alpha width sets the radius (0.08–0.45 m); height stays below the
  foliage (maximum 4.5 m). A static spatial index and continuous rounded-footprint
  queries prevent fast cars tunnelling through trunks. Canopies and branches have
  no collision geometry or bounding-box obstruction. There is no tree collider
  render mesh or per-tree BVH.
- **Buildings:** Actual opaque facade triangles and solid window/glass panels
  are used, rather than whole-building boxes that would block streets, courtyards
  or arches. Roofs, unrelated upper-story trim and alpha decoration cards are
  omitted from vehicle wall contact. Base panels retain their authored height.
  Coplanar edges are dissolved while preserving concave outlines and openings;
  non-manifold groups or groups failing an area check retain their source faces.
  Collision welding is limited to 0.1 mm; plane grouping is checked within 2 mm.
  The result has about 238,800 triangles from 246,799 selected facade triangles across
  201 material families, partitioned into 786 spatial collision meshes with
  independent BVHs. These meshes are never added to the render scene.
- **Road contact:** The seven surviving original collision meshes retain their
  original data. They have priority for tire contact, keeping normals, friction,
  rolling resistance and suspension behavior exact on existing roads. Removing
  `RMBL` exposes some holes below its former footprint. Only these unsupported
  triangles receive asphalt patches following adjacent authored road planes.
  Shared XY vertices receive one common height, preventing seams. The repair has
  1,621 triangles and an independent ground geometry copy. It adds no raised
  strip, global floor or unrelated road/texture replacement.

The raw surviving visual assets have 1,539,819 triangles; the repaired road
surfaces bring the playable scene to 1,541,440. Existing spatial render culling,
batching, lighting, weather and vehicle tuning are retained.

## Verification

`npm run verify-city-map` checks every surviving authored mesh, unchanged minimap
surfaces, all 14 route checkpoints plus spawn, both culling cell sizes and the
updated exclusion lists.

`npm run verify-city-collisions` verifies:

- All four cars against fast, rotated, stationary and reversing trunk contact;
  clear canopy space and passage above the finite trunk.
- Real contact at 12 tree locations and 16 wall locations for every car.
- A subdivided wall reduced from 120 to 6 triangles without closing its doorway.
- Eight passages through the old invisible enclosure for all four cars.
- Road contact at spawn and all checkpoints, 96 repaired-strip samples, shared
  repair-vertex continuity and four exact three-second vehicle trajectories.

`npm run verify-city-map-browser` exercises actual rendering in every quality
preset, weather, night, driving and occlusion. Set `CITY_MAP_FALLBACK=1` to include
the browser path without multi-draw. Occlusion-on/off images match exactly at
four views in each path.

`npm run verify-city-cleanup-browser` captures the pictured areas and measures
moving-camera Cinematic rendering. `CITY_CLEANUP_COMPARE=1` also loads the saved
previous city source from `artifacts/city-cleanup/baseline/src/`; save the complete
`src` directory there before changes when reproducing another baseline. Inputs,
frame count and measurement boundaries are identical.

For the connected-client check, start the local relay with `PORT=8788`, then set
`CITY_MULTIPLAYER_TEST=1`. Two isolated browser clients join the local relay; the
owning client drives into a real trunk and the observer verifies the resulting
position. Local static collisions use the same physics in single-player and
multiplayer. Remote cars retain the existing visual-only interpolation behavior;
the networking protocol and unrelated gameplay systems are unchanged.

Reports and before/after images are stored in `artifacts/city-cleanup/`.

## Measured follow-up results

Matched headless Chrome, Intel Iris Xe, 1280 × 720, full render distance,
Cinematic quality, 60 warm-up frames followed by exactly 180 moving-camera
frames. The prior city source and current source finish with identical vehicle
position and speed. Median measurements:

| Metric | Previous city | Updated city |
| --- | ---: | ---: |
| FPS | 35.6 | 37.2 |
| Frame interval | 28.1 ms | 26.9 ms |
| p95 frame interval | 37.6 ms | 33.7 ms |
| CPU frame submission | 15.8 ms | 15.3 ms |
| Static collision resolution | 0.20 ms | 0.20 ms |
| All-pass draw calls | 345 | 341 |
| All-pass triangles | 1,025,334 | 1,016,538 |
| Scene render objects | 424 | 417 |
| Spatial render chunks | 9,265 | 9,205 |

The new physical walls and trunks add no render draws. The one local road repair
adds rendering geometry, while excluded event leftovers reduce the overall
scene. Static collision resolution stayed at the prior median; its p95 was
0.4 → 0.5 ms. CPU culling varies with camera/view and measured 3.7 → 4.1 ms at the
median. These results establish no major runtime regression on this laptop;
the roughly 4.5% FPS gain is a sampled measurement, not a device-independent
guarantee. Collision construction takes about 1.5 seconds in the geometry test
and 3 seconds in the browser, once during loading with UI yields.

Two local multiplayer clients completed the connected collision check. The
owner registered 199 collision contacts while pressing forward against a real
trunk; the observer's final position differed by 0.51 mm. Both clients loaded the
same current map. No game exceptions or shader errors occurred. Final rendering
checks also passed all presets, rain/snow/night and both multi-draw paths, with
zero differing pixels in all eight occlusion comparisons.

The final production bundle also loads the 1,541,440-triangle scene and drives
without game or shader errors. Original generated assets have no Git changes.
The temporary multiplayer test relay was stopped after the two clients closed.
