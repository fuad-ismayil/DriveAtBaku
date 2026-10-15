# Everyday Baku map

This records the **initial cleanup and its before/after measurements**. The
current [second cleanup and environmental collisions](CITY_CLEANUP.md) supersedes
its treatment of race curbs, floating structure groups and the second invisible
enclosure. Use that report for current collision counts and verification.

The game now loads the supplied map as city streets without the Formula 1 event.
The original source level and packed GLBs remain unchanged and recoverable.

Later [Government House details](GOVERNMENT_HOUSE.md), [independent room lights](ROOM_LIGHTS.md) and [tree shading](FOLIAGE_LIGHTING.md) run after the source audit. Their added rendering work is outside the historical geometry and performance comparisons below.

## Asset and rendering audit

The engine is Three.js r180 with WebGL2 and three-mesh-bvh. The loader downloads
and inflates the multipart gzip assets described by `asset-manifest.json`, then
uses GLTFLoader. The source is meter-scale, Z-up after each GLB node's authored
transform; editing local coordinates without that transform would misalign the
road, car, physics and minimap.

The supplied Collada files contain material-grouped geometry rather than a
separate object for each building or prop. Their conversion produces:

| Asset | Original material meshes | Original triangles | City meshes | City triangles |
| --- | ---: | ---: | ---: | ---: |
| baku | 263 | 1,182,806 | 58 | 362,775 |
| buildings | 370 | 1,202,598 | 366 | 1,200,187 |
| collision | 13 | 167,361 | 12 | 167,331 |

The visual map retains 1,562,962 triangles: 822,442 event triangles are excluded,
a 34.5% reduction. No surviving visual triangle is simplified or moved.

The audit used the original DAE material-to-texture bindings, diffuse texture
inspection, UV ranges, geometry extents and the existing collision/minimap
classifiers. The exact approved materials and their triangle counts are recorded
in `src/cityMapAudit.json`. They include concrete safety walls, catch fencing,
Armco, sponsor boards and supporting frames, grandstands, gantries, starting and
marshal lights, DRS/braking markers, timing screens, race/pit decals, pit garages,
team boxes, their interior lamps/monitors, vehicle lifts and temporary paddock
media/medical buildings. The four removed groups in `buildings` belong to these
temporary paddock buildings, not the ordinary city buildings.

Several misleading names needed special inspection:

- Numbered `ROADA_*` groups are three-dimensional team garage equipment, not road
  surfaces. Their footprints, height, textures and existing minimap exclusion
  confirm this. `ROADA_MAIN`, `ROAD_AZER` and both off-track road groups stay.
- Generic `LIGHTS`, `MONITOR`, `BOX`, `DECALS` groups belong to the matching team
  boxes. Their exact material names are scoped to `baku`; there is no rule that
  removes an arbitrary city lamp, sign or box.
- `SILVER`/`BLDGPC2` are sponsor board supports. `ALUMINIO`/`METAL` match the
  electronic marshal/safety-car signs. `_85`, `_93` through `_97` use the camera
  stand/scaffold texture set and match the event camera/timing structures.
- `SIN_TRACK_DECALS_A` uses the grid/number/finish-line portions of its atlas on
  the starting straight. It does not use the ordinary direction-arrow portion.
  Separate city white/yellow lines and road markings are preserved.
- The `ghost` visual mesh and `colmesh-1-mesh_6` collision mesh have identical
  positions, indices and transforms. They form an event enclosure rather than
  a road surface. Its 30 collision triangles are excluded too, with runtime
  vertex-count, bounds and transform checks protecting its identity.
- `RMBL`, `sochi_saussage`, `POLICE` and `ROADOR` are race-painted road-edge
  surfaces. Their profiles and collision remain exactly as authored, to obey
  the road-elevation preservation requirement. A composable material patch
  neutralizes their racing colors while retaining texture wear, alpha, UVs and
  lighting. The ordinary `BAK_KERB_A` texture remains unchanged.
