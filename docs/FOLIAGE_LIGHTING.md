# Foliage lighting

The map's `TREEC-material` uses two crossed texture cards per tree. Their authored
normals point almost straight up, making whole cards respond like uniformly lit
sheets. Some adjacent triangles also have opposite winding. Three's normal
backface flip inverted lighting across their diagonal, causing bright/dark wedges.

`prepareFoliageGeometry` recovers connected cards before spatial partitioning and
adds a `foliageVolume` attribute: coordinates relative to that card's crown and its
normalized tree height. It uses the supplied asset's Y-up model space and crown
occupying the upper 68% of the texture. Each tree retains its own coordinate system
when its cards cross spatial chunk boundaries. Positions, normals, UVs, indices,
collision geometry and textures stay unchanged.

The canopy shader reconstructs a rounded front hemisphere per fragment, rather
than lighting the card as a plane. It preserves the winding correction, transforms
the crown directions into view space for street/reflection cameras, and blends
into the original normals below the crown. Nearly edge-on cards fade with the
prop distance fade's fixed 4×4 coverage pattern after the texture's alpha test.
Leaf colours remain opaque, avoiding translucent strips and whole leaf clusters
popping at an alpha-test cutoff. The facing card carries the silhouette without
a sharp strip through the crown's centre.

Normalized wrapped diffuse lighting softens the transition between sunlight and
shade, without increasing the sun-facing peak. It uses the shadowed incident light
and adds no emission. Lower foliage receives slightly less indirect sky lighting
(visibility 0.85–1.0), retaining the texture's fine leaf and branch shading. Global
lighting, exposure, fog and shadow rendering are unchanged.

Only `TREEC-material` and `BAK_FEATURE_P_HEDGES_A_01-material` receive the leaf
highlight treatment: nonmetallic surfaces with dry roughness at least 0.85,
roughness at least 0.72 after weather adjustments, and specular reflectance scaled
to 0.3. Highlights remain present. Wetness darkening and snow coverage still work.
Hedges retain standard face-oriented normals; tree bases and decorative tree
lights retain their existing materials.

The patch is installed after weather shading and composes with distance fades and
static batching. Weather uses the rounded normals for wetness and settled snow.
Shared geometry and materials are prepared once. The added attribute costs 16
bytes per source vertex (about 152 KiB for the supplied 9,752 vertices), plus the
existing partition/batch copies. There are no added triangles, textures, draw calls
or per-frame JavaScript updates; the extra shading runs on the GPU.

Run `npm run verify-foliage` for real-asset winding, card-relative coordinates,
both chunk sizes, batch data ownership, weather composition and preservation of
geometry/colors/cutouts. `npm run verify-foliage-browser` uses the running server
from [verification](VERIFICATION.md) to capture three street viewpoints, all quality
presets, five weather modes and day/night on both batching paths. Isolated real
tree cards also verify lighting depth, winding continuity and no glow without
incident light. Screenshots/results are written to `artifacts/foliage-volume/browser/`.
