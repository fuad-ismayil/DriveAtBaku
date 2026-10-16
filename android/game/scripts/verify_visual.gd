extends Node

var game: Node3D
var camera = Camera3D.new()
var frozen_signal = "off"
var follow_camera = false
var drive_start = 0
var report = {"files": [], "profiles": [], "renderer": "", "device": ""}

func _process(_dt):
	if game != null and game.ready_to_drive:
		game.indicator.mode = frozen_signal
		game.indicator.epoch = game.session.server_time() - 100
		if follow_camera:
			camera.transform = game.camera.transform
			var accelerating = Time.get_ticks_msec() - drive_start < 6000
			game.interface.controls.throttle = 0.45 if accelerating else 0.0
			game.interface.controls.brake = 0.0 if accelerating else 0.3

func _ready():
	Preferences.values.vehicle = "ferrari"
	Preferences.values.resolution = 720
	Preferences.values.quality = "performance"
	Preferences.values.render_distance = 1200.0
	Preferences.values.volume = 0.32
	Preferences.values.night = false
	Preferences.values.weather = "sunny"
	game = load("res://main.tscn").instantiate()
	add_child(game)
	var start = Time.get_ticks_msec()
	while not game.ready_to_drive:
		if Time.get_ticks_msec() - start > 150000:
			push_error("DEVICE_VISUAL_FAILED initialization timeout")
			get_tree().quit(1)
			return
		await get_tree().process_frame
	game.interface.root.hide()
	add_child(camera)
	camera.current = true
	camera.near = 0.1
	camera.far = 1800
	report.renderer = RenderingServer.get_video_adapter_name()
	report.device = OS.get_model_name()
	if FileAccess.file_exists("user://fast-qa"):
		await _calibration()
		await _finish()
		return
	# Record the actual native mix while Android's real audio driver and Vulkan
	# renderer run together, rather than testing a desktop audio mock alone.
	var recording = AudioEffectRecord.new()
	recording.format = AudioStreamWAV.FORMAT_16_BITS
	AudioServer.add_bus_effect(0, recording)
	game.is_driving = true
	recording.set_recording_active(true)
	await get_tree().create_timer(10).timeout
	recording.set_recording_active(false)
	var stream = recording.get_recording()
	stream.save_to_wav("user://native-idle.wav")
	report.files.append("native-idle.wav")
	AudioServer.remove_bus_effect(0, AudioServer.get_bus_effect_count(0) - 1)
	game.is_driving = false
	for id in game.IDS:
		await game._select_vehicle(id)
		game.interface.root.hide()
		game._reset_at(game._from_wire(game.route.spawn), game.route.heading)
		game.is_driving = true
		await get_tree().create_timer(1.5).timeout
		game.is_driving = false
		camera.position = game.player.global_transform * Vector3(2.8, 1.3, -4.2)
		camera.look_at(game.player.position + Vector3.UP * 0.75)
		for mode in ["off", "left", "right", "hazard"]:
			frozen_signal = mode
			await _capture("%s_front_%s" % [id, mode])
		camera.position = game.player.global_transform * Vector3(1.8, 1.1, 3.7)
		camera.look_at(game.player.position + Vector3.UP * 0.65)
		frozen_signal = "off"
		await _capture("%s_rear_off" % id)
		frozen_signal = "hazard"
		await _capture("%s_rear_hazard" % id)
		var plate = {"enabled": true, "region": "99", "letters": "AB", "serial": "808", "hyphens": false, "identity": "new", "format": "compact"}
		game.player.registration(plate)
		frozen_signal = "off"
		camera.position = game.player.global_transform * Vector3(0.25, 0.9, 2.9 if id == "ferrari" else 3.2)
		camera.look_at(game.player.global_transform * Vector3(0, 0.65, 2.0))
		await _capture("%s_plate_compact" % id)
	await game._select_vehicle("ferrari")
	game.interface.root.hide()
	game._reset_at(game._from_wire(game.route.spawn), game.route.heading)
	game.is_driving = true
	await get_tree().create_timer(1.5).timeout
	game.is_driving = false
	camera.position = game.player.global_transform * Vector3(0, 2.4, 5.6)
	camera.look_at(game.player.position + Vector3.UP * 0.8)
	Preferences.values.night = true
	game._apply_weather()
	for mode in [0, 1, 2]:
		game.player.headlight_mode = mode
		await _capture("night_headlights_%d" % mode)
	Preferences.values.weather = "rain"
	game._apply_weather()
	await get_tree().create_timer(14).timeout
	await _capture("night_rain")
	await _profile("night_rain", 300)
	camera.position = Vector3(650, 10, -480)
	camera.look_at(Vector3(680, 24, -625))
	await _capture("government_house_night")
	Preferences.values.night = false
	Preferences.values.weather = "sunny"
	game._apply_weather()
	await _capture("government_house_day")
	var flag = game.city_effects.flag
	camera.position = flag.global_position + Vector3(8, 0, 12)
	camera.look_at(flag.global_position + Vector3(3, -1.8, 0))
	await _capture("flag_a")
	await get_tree().create_timer(0.5).timeout
	await _capture("flag_b")
	await _finish()