- `ROAD_AZER` is flag-colored racing runoff. Its triangles and road contacts stay
  intact; its texture binding reuses the existing `ROADA_MAIN` asphalt texture.
  This removes the event paint without changing any texture file or street UVs.

Trees, hedges, ordinary architecture, pavement, manholes, markings, electrical
equipment, existing lighting and the unbranded decorative city bunting stay.
Secondary source Collada prop/light/flag files were already absent from the
game's loading pipeline; this change does not introduce or remove those files.

## Safe implementation

`src/cityMap.js` installs a GLTFLoader plugin for the three map assets only.
Its `beforeRoot` hook excludes approved primitives before scene dependencies
are loaded. Event textures and meshes therefore never become renderer resources,
shadow candidates, reflection objects, facade occluders or supplemental vehicle
colliders. Removing only their main-camera visibility would leave incorrect
shadows/reflections and invisible collisions; the loader exclusion avoids that.

This operates on each loader's in-memory JSON. It does not edit a GLB, source DAE,
texture file, accessor, vertex buffer, road index or transform. The one runoff
texture binding and the four curb material patches affect event paint only. A mixed/shared mesh
retains its ordinary primitives. Triangle-count mismatches stop loading with an
audit error instead of silently applying an outdated removal list. New map
versions must be inspected and their allowlist updated.

Blender is unnecessary for this version: the event surfaces are already
independently addressable. If a future asset combines city and event faces in one
primitive or bakes sponsor art into an ordinary facade texture, that asset needs
a new face/UV audit. Safest external editing would use a duplicate source,
separate the verified event faces by material/connected component, retain all
city vertices/UVs/normals/transforms, export to a separate GLB, and compare both
visual and collision data before replacing a packed asset.

Download size remains unchanged because the original packed assets are kept.
Offline repacking could reduce download size, but would create large binary
changes; it is not required for the rendering and scene improvements here.

## Culling decision

The existing optimizer already partitions oversized material meshes into spatial
cells: 96 m when WEBGL_multi_draw is available, 256 m otherwise. It retains whole
triangles across cell boundaries and computes bounds including overhangs. Small
meshes stay intact. Opaque/cutout chunks share material BatchedMeshes; spatial
chunks are independently culled without becoming thousands of separate scene
objects. Transparent materials retain the existing individual-mesh path.

Frustum rejection uses a spatial hierarchy and tight chunk boxes. Occlusion uses
actual large opaque vertical facade triangles, conservative projection margins,
and all eight target-box corners. Openings, cutouts, transparency and near-plane
uncertainty fail open. Main-camera rejection is independent of sun-shadow and
reflection cameras. Backface culling is limited to eligible opaque solid
materials whose complete triangle winding agrees with their normals. Intentional
double-sided surfaces are retained.

This structure is already appropriate for the actual engine and map. There is
no benefit demonstrated for splitting every tree/building into a new scene
object, changing chunk sizes, adding asynchronous GPU occlusion queries or
reducing visual quality. This change reuses the proven culling/batching paths
with a smaller city inventory. CPU facade occlusion is conservative and does not
guarantee rejection of every hidden surface; uncertainty remains visible.

Three.js documents material batching and per-instance culling in
[BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html). This project also
maintains camera-specific chunk visibility for its shadows and reflections.

## Verification and reproduction

### Measured results, 11 October 2026

Headless Chrome, Intel Iris Xe, Direct3D11, 1280 × 720, pixel ratio 1, full
6,000 m world / 3,000 m props distance. Each case warms for 60 frames and samples
180 frames. All settings and the 3-second driving input are matched; the before
and city car positions and velocities were identical after driving.

