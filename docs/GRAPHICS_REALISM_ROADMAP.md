# DriveAtBAku: practical graphics realism roadmap

Research date: 1 October 2026. Target: a powerful gaming PC, with visual quality prioritized. The audit below records the research baseline and installed Three.js 0.180.0. The first implementation package is now in the working tree; its status and limits are recorded here. Earlier lighting work is described separately in [GRAPHICS_RESEARCH.md](C:/Users/Fuad/Desktop/DriveAtBaku/docs/GRAPHICS_RESEARCH.md).

## First implementation package

Implemented on 1 October 2026:

- **Spatial frustum culling and material batching:** large visual primitives are divided by triangle centroid into 96 m cells, retaining whole triangles and tight bounds. On GPUs with `WEBGL_multi_draw`, compatible opaque chunks remain inside a material `BatchedMesh`. Other GPUs use 256 m cells and regular meshes. Native frustum culling remains independent for shadows and each reflection face; the sky remains exempt. Static city transforms are frozen after preparation.
- **Conservative occlusion:** actual opaque vertical facade triangles are indexed spatially. At most 48 large projected faces near the camera are considered after frustum rejection. A chunk is hidden only when all eight corners of its world box are strictly inside one face's projected silhouette and strictly behind its plane. Near-plane intersections, edges, uncertain cases, cutouts, transparent surfaces, and culled facade sides remain visible. Mirrored transforms follow WebGL's effective front-face orientation. Decisions use the current camera every frame. Main-view rejection never globally hides shadow casters or reflection geometry.
- **Selective backface culling:** eligible opaque road, pavement, and building families require every nondegenerate triangle's winding to agree with the authored normals. Fences, foliage, banners, glass, and alpha cutouts keep their original sides. Thin supplied facades retain double-sided shadow casting.
- **Surface detail:** the actual asphalt and pavement families share a seamless 256-pixel data texture for fine normal, roughness, and subtle color variation, sampled in world metres. Mipmaps and anisotropy limit distant shimmer. Existing color maps and UVs remain intact; advertisements, road markings, and similarly named garage materials are excluded. This is a material pilot, not a full replacement of the source textures.
- **Building shadows:** the old 85 m source-batch exclusion is removed. Local chunk bounds drive nearby caster selection, now within 150 m of the car. The sun covers a 200 m square with snapped positioning. Performance/Balanced/Cinematic use 1024/2048/4096-pixel shadow maps. The ineffective PCFSoft `shadow.radius` setting is removed. Cascades and contact-shadow improvements remain future work.
- **Local car reflections:** paint and smooth physical materials receive a filtered cubemap of the local city. Balanced captures at 128 pixels per face; Cinematic uses 256. One face renders per frame, and materials receive the map only after all six faces are complete. Captures omit the vehicles, reuse sun shadows, and restore renderer/visibility state. Completed maps are reused until movement warrants an update; car changes, teleports, and day/night changes invalidate them. Garage lighting keeps its dedicated environment. Performance and contexts without floating-point render targets use the existing sky environment. Switching quality releases capture and filter resources.
- **Antialiasing and preparation:** Cinematic uses SMAA before output conversion and allows pixel ratio up to 2. Balanced retains FXAA after output conversion. Performance releases the post-processing targets and passes. Shader preparation runs before the loading screen closes. Fresh settings default to Cinematic for the requested PC target; saved quality choices are respected.
- **Opt-in diagnostics:** `?graphicsDebug=1` displays geometry/culling, all-pass draw counts, reflection captures, frame intervals and CPU submission time. `&occlusion=off` bypasses occlusion for comparison. Candidate triangle counts are conservative visibility estimates before native per-object sphere tests; they are not measured GPU submissions or GPU time.

The first occlusion implementation deliberately uses current-camera geometric proofs instead of asynchronous GPU query results. It needs no depth readback, query pass, or delayed visibility state. It may miss opportunities where several small faces together cover a chunk; those chunks remain visible. GPU-query experiments remain a later profiling option if the CPU cost or missed opportunities justify them.

