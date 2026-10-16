extends RefCounted

# Keep desktop presentation independent of the phone's rendering budget.
static func desktop() -> bool:
	return not OS.has_feature("mobile")

static func defaults(mobile: bool) -> Dictionary:
	return {"quality": "performance", "resolution": 720, "render_distance": 1800.0} if mobile else {"quality": "high", "resolution": 0, "render_distance": 3000.0}

static func apply(game: Node3D):
	var viewport: Viewport = game.get_viewport()
	var env: Environment = game.environment.environment
	var quality: String = Preferences.values.quality
	var pc = desktop()
	var forward = RenderingServer.get_current_rendering_method() == "forward_plus"
	var detailed = pc and quality != "performance"
	var high = pc and quality in ["high", "ultra"]
	var ultra = pc and quality == "ultra"
	var height = float(game.get_viewport().get_visible_rect().size.y)
	var target = float(Preferences.values.resolution)
	viewport.scaling_3d_scale = 1.0 if target == 0 else minf(1.0, target / maxf(height, 1))
	if pc and target == 0: viewport.scaling_3d_scale = Preferences.values.render_scale
	viewport.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR if pc and forward and viewport.scaling_3d_scale < 1.0 else Viewport.SCALING_3D_MODE_BILINEAR
	viewport.use_taa = high and forward
	# TAA handles subpixel edges on High; reserve the extra MSAA pass for Ultra.
	viewport.msaa_3d = Viewport.MSAA_4X if ultra else (Viewport.MSAA_2X if quality == "balanced" else Viewport.MSAA_DISABLED)
	viewport.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if pc and quality == "performance" else Viewport.SCREEN_SPACE_AA_DISABLED
	viewport.mesh_lod_threshold = (0.7 if high else 1.5) if pc else 1.0
	for mesh in game.world_meshes:
		mesh.visibility_range_end = minf(Preferences.values.render_distance, Preferences.values.props_distance) if mesh.get_meta("desktop_prop", false) else Preferences.values.render_distance
		mesh.lod_bias = 1.5 if high else 0.8
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if detailed else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	game.camera.far = maxf(3000, Preferences.values.render_distance + 200)
	game.sun.directional_shadow_mode = (DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if ultra else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS) if detailed else DirectionalLight3D.SHADOW_ORTHOGONAL
	game.sun.directional_shadow_max_distance = (300.0 if ultra else (160.0 if high else 110.0)) if detailed else 80.0
	game.sun.directional_shadow_blend_splits = detailed
	game.sun.shadow_bias = 0.04 if detailed else 0.1
	game.sun.shadow_normal_bias = 0.65 if detailed else 1.0
	game.sun.light_angular_distance = 0.5 if ultra and forward else 0.0
	if pc:
		RenderingServer.directional_shadow_atlas_set_size(4096 if high else 2048, true)
		RenderingServer.directional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_SOFT_MEDIUM)
	env.ssao_enabled = detailed and forward and Preferences.values.ambient_occlusion
	env.ssao_radius = 1.1
	env.ssao_intensity = 1.25
	env.ssao_power = 1.3
	env.ssao_detail = 0.5
	env.ssao_light_affect = 0.15
	env.ssil_enabled = ultra and forward
	env.ssil_radius = 4.0
	env.ssil_intensity = 0.45
	env.ssr_enabled = high and forward
	env.ssr_max_steps = 64 if ultra else 32
	env.ssr_fade_in = 0.15
	env.ssr_fade_out = 2.0
	env.ssr_depth_tolerance = 0.3
	env.glow_enabled = detailed
	env.glow_intensity = 0.45
	env.glow_bloom = 0.025
	env.glow_hdr_threshold = 1.4
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.sky.radiance_size = Sky.RADIANCE_SIZE_256 if high else Sky.RADIANCE_SIZE_128
	game.local_probe.enable_shadows = high
	game.local_probe.mesh_lod_threshold = 0.5 if ultra else (1.0 if high else 4.0)
	# Capture six faces incrementally, only after moving a meaningful distance.
	game.local_probe.update_mode = ReflectionProbe.UPDATE_ONCE
	game.local_probe.position += Vector3(0.001, 0, 0)
	game.precipitation.amount = maxi(1, roundi((1600 if high else 600) * Preferences.values.precipitation))
	Engine.max_fps = int(Preferences.values.get("frame_limit", 0)) if pc else 60
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if Preferences.values.get("vsync", true) else DisplayServer.VSYNC_DISABLED)
	apply_atmosphere(game)

static func apply_atmosphere(game: Node3D):
	var env: Environment = game.environment.environment
	var quality: String = Preferences.values.quality
	var advanced = desktop() and quality in ["high", "ultra"] and RenderingServer.get_current_rendering_method() == "forward_plus"
	var weather: String = Preferences.values.weather
	# A thin local volume keeps the distant sky and road markings readable.
	env.volumetric_fog_enabled = advanced and (quality == "ultra" or weather in ["rain", "snow"])
	env.volumetric_fog_density = {"sunny": 0.00018, "overcast": 0.0005, "wet": 0.0004, "rain": 0.0012, "snow": 0.0016}.get(weather, 0.00018)
	env.volumetric_fog_length = 140.0
	env.volumetric_fog_sky_affect = 0.0
	env.volumetric_fog_albedo = Color("b6c5d5")
	env.volumetric_fog_ambient_inject = 0.35