func _finish():
	var file = FileAccess.open("user://native-qa-report.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report))
	file.close()
	print("DEVICE_VISUAL_PASS " + JSON.stringify(report))
	game.ready_to_drive = false
	game.city_effects.set_process(false)
	game.sound.shutdown()
	game.queue_free()
	game = null
	await get_tree().create_timer(0.15).timeout
	get_tree().quit()

func _calibration():
	game.is_driving = true
	await get_tree().create_timer(1.5).timeout
	game.is_driving = false
	camera.position = game.player.global_transform * Vector3(0, 2.4, 5.6)
	camera.look_at(game.player.position + Vector3.UP * .8)
	Preferences.values.night = true
	game._apply_weather()
	game.player.headlight_mode = 1
	for multiplier in [1]:
		game.player.headlight_energy_scale = multiplier
		await _capture("calibration_low_%d" % multiplier)
	game.player.headlight_mode = 2
	game.player.headlight_energy_scale = 1
	await _capture("calibration_high")
	Preferences.values.weather = "rain"
	game._apply_weather()
	await get_tree().create_timer(15).timeout
	await _capture("calibration_rain")
	await _profile("calibration_rain", 300)
	camera.position = game.player.global_transform * Vector3(1.3, 1.9, 2.9)
	camera.look_at(game.player.global_transform * Vector3(0, 0.8, 0.5))
	await _capture("calibration_droplets")
	game._action("drive")
	game.interface.root.hide()
	follow_camera = true
	drive_start = Time.get_ticks_msec()
	var recording = AudioEffectRecord.new()
	recording.format = AudioStreamWAV.FORMAT_16_BITS
	AudioServer.add_bus_effect(0, recording)
	recording.set_recording_active(true)
	await _profile("rain_driving", 300)
	recording.set_recording_active(false)
	recording.get_recording().save_to_wav("user://native-driving.wav")
	report.files.append("native-driving.wav")
	AudioServer.remove_bus_effect(0, AudioServer.get_bus_effect_count(0) - 1)
	game.is_driving = false
	follow_camera = false
	game.interface.controls.clear()
	await _capture("rain_driving")

func _capture(name: String):
	await get_tree().create_timer(0.3).timeout
	await RenderingServer.frame_post_draw
	var image = get_viewport().get_texture().get_image()
	image.save_png("user://%s.png" % name)
	report.files.append(name + ".png")
	print("DEVICE_CAPTURE " + name)

func _profile(name: String, frames: int):
	var times = []
	var last = Time.get_ticks_usec()
	for i in frames:
		await get_tree().process_frame
		var now = Time.get_ticks_usec()
		times.append((now - last) / 1000.0)
		last = now
	times.sort()
	var sample = {"name": name, "frames": frames, "median_ms": times[frames / 2], "p95_ms": times[int(frames * 0.95)], "draws": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), "triangles": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME)}
	report.profiles.append(sample)
	print("DEVICE_PROFILE " + JSON.stringify(sample))