| Matched case | FPS before → city | Median frame ms | CPU submission ms | GPU ms | All-pass draws | All-pass triangles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Start, Performance | 94.3 → 95.2 | 10.6 → 10.5 | 5.7 → 3.9 | 9.20 → 9.43 | 327 → 238 | 861,709 → 712,176 |
| Start, Balanced | 57.8 → 58.8 | 17.3 → 17.0 | 6.5 → 4.5 | 16.14 → 15.80 | 348 → 259 | 861,730 → 712,197 |
| Start, Cinematic | 49.5 → 49.0 | 20.2 → 20.4 | 6.5 → 4.7 | 19.09 → 19.21 | 348 → 259 | 861,730 → 712,197 |
| Checkpoint 6, Performance | 92.6 → 90.9 | 10.8 → 11.0 | 4.6 → 3.6 | 9.69 → 9.62 | 259 → 213 | 819,281 → 722,409 |
| Checkpoint 6, Cinematic | 49.3 → 47.8 | 20.3 → 20.9 | 5.3 → 4.5 | 19.23 → 19.61 | 280 → 234 | 819,302 → 722,430 |
| Driving, Cinematic | 32.4 → 37.0 | 30.9 → 27.0 | 15.6 → 12.2 | 29.64 → 25.76 | 482 → 345 | 1,246,378 → 1,025,342 |

Driving improves measured median FPS by 14.4%, with 28.4% fewer draws and 22%
less CPU submission time. Moving-camera culling falls from 5.1 to 4.1 ms; p95
frame interval falls from 41.2 to 37.8 ms. Fixed-view FPS is broadly similar and
does not show a consistent improvement: these cases remain mainly limited by
GPU shading/post-processing and run-to-run variation. No general FPS guarantee
is implied by the geometry reduction.

Scene render objects fall from 633 to 424 and material batches from 321 to 209.
The 96 m path has 9,265 culling chunks, down from 10,480; the 256 m fallback has
2,722 chunks, down from 3,538. These chunks are batch metadata rather than one
scene object per chunk. The fallback also passes actual Chrome rendering and
reports 96.2 FPS at the Performance start view and 50.0 FPS at the Cinematic
checkpoint 6 view, without comparing those figures to a fallback baseline.

Occlusion-on and occlusion-off images match **exactly, with zero differing
pixels**, at four views in each rendering path. The fine path rejects 225–1,476
occluded chunks in those screenshots. Rain, snow, night, normal driving and all
quality presets complete without game exceptions or shader errors. Surviving
city geometry, materials except the identified event paint, and minimap data
are verified against the original assets.

The final production bundle also loads the 1,562,962-triangle city map and drives
successfully with no game or shader errors; the production smoke report is saved
to `artifacts/city-map/production.json`. The build passes with Vite's existing
large-JavaScript-chunk advisory. All original `public/generated` assets have no
Git differences.

### Commands and recovery

Run `npm run verify-city-map`. It verifies unchanged positions, indices, normals,
UVs and transforms for **every surviving mesh**, identical minimap surfaces,
identical ground contacts at spawn and all 14 checkpoints, the exact removed
collision enclosure, eight real fence passages for all four vehicles, and 28
route/cell-size culling combinations. Results are in
`artifacts/city-map/verification.json`.

With `npm run dev` running, `npm run verify-city-map-browser` measures the actual
game at 1280 × 720 with full render/prop distances, checks all three quality
presets, compares occlusion on/off pixels at four viewpoints, checks weather and
night rendering and drives the real car. Set `CITY_MAP_FALLBACK=1` to also verify
the browser path without WEBGL_multi_draw. Results and screenshots are in
`artifacts/city-map/browser/`.

For a repeatable before/after comparison, run with `CITY_MAP_COMPARE=1`. The test
disables only the city loader plugin in the baseline browser response, restoring
the original event map. Source files and geometry assets are identical in both
runs. GPU timings use disjoint timer queries when
available. Draw/triangle counts include all rendering passes; FPS uses measured
frame intervals, not CPU submission time. These sampled measurements do not
represent every driving situation or device.

The existing minimap, handling, camera, world-graphics and performance invariant
checks also pass. Their raw-asset fixtures intentionally remain available for
checking the original source independently of the city loader.

To restore the event map for asset inspection, remove the city plugin registration
from the loader (or restore the earlier loader from Git). No asset reconversion
or download is needed. The normal game always loads the city version.