### Validation and remaining acceptance work

`npm run verify-world-graphics` checks the packed map, preserving all **2,385,404 triangles**, their authored normals, UVs, winding and world transforms in both cell-size paths. The multi-draw path contains **10,480 culling chunks in 633 render objects**, including 321 material batches; the regular-mesh fallback contains 3,538 chunks. The fixture identifies 127 opaque materials eligible for backface culling, and 115 nearby shadow chunks at spawn. Synthetic checks cover actual openings, near-plane/edge cases, mirrored/back-facing facades, camera turns, independent shadow/reflection visibility, and collision with hidden render geometry. Reflection tests cover partial-capture isolation, six-frame publication, caching, teleport/night invalidation, garage fallback, quality changes and renderer-state cleanup.

Across 14 sampled route views, the original mesh-frustum estimate was approximately **1.29–2.25 million triangles**; the new conservative main-view candidate estimate is approximately **0.31–1.95 million**. Occlusion rejected up to 2,025 chunks in a sampled view. This is a CPU geometry comparison, not an FPS claim. Timing results in the local [verification report](C:/Users/Fuad/Desktop/DriveAtBaku/artifacts/world-graphics-verification.json) include startup/JIT/GC effects and are not a target-PC benchmark.

Production build and all eight verification suites pass. **Browser verification succeeded on retry on 1 October 2026:** both cars were inspected by day and night at all 14 authored route checkpoints. All 56 fixed-view occlusion-on/off comparisons were pixel-identical outside the changing diagnostics and toast areas. Runtime inspection confirmed local reflections, the actual 4096-pixel Cinematic shadow target, and stable renderer resource counts across three quality cycles. No rendering errors appeared; Balanced retains the previously observed FXAA compiler warnings. See [the browser verification report](GRAPHICS_BROWSER_VERIFICATION.md) for screenshots, methodology, and timing evidence. The screenshots later in this roadmap still show the research baseline.

GPU timing is now measured on **Intel Iris Xe at 1280 × 720, pixel ratio 1**, with 120-frame samples. The initial Cinematic day sample measured 22.25 ms median GPU elapsed time and a 24.24 ms mean frame interval, below a 60 FPS target. In short controlled spawn and narrow-street comparisons, occlusion's CPU overhead outweighed any GPU saving. These are sampled local results, not performance acceptance for a powerful dedicated GPU: a native-resolution target-PC benchmark, repeated on/off comparisons, sustained driving, and longer stutter/resource checks remain outstanding.

Street fixtures/night-light tuning, texture-resolution recovery, asset compression, AO with correct alpha-cutout handling, cascaded shadows, contact shadows, and reflection parallax correction remain subsequent roadmap phases.

## Recommendation

Implement two connected tracks: **visibility and rendering optimization**, and **visual realism**. Make frustum, occlusion, and selective backface culling explicit implementation requirements. Start visual work with physically based road and pavement materials, reliable building shadows, local vehicle reflections, and street lighting. These changes address the visible causes of the game's flat surfaces and disconnected car highlights. Use ambient occlusion and improved antialiasing to support them. Keep stronger bloom, motion blur, and depth of field for optional presentation settings.

The requested scope also includes more realistic lighting, better post-processing, more natural shadows, improved material shaders, more accurate reflections, and rendering improvements that preserve the intended image. Optimization savings should create headroom for those improvements, while keeping geometry, shadow, and reflection visibility correct.

The current WebGL renderer can support this direction. An engine migration is not a prerequisite.

## Research baseline

The audit includes the renderer, car materials, sky, map converter, packed GLB metadata, source texture headers, and a live browser inspection of the starting straight by day and night. Runtime frame rate, GPU time, and full-route visual quality were not benchmarked.

