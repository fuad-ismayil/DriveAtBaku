# Graphics research and implemented direction

Research date: 1 October 2026. Implementation targets the project's installed Three.js r180 API.

This note records the earlier sky/lighting package and its browser validation. Current quality settings, culling, surface detail, local reflections, and their validation limits are documented in the [graphics roadmap](C:/Users/Fuad/Desktop/DriveAtBaku/docs/GRAPHICS_REALISM_ROADMAP.md). Browser results below apply to the earlier package.

## Findings

The converted city contains about 2.39 million visual triangles across 633 materials. The circuit already has diffuse textures, texture filtering, nearby shadow casters, and physical car paint. The main visual inconsistency was lighting: an indoor RoomEnvironment supplied street reflections, the sky was independently colored, and HemisphereLight used Y-up while the circuit uses Z-up. The previous sun disc was also oversized.

The chosen direction is warm afternoon light, a softer blue horizon, slow clouds, natural paint reflections, and a cool moonlit night. This improves the existing assets without another large asset download.

## Implemented

- Generate cached day and night reflection maps from the same procedural sky using PMREM. Keep the studio reflection map for the garage. Capture only the sky once at startup, rather than rendering the entire city six times per reflection update.
- Correct hemisphere illumination to Z-up and coordinate sunlight, moonlight, fog, exposure, and reflections. Keep sun and moon directions distinct when switching modes.
- Render into a linear half-float buffer, apply restrained bloom and a subtle saturation/lens falloff pass, then use OutputPass for tone mapping and sRGB conversion once. FXAA smooths edges after color conversion.
- Repair the Elantra export's 75,519 zero normals (of 346,793). Reconstruct missing normals from triangle faces while preserving valid authored normals. Invalid normals could produce NaNs that spread through bloom and turn the whole view black.
- Use quarter-resolution bloom extraction. A luminance threshold reserves glow for strong highlights and lamps rather than washing out the road.
- Add a smaller HDR sun, a moon disc, sparse stars, and softly drifting procedural cloud coverage.
- Soften Ferrari paint highlights. Preserve texture variation in emissive window materials by using the diffuse map as the emissive map, and avoid registering shared materials repeatedly.
- Add saved graphics preferences in the pause menu. Devices without HDR render-target support use direct rendering.

| Setting | Maximum pixel ratio | Shadow size | Edge smoothing | Bloom / lens finish |
| --- | ---: | ---: | ---: | --- |
| Performance | 1.0 | 1536 | Direct canvas antialiasing | Off |
| Balanced (default) | 1.5 | 2048 | FXAA | On |
| Cinematic | 1.75 | 3072 | FXAA | On |

FXAA keeps the effects pipeline independent of HDR multisampling support. These are rendering budgets, not measured frame-rate guarantees. Performance mode retains the improved sky and lighting. Balanced reduces the original 3072 shadow map budget to accommodate the additional effects.

## Further improvements, in priority order

1. Author road, masonry, and pavement normal/roughness maps, using original texture rights and UVs. This adds material depth that color grading alone cannot create.
2. Profile representative driving routes on target hardware, then optimize meshes and add distance-based geometry detail. This should precede expensive screen-space effects.
3. Add actual street lamps using authored placement data and a small pool of nearby lights. Existing window textures provide limited night lighting; this implementation does not invent lamp positions or illuminate every facade.
4. Evaluate ambient occlusion for architectural contact depth after profiling. Screen-space reflections, motion blur, and depth of field remain optional future work: they add render passes or can reduce road readability.

The cached reflection maps capture the sky rather than nearby buildings. Clouds move slowly in the visible sky; the reflection maps intentionally remain static to avoid repeated capture cost.

## Primary sources

- [Three.js PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html): roughness-filtered environment lighting and generation from a scene.
- [Three.js MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html): car-paint clearcoat, environment-map requirements, and additional shading cost.
- [Three.js UnrealBloomPass](https://threejs.org/docs/pages/UnrealBloomPass.html): bloom mip chain, luminance threshold, and tone-mapping requirements.
- [Three.js OutputPass](https://threejs.org/docs/pages/OutputPass.html): tone mapping and output color-space conversion after linear effects.

Browser validation covers the day/night switch, Ferrari and Elantra, headlights, quality switches, saved preferences, and resized rendering. Build, the five existing driving-system checks, and the new real-asset normal-repair regression check pass. The browser reported compiler warnings in Three.js's FXAA shader but no rendering errors during final validation. Preview screenshots are saved locally in artifacts/.

