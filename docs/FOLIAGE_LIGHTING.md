# Foliage lighting

The map's `TREEC-material` uses crossed foliage cards with upward-facing canopy
normals. Some adjacent triangles have opposite winding despite sharing those
normals. Three's normal backface flip inverted the canopy lighting across a
triangle diagonal, causing bright/dark wedges. Grazing specular reflections also
made the cards look like reflective sheets instead of clusters of leaves.

`src/foliageLighting.js` keeps the authored canopy normal direction consistent on
both sides of TREEC cards. It preserves texture colors, imported normal variation,
standard diffuse lighting, environment lighting, fog, alpha cutouts and shadows.
The original geometry and shadow rendering are unchanged.

Only `TREEC-material` and `BAK_FEATURE_P_HEDGES_A_01-material` receive the leaf
highlight treatment: nonmetallic surfaces with dry roughness at least 0.85,
roughness at least 0.72 after weather adjustments, and specular reflectance scaled
to 0.3. Highlights remain present. Wetness darkening and snow coverage still work.
Hedges retain standard face-oriented normals; tree bases and decorative tree
lights retain their existing materials.

The patch is installed after weather shading and composes with static batching.
Shared materials are patched once. It adds no textures, geometry, draw calls or
per-frame work, and makes no global lighting or exposure changes.

Run `npm run verify-foliage` for the real-asset winding regression, shader
composition, weather transitions, preservation of texture colors and cutouts,
and checks that unrelated materials are untouched. The existing world graphics,
realism and performance checks also cover the surrounding rendering pipeline.
