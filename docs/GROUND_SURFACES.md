# Asphalt, curb continuity and terrain contact

This completes the road work previously deferred while locations were being
clarified. The original map assets remain unchanged; loading and collision
construction apply the corrections to the playable scene.

## Asphalt and street markings

The lighter Government House frontage is `BAK_OFFTRACK_B`, confirmed by actual
geometry queries in front of the building. Its bitmap was already a road texture,
but it was omitted from the regular asphalt shader classification. It therefore
kept different roughness, detail filtering and dry-road color behavior.

All five actual asphalt families now reference the existing `ROADA_MAIN` texture.
`BAK_OFFTRACK_B` receives the normal asphalt detail, matte roughness, dry charcoal
treatment and weather/reflection behavior. This corrects that gray family across
the entire map. UVs and geometry remain unchanged. Concrete, cobbles, pavement,
architecture and green-area textures are not recolored.

Isolated browser views confirmed that the bright circuit boundary/grid paint is
`WHITELINE_A` (17,134 triangles). It is excluded before render dependencies load.
The aged/faded `MARKINGS_A/B/C`, `BAK_ROAD_MARKINGS_A/B`, `ROAD_MARKINGS_C`, yellow
street lines and manhole artwork remain intact. There is no blanket removal of
white surfaces or traffic paint. Position/index accessors for removed racing
paint remain available for asphalt backing repair without loading its material
or texture. All 17,132 non-degenerate horizontal racing-line triangles were
checked for retained road support; vertical curb-side paint needs no new floor.

## Continuous ground contact

The previous collision builder used visible paving and terrain for wall-height
estimates, then discarded them. Its original collision export also omitted curb
and green-area families and some road inlays. That left wheel-contact holes even
where visible city surfaces existed.

The builder now registers 115,162 support triangles in 645 spatial collision
chunks. They cover real curb tops/ramps, missing pavement, concrete ground,
grass, dirt/landscape, planted bases and paving/grass strips. The data follows the
authored visible surfaces, independently of render culling or staging disposal.
It creates no canopy collision, global floor or additional ground render draws.

Nearest support wins when a real curb/green surface is above a lower source
floor; original contact wins numerical ties. Asphalt/paving retains the existing
friction and rolling resistance. Grass/soil uses the existing terrain values
(`mu=0.65`, `rr=0.045`). Vehicle tuning, handling equations and suspension remain
unchanged.

Some yellow paint and manhole/inlay geometry fills actual road cutouts. Its
collision backing is now included. Where ordinary paint floats above an existing
road, its physical vertices follow that backing instead of creating a paint
speed bump.

The boundary audit also stitches 55 uncovered narrow seams using 110 collision
triangles. Only overlapping, nearly parallel road/curb/pavement boundaries are
eligible: at most 0.5 m apart and with no more than 0.25 m height difference.
Already supported spaces are skipped. Endpoints use the adjacent surfaces'
actual heights, so this does not flatten curbs or bridge large spaces. These
small supports are physical only. Collision preparation yields to the loading
screen during large scans.

## Verification

`npm run verify-ground-surfaces` verifies every support-triangle interior,
19,280 points across 80 real road/curb/sidewalk corridors, 48 five-second slow
approaches covering all four cars, and four actual green areas with every car.
All slow approaches retained wheel contact for all 600 physics ticks; no car
fell below a curb or through grass. It also checks common asphalt bindings,
matte asphalt classification, preserved faded markings and removed-line backing.
Results are in `artifacts/ground-surfaces/verification.json`.

The city-map, city-collision, handling, performance-invariant and realism checks
also pass: original minimap surfaces, spawn/all checkpoints, exact unobstructed
vehicle trajectories, trunk/wall contact and shader composition remain valid.
Actual browser rendering passes all graphics presets, rain/snow/night, both
multi-draw paths and eight pixel-identical occlusion comparisons.

For the same-view browser comparison, use `npm run verify-city-cleanup-browser`
with `CITY_CLEANUP_COMPARE=1`,
`CITY_CLEANUP_BASELINE=artifacts/ground-surfaces/baseline/src` and
`CITY_CLEANUP_OUTPUT=artifacts/ground-surfaces/browser`. The baseline is the
complete source saved before this update. The matched Cinematic drive measured
38.5 → 38.6 FPS, 14.0 → 14.2 ms CPU submission and 341 → 340 all-pass draw calls.
The final vehicle position and speed match exactly. These measurements show
comparable runtime performance on the Intel Iris Xe test laptop, not a general
FPS guarantee.

The connected two-client multiplayer check passes with the same ground and
collision data: the owner stops at a real trunk and the observer receives its
position within 0.51 mm. The production bundle loads and drives without game or
shader errors. Ground preparation is performed once during loading (about
7.3 seconds for the browser's complete collision construction in this run), with
UI yields; driving does not repeat those scans. Original generated map files
have no Git differences.