| Observed fact | Implication |
| --- | --- |
| Sky-based day/night PMREM reflections, linear HDR effects, ACES tone mapping, bloom, anisotropic texture filtering, and quality presets already exist. | The next major improvements should change material response and lighting coverage. |
| Three.js r180 enables mesh frustum culling by default; the game explicitly exempts the sky. The map has no dedicated occlusion-culling implementation. | Improve the granularity of existing frustum rejection and add occlusion testing, rather than claiming all culling is absent. |
| The two visual GLBs contain 2,385,404 triangles and 633 material primitives. | Extra geometry passes need a measured budget. This inventory is not the number of triangles or draw calls visible each frame. |
| All 633 map materials have color textures; none has a normal, metallic/roughness, or occlusion texture. Vertex normals exist in all primitives. | Surface relief and varied highlights require new material maps, rather than a wholesale vertex-normal repair. |
| Every exported map material starts at roughness 0.82; runtime code adjusts a few name-based families. | Asphalt, stone, painted metal, glass, and concrete need explicit material definitions. |
| All 633 materials are double-sided; 201 use alpha cutouts. | Optimize backfaces selectively and preserve cutout silhouettes in shadows and effects. |
| Conversion caps textures at 1024 pixels on their longest edge. Of 351 source DDS textures, 119 exceed that cap; source dimensions reach 4096. | Some sharper textures can be recovered from the originals. Upscaling small originals adds no actual detail. |
| Map downloads total about 205.7 MiB compressed and expand to 287.5 MiB of GLB data, excluding cars and collision. | Improve asset delivery before adding large texture sets or every omitted prop. These are file sizes, not GPU memory measurements. |
| Repeated image references already share binary buffer views inside each GLB. The two files use 144 and 121 image views, with 248 distinct image hashes across both. | Avoid promising large savings from simply deduplicating image references. Compression, geometry optimization, and selective texture resolution are better candidates. |
| The shadow selector excludes non-boundary meshes whose bounding-box half-diagonal is at least 85 m. Eighty building-named primitives in the buildings GLB meet this exclusion. | Large building batches can miss shadow eligibility even when part of them is near the car. |
| Street lamps, additional props, flags, and extras have source Collada files but are absent from the visual conversion. Source tire-mark roads also exist. | The level has detail worth evaluating before commissioning replacements. |
| Both headlights use unshadowed spotlights and falloff settings below inverse square. | Their illumination cannot currently be blocked by walls or barriers. |

Baseline day view:

![Current day graphics at the starting straight](C:/Users/Fuad/Desktop/DriveAtBaku/artifacts/research-current-day.png)

Baseline night view with low beams:

![Current night graphics with low beams](C:/Users/Fuad/Desktop/DriveAtBaku/artifacts/research-current-night.png)

## Required optimization track

These optimizations support the visual work. The initial package above implements spatial visibility, conservative geometric occlusion, selective sides, batching and static transforms. The recommendations below also include later alternatives and extensions. Measure the CPU/GPU work saved against the cost of deciding what to skip.

### Frustum culling: make the existing checks useful

