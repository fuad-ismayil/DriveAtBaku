extends Node

const Graphics = preload("res://scripts/graphics_profile.gd")
var game
var checks = 0
var failures: Array = []
var output = "res://../../artifacts/windows/qa"
var report = {"captures": [], "profiles": [], "vehicles": []}

func _ready():
	call_deferred("run")

func check(condition: bool, message: String):
	checks += 1
	if not condition:
		failures.append(message)
		push_error(message)

func capture(name: String):
	if DisplayServer.get_name() == "headless": return
	for i in 40: await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var path = output.path_join(name + ".png")
	check(get_viewport().get_texture().get_image().save_png(path) == OK, "Screenshot must save: " + name)
	report.captures.append(ProjectSettings.globalize_path(path))
	print("DESKTOP_CAPTURE " + name)

func key(code: Key, pressed = true):
	var event = InputEventKey.new()
	event.physical_keycode = code
	event.pressed = pressed
	game.interface.controls._input(event)

func profile(name: String):
	if DisplayServer.get_name() == "headless" or "--skip-profiling" in OS.get_cmdline_user_args(): return
	var samples: Array = []
	var previous = Time.get_ticks_usec()
	for i in 120:
		await get_tree().process_frame
		var now = Time.get_ticks_usec()
		samples.append((now - previous) / 1000.0)
		previous = now
	samples.sort()
	report.profiles.append({"name": name, "median_ms": samples[60], "p95_ms": samples[114], "draws": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), "triangles": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME)})
	print("DESKTOP_PROFILE " + JSON.stringify(report.profiles.back()))

func run():
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--qa-output="): output = argument.trim_prefix("--qa-output=")
	var saved = Preferences.values.duplicate(true)
	var saved_path = Preferences.storage_path
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	Preferences.storage_path = output.path_join("test-preferences.cfg")
	Preferences.values.merge(Graphics.defaults(false), true)
	Preferences.values.render_scale = 1.0
	Preferences.values.aspect_ratio = "auto"
	Preferences.values.ambient_occlusion = true
	Preferences.values.props_distance = 3000.0
	Preferences.values.precipitation = 1.0
	Preferences.values.vehicle = "ferrari"
	Preferences.values.paint = "#a80719"
	Preferences.values.volume = 0.0
	Preferences.values.night = false
	Preferences.values.weather = "sunny"
	Preferences.values.fullscreen = false
	Preferences.values.touch_controls = false
	Preferences.values.frame_limit = 0
	Preferences.values.vsync = false
	check(Graphics.defaults(false).quality == "high" and Graphics.defaults(false).resolution == 0, "Desktop defaults must use High and native resolution")
	check(Graphics.defaults(true).quality == "performance" and Graphics.defaults(true).resolution == 720, "Phone defaults must retain their rendering budget")
	if DisplayServer.get_name() != "headless": get_window().size = Vector2i(1600, 900)
	game = load("res://main.tscn").instantiate()
	add_child(game)
	var deadline = Time.get_ticks_msec() + 180000
	while not game.ready_to_drive and Time.get_ticks_msec() < deadline: await get_tree().process_frame
	check(game.ready_to_drive, "Native desktop game must load its city and driving library")
	if game.ready_to_drive: await exercise()
	Preferences.values = saved
	Preferences.storage_path = saved_path
	report.checks = checks
	report.failures = failures
	report.renderer = RenderingServer.get_current_rendering_method()
	report.adapter = RenderingServer.get_video_adapter_name()
	var file = FileAccess.open(output.path_join("report.json"), FileAccess.WRITE)
	file.store_string(JSON.stringify(report, "\t"))
	file.close()
	print("DESKTOP_GRAPHICS_%s " % ("PASS" if failures.is_empty() else "FAIL") + JSON.stringify(report))
	game.ready_to_drive = false
	game.sound.shutdown()
	game.queue_free()
	game = null
	await get_tree().create_timer(0.2).timeout
	get_tree().quit(0 if failures.is_empty() else 1)

