extends Node3D

var failures: Array[String] = []
var report: Dictionary = {"captures": [], "checks": 0}
var camera = Camera3D.new()

func check(value: bool, message: String):
	report.checks += 1
	if not value:
		failures.append(message)
		push_error(message)

func _ready():
	var saved = Preferences.values.duplicate(true)
	Preferences.values.weather = "sunny"
	add_child(camera)
	camera.current = true
	camera.fov = 48
	var world = WorldEnvironment.new()
	world.environment = Environment.new()
	world.environment.background_mode = Environment.BG_COLOR
	world.environment.background_color = Color(0.035, 0.045, 0.06)
	world.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	world.environment.ambient_light_color = Color(0.5, 0.6, 0.75)
	world.environment.ambient_light_energy = 0.5
	add_child(world)
	var light = DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-55, -30, 0)
	light.light_energy = 0.6
	add_child(light)
	var floor_mesh = MeshInstance3D.new()
	floor_mesh.mesh = PlaneMesh.new()
	floor_mesh.mesh.size = Vector2(100, 100)
	var road = StandardMaterial3D.new()
	road.albedo_color = Color(0.23, 0.25, 0.27)
	road.roughness = 0.95
	floor_mesh.material_override = road
	add_child(floor_mesh)
	var profiles = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/vehicles.json"))
	var metadata = JSON.parse_string(FileAccess.get_file_as_string("res://assets/vehicles/metadata.json"))
	var state = {"wheels": [], "gear": 1, "brake_force": 0.0, "velocity": Vector3.ZERO}
	for i in 4: state.wheels.append({"steer": 0, "spin": 0, "compression": 0})
	for id in ["ferrari", "elantra", "amg", "prado"]:
		var view = preload("res://scripts/vehicle_view.gd").new()
		add_child(view)
		check(await view.load_vehicle(id), "Vehicle import failed: " + id)
		check(view.signal_materials.size() >= metadata[id].lights.size(), "Light definitions lost: " + id)
		for mode in ["off", "low", "high", "brake", "reverse"]:
			view.headlight_mode = {"off": 0, "low": 1, "high": 2, "brake": 1, "reverse": 0}[mode]
			state.brake_force = 1.0 if mode == "brake" else 0.0
			state.gear = 0 if mode == "reverse" else 1
			view.animate(state, 1.0 / 30, 100)
			for item in view.signal_materials:
				var roles = item.definition.get("roles", [])
				if roles.is_empty(): continue
				var level = float(item.material.get_shader_parameter("emission_level"))
				if "brake" in roles:
					check(is_equal_approx(level, 3.6 if mode == "brake" else (0.72 if view.headlight_mode > 0 else 0.3)), id + " brake/tail response")
				if "headlight" in roles:
					var enabled = view.headlight_mode > 0 and (not item.definition.high_only or mode == "high")
					check(level > 0 if enabled else level == 0, id + " headlight mode")
				check(item.material not in view.water.materials, id + " water replaced animated lamp")
			await capture(id + "_" + mode + "_rear", Vector3(0, 1.35, 5.4), Vector3(0, 0.75, 0.9))
			if mode in ["off", "low", "high"]: await capture(id + "_" + mode + "_front", Vector3(0, 1.35, -5.4), Vector3(0, 0.75, -0.9))
		view.queue_free()
		await get_tree().process_frame
	# The same network state must select the same load/shift targets as its owner.
	var mix = preload("res://scripts/engine_mix.gd")
	for id in profiles:
		for rpm in [profiles[id].idleRpm, 3000, profiles[id].redlineRpm]:
			for load in [0.0, 0.4, 1.0]:
				for shift in [0.0, 0.1]:
					var wire = {"rpm": rpm, "gr": 3, "au": {"ld": load, "sh": shift, "ac": 4.0}, "in": {"th": 0.2}}
					var remote = mix.targets(mix.from_wire(wire, wire, 0), profiles[id])
					var local = mix.targets({"rpm": rpm, "engine_load": load, "shift_timer": shift, "acceleration": 4}, profiles[id])
					check(remote == local, id + " authoritative remote engine mix")
	var effects = preload("res://scripts/tire_effects.gd").new()
	add_child(effects)
	var wheel = {"grounded": true, "load": 1000.0, "normal": Vector3.UP, "surface_mu": 1.0, "slip": 16.0, "steer": 0.0, "contact": [0, 0, 0]}
	var tire_state = {"wheels": [wheel], "rotation": Quaternion.IDENTITY, "velocity": Vector3(0, 0, -8)}
	for i in 150:
		wheel.contact = [0, i * 0.09, 0]
		effects.update(tire_state, profiles.ferrari, 1.0 / 60, true)
	check(effects.emitted_marks > 100 and effects.emitted_smoke > 4, "Real contact/slip must emit marks and smoke")
	report.tires = {"marks": effects.emitted_marks, "smoke": effects.emitted_smoke}
	await capture("tire_marks_smoke", Vector3(1.5, 1.3, -12.8), Vector3(0, 0.1, -12))
	var count = effects.emitted_marks
	var smoke_count = effects.emitted_smoke
	wheel.grounded = false
	for i in 30: effects.update(tire_state, profiles.ferrari, 1.0 / 60, true)
	check(effects.emitted_marks == count and effects.emitted_smoke == smoke_count, "Airborne tires must not emit")
	wheel.grounded = true
	Preferences.values.weather = "rain"
	for i in 150:
		wheel.contact = [0, 14 + i * 0.09, 0]
		effects.update(tire_state, profiles.ferrari, 1.0 / 60, true)
	check(effects.emitted_smoke == smoke_count, "Wet road must suppress dry tire smoke")
	effects.reset_tracks()
	wheel.contact = [1000, 1000, 0]
	count = effects.emitted_marks
	effects.update(tire_state, profiles.ferrari, 1.0 / 60, true)
	check(effects.emitted_marks == count, "Recovery must break tire trails")
	var session = preload("res://scripts/multiplayer.gd").new()
	add_child(session)
	# Model a failed handshake already CLOSED before its first process tick.
	# OS connection-refusal timing differs; the lifecycle case is deterministic.
	session.active = true
	session._process(0)
	check(session.reconnect_attempts == 1 and session.reconnect_at > 0 and session.active, "A connection closed before its first poll must retry")
	session.disconnect_from_relay()
	check(not session.active and session.reconnect_at == 0, "Leaving must cancel retries")
	session.queue_free()
	Preferences.values = saved
	report.failures = failures
	DirAccess.make_dir_recursive_absolute("user://feature-qa")
	var file = FileAccess.open("user://feature-qa/report.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report))
	print("NATIVE_FEATURES_PASS " + JSON.stringify(report) if failures.is_empty() else "NATIVE_FEATURES_FAILED " + JSON.stringify(failures))
	get_tree().quit(0 if failures.is_empty() else 1)

func capture(name: String, position: Vector3, target: Vector3):
	if DisplayServer.get_name() == "headless": return
	camera.position = position
	camera.look_at(target)
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute("user://feature-qa")
	get_viewport().get_texture().get_image().save_png("user://feature-qa/%s.png" % name)
	report.captures.append(name)