Three.js already tests renderable mesh bounds against the active camera frustum. A material batch spread across the city can intersect that frustum even when most of its triangles are outside the view. Split visual geometry into spatial cells with tight bounding boxes/spheres, then batch compatible objects within those cells. Test cell sizes against the tradeoff between tighter rejection and additional draw calls. Keep the camera-centered sky exempt. [Object3D](https://threejs.org/docs/pages/Object3D.html)

Use bounds that include any shader displacement or animation. Run the appropriate visibility test for each view: the driving camera, garage camera, each shadow cascade, and each reflection-capture face. Main-camera visibility must not suppress an off-camera building's shadow or its appearance in car reflections.

For compatible static geometry, evaluate `BatchedMesh` with per-object frustum culling; use instancing for repeated geometry. Verify the installed r180 API and draw-call behavior on the target browser instead of assuming multi-draw support or combining arbitrary material arrays. [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)

### Occlusion culling: skip geometry behind buildings

Implement a conservative system at cell/building-group granularity, after frustum rejection. Use opaque, validated building/wall surfaces as occluders; fences, leaves, glass, and other surfaces with holes must not become solid blockers. An occluder proxy must stay within the actual solid silhouette, while bounds tested for visibility should conservatively cover their geometry.

For the current WebGL2 renderer, evaluate asynchronous `ANY_SAMPLES_PASSED_CONSERVATIVE` queries on inexpensive bounds against a suitable depth buffer. Read results only after `QUERY_RESULT_AVAILABLE` reports completion. Bound the number of queries and reuse query objects; avoid one query per small prop or CPU depth readback. Unknown or pending results remain visible. [WebGL2 query targets](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/beginQuery), [query result availability](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/getQueryParameter)

A previous frame's invisible result is not proof of current invisibility after camera motion. Revalidate visibility when the view or occluders change; if safety cannot be established, render the object until a valid result is available. Always reveal camera-containing and near-plane-intersecting cells. Reset results on teleports, recovery, camera-mode switches, resizing, and scene changes. Use buffered reveal margins only as an additional precaution, not a correctness proof.

Keep visibility decisions scoped to their render pass. Do not hide shared scene objects globally based on the driving camera's occlusion results. Initially apply queries to the main view; shadows and reflection captures retain their independent conservative visibility. Provide a runtime bypass for unsupported/problematic contexts and for views where query overhead exceeds savings. This bypass preserves the image, rather than lowering visual quality.

A hierarchical depth-buffer approach is a later alternative, especially with a different rendering backend. It is not a prerequisite and should not introduce synchronous GPU-to-CPU visibility downloads.

### Backface culling: remove unnecessary surface shading

All current map materials export as double-sided, which disables normal rasterizer face culling for those draws. Add explicit material-side metadata and switch validated closed buildings, solid barriers, and other suitable geometry to `FrontSide`. Check winding, mirrored transforms, and viewpoints from both sides. Keep thin fences, foliage cards, banners, and other genuinely two-sided surfaces double-sided when required. Tune shadow-side behavior independently so thin geometry does not lose its shadow. [Material sides](https://threejs.org/docs/pages/Material.html)

This reduces work on unseen triangle faces; it does not remove entire hidden objects or avoid all vertex processing. Use it together with frustum and occlusion culling.

### Other optimizations that preserve the intended image

| Optimization | Project application | Condition for acceptance |
| --- | --- | --- |
| Spatial batching and instancing | Reduce submissions for compatible geometry within cells and repeated props. | Preserve individual culling, UVs, material behavior, and collision references. |
| Geometry processing | Improve vertex/index locality, remove truly redundant data, and evaluate Meshopt compression. | Check names, scale, normals, UV precision, and boundary seams; transport compression alone does not reduce draw calls. |
| Distance detail levels | Use simpler secondary buildings/props when their projected size makes the difference negligible. | Preserve silhouettes, shadow coverage, and stable transitions; do not reduce detail on the active car or nearby road. |
| Texture delivery and residency | Use the existing KTX2 proposal, appropriate mipmaps, selective resolution, and bounded caches. | Compare actual surface detail and alpha edges; high-quality maps must be available before they become visible. |
| Static scene transforms | Compute loaded-world transforms/bounds once and stop redundant updates where safe. | Keep vehicle, camera, sky, and animated-prop transforms dynamic and invalidate static data if an object changes. |
| Allocation and interface updates | Reuse vectors/query buffers and avoid rewriting unchanged HUD values; profile the minimap redraw separately. | Keep driving physics and visible interface responsiveness equivalent. |
| Loading preparation | Move suitable decompression/conversion work to workers, prepare assets ahead of use, and warm expected shader variants with `compileAsync`. | Avoid stalls and unexpected first-use changes; do not parallelize loading without accounting for peak memory. |
| Pass and resource budgets | Reuse compatible depth/normal buffers; retain bounded light/probe pools and scheduled static-cache updates. | Preserve cutouts and HDR data; moving cars and changed lights still need current shadows/reflections. |
| GPU resource lifetime | Allocate render targets at setup/resize and dispose abandoned targets, textures, geometries, queries, and cached probes. | No recurring memory growth after vehicle, quality, or day/night switches. |

Resource reuse, batching, and avoiding blocking WebGL calls are established optimization techniques; their value here still needs measurement. Prefer removing redundant work before automatically reducing resolution or effects. [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices), [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)

Measure each culling stage separately: cells considered, frustum rejects, occlusion rejects, queries issued/pending, draw calls/triangles submitted, CPU decision time, and full-frame GPU time where available. Compare visibility with culling bypassed on the same camera path. Tests should include fast driving around corners, sudden camera turns, recovery/teleports, both cars, day/night, thin fences, off-camera shadow casters, and reflection captures. Rendering optimizations must never disable collision or road-contact queries for geometry that gameplay still needs.

Primary areas: asset conversion/chunk metadata, a dedicated visibility manager, `src/main.js`, `src/graphics.js`, and shadow/reflection integration.

## Ranked visual improvements

The priorities and costs below are engineering judgments based on this project. They are not measured performance results or delivery-time guarantees.

| Priority | Improvement | Expected visual benefit | Runtime cost | Work size |
| --- | --- | --- | --- | --- |
| 1 | Road, curb, pavement, and masonry PBR maps | Very high: surfaces respond to light with believable detail | Low to medium; additional texture memory and sampling | Medium; needs asset authoring |
| 2 | Building shadow coverage and contact depth | Very high: streets, structures, and tires feel grounded | Medium to high with cascades and AO | Medium to large |
| 3 | Local reflections on the active car | High: buildings and barriers appear in paint and glass | Low with baked probes; high with live captures | Medium |
| 4 | Street lamps and realistic headlight beams | Very high at night | Medium; depends on light and shadow count | Medium to large |
| 5 | Sharper textures and better edge smoothing | High on fences, markings, facades, and distant detail | Medium; scales with render resolution | Small to medium |
| 6 | Selected props, tire marks, and foliage improvements | High in close views and empty roadside areas | Depends on placement, batching, and detail levels | Medium to large |
| 7 | Reference-based sky, exposure, and glass tuning | Moderate across the entire image | Usually low; transmission can add cost | Small to medium |

### 1. Build a material pilot on one short section

Start with the starting straight: asphalt, white lines, curbs, concrete barriers, and one nearby facade. Create an explicit material manifest instead of relying on loose name matching: the current road regex also encounters advertising and garage-related material names.

Author or acquire matching base-color, tangent-space normal, and roughness maps. Use restrained asphalt grain, smoother worn patches, rougher repairs, and distinct curb paint. Add cracks, patch seams, dirt, and rubber as selective overlays. Match tiling to world scale; oversized grain makes a meter-scale track resemble gravel.

Keep existing UVs for authored markings and facades. For tiled detail, add a suitable UV set or controlled world-space detail layer. New textures must share the correct orientation and scale. Use sRGB for color/emission and non-color data for normal/roughness/AO; preserve the existing single output conversion. [Three.js color management](https://threejs.org/manual/pages/color-management.html)

If packaging ORM textures, use red for occlusion, green for roughness, and blue for metalness. Treat asphalt and masonry as nonmetallic. Bake static cavity detail only after checking the available UV layout. [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)

Avoid automatically converting a shaded color photograph into a strong normal map: signs, shadows, and painted color variation would become false bumps. New maps require visual review under several light directions. Poly Haven provides CC0 texture sets and HDRIs suitable for evaluating generic surface detail. [Poly Haven asset license](https://polyhaven.com/license)

Primary files: `scripts/convert_map.py`, `src/main.js`, and new material assets/configuration.

### 2. Fix shadow eligibility before adding ambient occlusion

First replace the blanket size exclusion with spatial chunks or simplified shadow-caster geometry for large building batches. Select casters using their potential contribution to the lit street, including off-camera buildings that cast into view. Merely increasing the shadow map size cannot restore an excluded caster.

Next evaluate three cascades over approximately 250–350 m, initially at 2048 pixels per cascade. Keep the nearest cascade detailed and fade transitions. The project's 6000 m camera range serves the skyline and should not dictate detailed shadow coverage. Three.js CSM requires material setup and an update each frame. Preserve existing car shader customizations when integrating it. [CSM documentation](https://threejs.org/docs/pages/CSM.html)

Two relevant r180 details: `shadow.radius` has no effect with the current `PCFSoftShadowMap`; and the documented shadow-map sizes are powers of two, unlike the existing 1536/3072 presets. Use supported sizes and tune coverage/bias against actual fence and tire silhouettes. [Installed LightShadow source](C:/Users/Fuad/Desktop/DriveAtBaku/node_modules/three/src/lights/LightShadow.js:67)

Then prototype modest GTAO for tire contact, wall bases, and architectural creases. Start at half width and height, with a small world-space radius, and inspect denoising while moving. GTAO offers higher quality than the built-in SSAO pass at greater cost. [GTAOPass](https://threejs.org/docs/pages/GTAOPass.html)

The stock r180 GTAO normal/depth override does not inherit each material's alpha map and cutoff. With 201 cutout materials, a blind integration can make fence holes contribute as solid surfaces. Supply a compatible depth/normal buffer or explicitly handle cutouts; exclude the sky and unsuitable transparent geometry. Ensure the composer preserves the chosen effect resolution when resizing. Reduce the Ferrari's existing blob shadow if AO duplicates it. Do not bake moving-car or sun shadows into static AO.

Primary files: `src/trackBoundaries.js`, `src/graphics.js`, `src/main.js`, and the asset pipeline.

### 3. Give the car a reflection of its surroundings

The current reflection environment contains the procedural sky alone. The day screenshot's broad bright paint highlight has little recognizable city structure. Better local reflections should be tested before making the paint increasingly metallic or lowering its roughness.

First bake day/night probes at representative route locations: the starting straight, a narrow street, and the waterfront. Apply the relevant environment to paint and glass, preserving the broader sky illumination. Use zone hysteresis to avoid repeated switching at boundaries. Smooth interpolation between probe textures needs additional shader work; Three.js does not automatically blend an arbitrary probe grid.

For Cinematic, compare this with one 128–256 pixel cube capture near the active car, updated only after meaningful movement or at a limited cadence. Hide the car during capture, use simplified surroundings, reuse appropriate shadow data, retain a valid sky backdrop, and filter the result for roughness. A cube capture renders six directions and can create frame-time spikes even at low resolution. [CubeCamera](https://threejs.org/docs/pages/CubeCamera.html), [PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html)

Clearcoat already exists on both cars. Tune paint against references, keeping rims, rubber, glass, and paint separate. Evaluate physical glass transmission only where the interior supports it and the extra rendering cost is worthwhile. [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)

Primary files: `src/graphics.js`, `src/carModel.js`, `src/elantraModel.js`.

### 4. Build night lighting around actual fixtures

Convert and inspect `assets_lamps.dae` separately. Its scene geometry and the source placement transform can establish fixture locations, but the Collada inventory does not establish usable light-source positions or beam directions. Derive and validate those explicitly.

Use emissive bulbs plus illumination pools on the ground. Keep a fixed pool of nearby runtime lights, initially testing 4–8; restrict shadow casting to the most valuable lights. Baking static lamp illumination is an alternative where a dedicated lightmap UV layout is available. Each shadowed light adds scene rendering; shadowed point lights require six directions. [Three.js shadows](https://threejs.org/manual/pages/shadows.html)

For the player's headlights, test physically based falloff, re-tuned intensity, and a beam mask with a recognizable low-beam cutoff. Add one or two tightly bounded shadow maps so walls stop the beam. Validate at close range and at driving distance instead of compensating by raising global exposure. Three.js spotlights support textured beam masks and shadows; compatibility should be tested on r180. [SpotLight](https://threejs.org/docs/pages/SpotLight.html)

Use authored masks for lit windows rather than making every window glow uniformly. Keep lamps bright enough to bloom while preserving readable road and facade detail.

Primary files: `scripts/convert_map.py`, `src/main.js`, `src/graphics.js`, and lamp placement data.

### 5. Recover texture clarity and reduce shimmer

Reconvert selected near-camera textures from their original DDS files at 2048 pixels, using 4096 only for assets that occupy enough screen area. Do not increase every texture indiscriminately. The converter's cached texture filenames currently omit quality/resolution, so a new conversion must invalidate or version that cache.

Add KTX2/Basis support through `KTX2Loader` and `GLTFLoader.setKTX2Loader`, retaining correct color-space metadata and mipmaps. Evaluate UASTC for normal maps and important cutouts; compare compressed edges and fine grain before accepting smaller files. Gzip/JPEG file compression does not preserve GPU texture compression after decoding. [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html)

For Cinematic, compare the current FXAA with SMAA and supported multisampling on the HDR scene target. Canvas antialiasing does not automatically multisample the composer's offscreen target. SMAA belongs before `OutputPass`, unlike the current FXAA placement. Test thin fences in motion: spatial smoothing alone does not guarantee stable distant cutouts. [SMAAPass](https://threejs.org/docs/pages/SMAAPass.html)

At ordinary device pixel ratio 1, the existing 1.75 cap does not increase rendering resolution. If supersampling is desired, introduce an explicit render scale. A 1.5 scale in both dimensions renders 2.25 times as many pixels, so keep it optional even on a powerful PC.

Primary files: `scripts/convert_map.py`, asset packing, `src/main.js`, `src/graphics.js`.

### 6. Restore selected details while improving asset organization

Evaluate source lamp/prop models and existing `DecalRoad` tire-mark paths near visible corners. Preserve their transforms and meter scale; convert decal paths into suitable surface-conforming geometry. Inspect for overlap with details already embedded in the main circuit before adding them.

Split large material batches into spatial cells, then merge compatible geometry within each cell. Add distance detail levels to secondary buildings and props; use instancing for repeated new objects where their source geometry permits it. This organization helps both visible rendering and shadow selection. Global merging can reduce draw calls while making culling worse.

Inspect foliage alpha coverage, normals, and billboarding before adding wind. Apply single-sided rendering only after checking mesh orientation and sheet geometry. Optimize visual assets independently of the collision and boundary data.

Use an asset inspection/optimization workflow to choose individual transforms instead of assuming a generic optimization command preserves every required property. Validate UVs, names used by game logic, alpha cutoffs, scale, and seams. [glTF Transform CLI](https://gltf-transform.dev/cli)

### 7. Improve the overall rendering pipeline

Treat lighting, shaders, shadows, reflections, and post-processing as one coordinated program:

| Area | Planned improvement | Quality check |
| --- | --- | --- |
| Lighting | Calibrate direct sun/moon light, sky/environment illumination, fill, lamp falloff, and exposure together. Evaluate separate baked day/night indirect-light contributions where UVs and authoring support them. | Shade should retain plausible detail without flattening contrast or clipping illuminated surfaces. |
| Shadows | Establish correct building coverage and stable cascades, then evaluate contact-hardening/variable-penumbra filtering for Cinematic. This needs an appropriate implementation; raising `shadow.radius` in the current mode is insufficient. | Contact stays defined, distant shadows soften plausibly, thin fences survive, and transitions do not shimmer. |
| Material shaders | Author surface-specific normal/roughness response, restrained car-paint clearcoat detail, glass Fresnel response, and consistent decal behavior. Keep vertex deformation consistent across beauty, shadow, and depth/normal passes. | Materials retain their identity in daylight, shade, and headlights; no false bumps or material discontinuities. |
| Reflections | Match local probes to the route and lighting mode; compare scheduled live car captures and selective SSR with probe fallback. | Nearby surroundings are recognizable, and captures/transitions do not produce obvious jumps or missing geometry. |
| Post-processing | Retain linear HDR operations and one final tone-map/output conversion. Integrate cutout-correct AO, restrained bloom, reference-based grading, and improved antialiasing. | No washed-out asphalt, excessive halos, clipped paint color, or softened road markings. |
| Temporal quality | Assess moving-image shimmer and disocclusion as well as still-image sharpness. Consider temporal AA only with suitable history rejection and moving-object handling. | No car trails or stale images after camera changes; clear fences and markings during driving. |

Share compatible auxiliary depth/normal data where possible instead of blindly stacking passes that each render the city again. The logical order is scene/auxiliary data, applicable occlusion/reflection composition, bloom/grading, SMAA, then `OutputPass`; the actual integration must preserve each pass's input format and transparent-surface behavior. The existing FXAA alternative remains after output conversion. Raw stock passes are not automatically a shared-buffer pipeline.

Collect a small day/night reference set with comparable viewpoint and weather. Match exposure, shadow color, road tone, and material scale before adjusting saturation. The present sky is a custom gradient/noise shader; a scattering-based sky or well-matched HDRI is worth an A/B test after the higher-priority work. Keep sun direction, visible sky, fog, and reflection illumination coordinated. [Three.js Sky](https://threejs.org/docs/pages/Sky.html)

Evaluate restrained screen-space reflections only for surfaces that benefit, such as glass or an optional wet-road mode. The effect supports selective objects and lower resolution, but screen-space information cannot represent every offscreen reflection; retain environment probes as a fallback. [SSRPass](https://threejs.org/docs/pages/SSRPass.html)

Depth of field and motion blur suit optional photo or replay modes. Strong blur during driving can obscure markings, and extra bloom cannot create missing surface detail. Real-time path tracing, a full renderer rewrite, and whole-city displacement are poor first investments for this project.

## Suggested implementation sequence and acceptance checks

1. **Establish a baseline.** Choose a concrete GPU/browser and native 1440p as an initial comparison target. Capture the starting straight, a narrow street, a turn with tire marks, and the waterfront in both modes with both cars. Record frame-time distribution, shader compilation spikes, load time, draw calls, and texture/geometry counts. Keep captures identical between comparisons. Use a 16.7 ms frame target if aiming for 60 FPS; this is a target, not a measured result.
2. **Visibility foundation.** Add spatial chunks and tight bounds, retain per-view frustum culling, validate material sides, and build conservative occlusion culling with a bypass. The first implementation uses current-camera facade geometry; evaluate asynchronous queries later if profiling warrants them. Compare every stage against the reference path and preserve independent shadow/reflection visibility.
3. **Material and shadow pilot.** Upgrade one short section, correct nearby building eligibility, and test curb/fence/tire shadow quality. Accept only when it looks better during driving as well as in a still image.
4. **Car reflections and night pilot.** Compare baked versus live probes. Add a few validated street fixtures and blocked headlight beams. Check that scene switches and the garage still use the intended environment.
5. **Effects, shaders, and asset expansion.** Add cutout-correct AO, compare edge smoothing and shadow filtering, tune the coordinated rendering pipeline, and then expand chosen materials and props around the route. Measure each feature separately before combining budgets.
6. **Performance and visual acceptance.** Verify culling has no visible errors, measure the net benefit of optimization, check resource lifetime and shader stutters, and validate the combined Cinematic configuration. Keep a diagnostic bypass for comparison and recovery.

For multiple render passes, aggregate renderer statistics across the full frame rather than reading only the final fullscreen pass. `renderer.info` reports counts, not exact VRAM bytes or GPU timing; collect those separately where supported. [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)

Visual acceptance should include intact fence holes, recognizable road grain at correct scale, no AO halos around the car, stable shadow transitions, headlights blocked by walls, preserved paint color beneath highlights, readable night surfaces, and no stretched or repeated decal artifacts. Any pipeline change should also pass the existing graphics, barriers, and driving checks and production build.

The first implementation package is now in the working tree: **spatial culling and validated material sides + conservative facade occlusion + a road-material pilot + corrected building shadow eligibility + a local car-reflection probe**. Complete the outstanding browser and hardware acceptance checks described at the top before committing to a city-wide asset rebuild.
