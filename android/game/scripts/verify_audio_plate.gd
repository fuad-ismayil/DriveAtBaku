extends Node3D

var sound: Node
var state: Dictionary = {}
var camera = Camera3D.new()
var report = {"checks": 0, "captures": [], "recordings": [], "failures": []}

func check(value: bool, message: String):
	report.checks += 1
	if not value:
		report.failures.append(message)
		push_error(message)

func _process(dt):
	if is_instance_valid(sound): sound.update(state, true, dt)

func _ready():
	Preferences.values.volume = 0.32
	Preferences.values.weather = "sunny"
	DirAccess.make_dir_recursive_absolute("user://audio-plate-qa")
	var world = WorldEnvironment.new()
	world.environment = Environment.new()
	world.environment.background_mode = Environment.BG_COLOR
	world.environment.background_color = Color(0.006, 0.008, 0.012)
	world.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	world.environment.ambient_light_color = Color(0.55, 0.65, 0.8)
	world.environment.ambient_light_energy = 0.025
	add_child(world)
	add_child(camera)
	camera.current = true
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 0.36
	camera.near = 0.02
	camera.far = 8.0 # Keep sub-millimetre plate artwork precise in this orthographic close-up.
	var profiles = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/vehicles.json"))
	state = {"wheels": [], "gear": 1, "brake_force": 0.0, "velocity": Vector3.ZERO, "engine_load": 0.0, "throttle": 0.0, "shift_timer": 0.0, "acceleration": 0.0}
	for i in 4: state.wheels.append({"steer": 0, "spin": 0, "compression": 0, "grounded": true, "slip": 0})
	report.renderer = RenderingServer.get_video_adapter_name()
	for id in ["ferrari", "elantra", "amg", "prado"]:
		print("AUDIO_PLATE_PHASE " + id)
		var view = preload("res://scripts/vehicle_view.gd").new()
		add_child(view)
		check(await view.load_vehicle(id), id + " vehicle load")
		check(view.plate_lamps.size() == 4, id + " two lamps per rear plate format")
		for format in ["long", "compact"]:
			view.registration({"enabled": true, "region": "99", "letters": "AB", "serial": "808", "hyphens": false, "identity": "new", "format": format})
			var mount = view.plate_lamps[0].node.get_parent()
			for lamp in view.plate_lamps:
				if lamp.node.is_visible_in_tree(): mount = lamp.node.get_parent()
			camera.global_position = mount.global_transform * Vector3(0, 0, 0.85)
			camera.look_at(mount.global_position, mount.global_basis.y.normalized())
			for mode in [0, 1, 2]:
				view.headlight_mode = mode
				view.animate(state, 1.0 / 30, 100)
				var active = 0
				for lamp in view.plate_lamps:
					if lamp.node.light_energy > 0: active += 1
				check(active == (0 if mode == 0 else 2), id + " " + format + " lamp switch " + str(mode))
				for plate in view.plate_nodes:
					if is_instance_valid(plate.plate):
						for mesh in plate.plate.find_children("*", "MeshInstance3D", true, false): check(mesh.layers == 2, "Plate must receive vehicle lights")
				if DisplayServer.get_name() != "headless":
					await get_tree().process_frame
					await RenderingServer.frame_post_draw
					var name = "%s_%s_%d.png" % [id, format, mode]
					get_viewport().get_texture().get_image().save_png("user://audio-plate-qa/" + name)
					report.captures.append(name)
		view.registration({"enabled": false})
		view.animate(state, 1.0 / 30, 100)
		check(view.plate_lamps.all(func(lamp): return lamp.node.light_energy == 0), "Disabled plates must switch lamps off")
		state.rpm = profiles[id].idleRpm
		sound = preload("res://scripts/engine_audio.gd").new()
		add_child(sound)
		sound.setup(id, profiles[id])
		check(sound.horn.stream is AudioStreamWAV and sound.horn.stream.format == AudioStreamWAV.FORMAT_16_BITS, id + " horn must retain uncompressed loop PCM")
		state.horn = true
		for frame in 30: sound.update(state, true, 1.0 / 120)
		check(sound.horn.playing and sound.horn_gain > 0.99, id + " held horn must sound")
		state.horn = false
		for frame in 30: sound.update(state, true, 1.0 / 120)
		check(sound.horn_gain < 0.0001, id + " released horn must fade out")
		state.horn = true
		sound.set_suspended(true)
		check(sound.horn.stream_paused and sound.horn_gain == 0, id + " focus loss must silence horn")
		sound.set_suspended(false)
		for frame in 30: sound.update(state, false, 1.0 / 120)
		check(sound.horn_gain < 0.0001, id + " pause must suppress held horn")
		state.horn = false
		if DisplayServer.get_name() != "headless":
			await get_tree().create_timer(2).timeout
			var recording = AudioEffectRecord.new()
			recording.format = AudioStreamWAV.FORMAT_16_BITS
			AudioServer.add_bus_effect(0, recording)
			recording.set_recording_active(true)
			await get_tree().create_timer(8).timeout
			recording.set_recording_active(false)
			var name = "idle_%s.wav" % id
			recording.get_recording().save_to_wav("user://audio-plate-qa/" + name)
			report.recordings.append(name)
			AudioServer.remove_bus_effect(0, AudioServer.get_bus_effect_count(0) - 1)
		sound.queue_free()
		sound = null
		view.queue_free()
		await get_tree().process_frame
	var file = FileAccess.open("user://audio-plate-qa/report.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report))
	print(("AUDIO_PLATE_PASS " if report.failures.is_empty() else "AUDIO_PLATE_FAILED ") + JSON.stringify(report))
	get_tree().quit(0 if report.failures.is_empty() else 1)