func exercise():
	var forward = RenderingServer.get_current_rendering_method() == "forward_plus"
	game.set_process(false)
	game.interface.root.hide()
	for i in 240: game.simulation.advance({"throttle": 0.0, "brake": 0.0, "steer": 0.0}, 1.0 / 120)
	game.state = game.simulation.snapshot()
	game.previous = game.state.duplicate(true)
	game._present(1.0)
	game.player.animate(game.state, 0.0, 0)
	game.camera.position = game.player.global_transform * Vector3(4.1, 2.0, 5.4)
	game.camera.look_at(game.player.position + Vector3.UP * 0.8)
	for quality in ["performance", "balanced", "high", "ultra", "performance", "high"]:
		Preferences.values.quality = quality
		game._apply_graphics()
		var detailed = quality != "performance"
		var high = quality in ["high", "ultra"]
		var env: Environment = game.environment.environment
		check(env.ssao_enabled == (detailed and forward), quality + " must apply supported ambient occlusion")
		check(env.ssr_enabled == (high and forward), quality + " must apply supported reflections")
		check(env.ssil_enabled == (quality == "ultra" and forward), quality + " must apply supported indirect lighting")
		check(get_viewport().use_taa == (high and forward), quality + " must apply supported temporal antialiasing")
		check(game.world_meshes[0].cast_shadow == (GeometryInstance3D.SHADOW_CASTING_SETTING_ON if detailed else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF), quality + " must update world shadow casters")
		check(is_equal_approx(get_viewport().scaling_3d_scale, 1), "Native resolution must use every window pixel")
		if quality in ["performance", "high", "ultra"] and report.profiles.filter(func(item): return item.name == "day-" + quality).is_empty():
			await capture("day-" + quality)
			await profile("day-" + quality)
	Preferences.values.resolution = 540
	game._apply_graphics()
	check(get_viewport().scaling_3d_scale <= 1.0, "Rendering height must never supersample a smaller window")
	if get_window().size.y > 540: check(get_viewport().scaling_3d_scale < 1, "Lower rendering height must reduce the scene resolution")
	Preferences.values.resolution = 0
	Preferences.values.render_distance = 6000.0
	game._apply_graphics()
	check(game.camera.far > 6000 and game.world_meshes[0].visibility_range_end == 6000, "Camera clipping must cover the selected draw distance")
	Preferences.values.frame_limit = 120
	game._apply_graphics()
	check(Engine.max_fps == 120, "Desktop frame limit must apply")
	Preferences.values.frame_limit = 0
	game._apply_graphics()
	check(Engine.max_fps == 0, "Unlimited frames must remove the phone's cap")
	for weather in ["sunny", "overcast", "wet", "rain", "snow"]:
		Preferences.values.weather = weather
		game._apply_weather()
		check(game.precipitation.emitting == (weather in ["rain", "snow"]), weather + " must set precipitation")
		check(game.environment.environment.volumetric_fog_enabled == (forward and weather in ["rain", "snow"]), weather + " must update the High atmosphere")
	Preferences.values.weather = "wet"
	game._apply_weather()
	await capture("wet-day")
	Preferences.values.night = true
	Preferences.values.weather = "rain"
	game._apply_weather()
	game.player.headlight_mode = 2
	game.player.animate(game.state, 5.0, 0)
	await capture("night-rain")
	await profile("night-rain")
	Preferences.values.night = false
	Preferences.values.weather = "sunny"
	game._apply_weather()
	game._action("drive")
	key(KEY_C)
	check(game.hood_camera, "C must switch to the hood camera")
	key(KEY_C)
	key(KEY_M)
	check(game.interface.map_overlay.visible and not game.is_driving, "M must open the map and release driving input")
	game._action("map_close")
	key(KEY_Z)
	check(game.indicator.mode == "left", "Z must activate the left indicator")
	key(KEY_B)
	check(game.indicator.mode == "hazard", "B must activate hazards")
	var pause = InputEventKey.new()
	pause.keycode = KEY_ESCAPE
	pause.physical_keycode = KEY_ESCAPE
	pause.pressed = true
	Input.parse_input_event(pause)
	await get_tree().process_frame
	check(game.interface.menu.visible and not game.is_driving, "Escape must pause driving")
	var unpause_key = pause.duplicate()
	unpause_key.pressed = false
	Input.parse_input_event(unpause_key)
	game.interface.category = "Graphics & audio"
	game.interface.root.show()
	game.interface.navigate("settings")
	check(game.interface.fields.quality.item_count == 4, "Windows settings must offer four quality presets")
	check(game.interface.fields.resolution.item_count == 6, "Windows settings must offer native, 1440p and 2160p rendering")
	check(game.interface.fields.has("fullscreen") and game.interface.fields.has("vsync"), "Windows settings must expose display controls")
	await capture("windows-settings")
	game._action("drive")
	var controls = game.interface.controls
	var mouse = InputEventMouseButton.new()
	mouse.button_index = MOUSE_BUTTON_RIGHT
	mouse.pressed = true
	controls._input(mouse)
	var motion = InputEventMouseMotion.new()
	motion.relative = Vector2(30, 8)
	controls._input(motion)
	check(controls.camera_delta == Vector2(30, 8), "Right mouse drag must orbit the camera")
	controls.clear()
	check(not controls.mouse_look, "Pause and focus changes must release camera dragging")
	var accelerator = InputEventKey.new()
	accelerator.keycode = KEY_W
	accelerator.physical_keycode = KEY_W
	accelerator.pressed = true
	Input.parse_input_event(accelerator)
	await get_tree().process_frame
	check(controls.sample(1.0 / 120).throttle == 1.0, "W must reach the native accelerator")
	var release = accelerator.duplicate()
	release.pressed = false
	Input.parse_input_event(release)
	await get_tree().process_frame
	check(controls.sample(1.0 / 120).throttle == 0.0, "Releasing W must release the accelerator")
	if DisplayServer.get_name() != "headless":
		var fullscreen = InputEventKey.new()
		fullscreen.physical_keycode = KEY_F11
		fullscreen.pressed = true
		game._unhandled_key_input(fullscreen)
		check(DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN, "F11 must enter fullscreen")
		check(game.interface.fields.fullscreen.button_pressed, "Fullscreen setting must follow F11")
		game._unhandled_key_input(fullscreen)
		check(DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_WINDOWED, "F11 must restore windowed mode")
	game._action("pause")
	for id in game.IDS:
		check(await game._select_vehicle(id), "Desktop must load " + id)
		var start: Vector3 = game.state.position
		for i in 600: game.simulation.advance({"throttle": 0.5, "brake": 0.0, "steer": 0.0}, 1.0 / 120)
		var state: Dictionary = game.simulation.snapshot()
		check(state.position.is_finite() and state.speed > 1 and state.position.distance_to(start) > 2, id + " must drive with native physics")
		report.vehicles.append({"vehicle": id, "distance": state.position.distance_to(start), "speed": state.speed})
		game._reset_at(game._from_wire(game.route.spawn), game.route.heading)
	await game._select_vehicle("ferrari")
	game.camera.position = game.player.global_transform * Vector3(0, 2.4, 5.6)
	game.camera.look_at(game.player.position + Vector3.UP * 0.8)
	game._action("drive")
	game.set_process(true)
	await capture("windows-driving")
