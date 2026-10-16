extends Node

var failures: Array = []
var checks = 0

func check(condition: bool, message: String):
	checks += 1
	if not condition:
		failures.append(message)
		push_error(message)

# Real resource/geometry/audio benchmark, including reuse and isolation checks.
# Compare these results with a reference captured before applying the changes.
func _ready():
	call_deferred("run")

func run():
	var view = preload("res://scripts/vehicle_view.gd").new()
	view.cache_limit = 1
	var audio = preload("res://scripts/engine_audio.gd").new()
	add_child(view)
	add_child(audio)
	var definitions = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/vehicles.json"))
	var samples = []
	var selected_models: Dictionary = {}
	for id in ["ferrari", "elantra", "amg", "prado", "amg", "prado", "prado", "ferrari"]:
		var started = Time.get_ticks_usec()
		check(await view.load_vehicle(id), "Vehicle must load: " + id)
		var loaded = Time.get_ticks_usec()
		if view.load_timings.get("cache_hit", false):
			check(selected_models[id] == view.model.get_instance_id(), "Warm switch must reuse its prepared model")
		selected_models[id] = view.model.get_instance_id()
		view.paint("#a80719")
		view.registration(Preferences.plate_settings())
		var mounted = view.plate_nodes.filter(func(plate): return is_instance_valid(plate.plate))
		check(mounted.size() == 2, "Both registration plates must remain mounted")
		if mounted.size() == 2:
			var front_meshes = mounted[0].plate.find_children("*", "MeshInstance3D", true, false)
			var rear_meshes = mounted[1].plate.find_children("*", "MeshInstance3D", true, false)
			check(front_meshes[-1].mesh == rear_meshes[-1].mesh, "Front/rear lettering must share immutable geometry")
		var plated = Time.get_ticks_usec()
		audio.setup(id, definitions[id])
		var finished = Time.get_ticks_usec()
		check(audio._loop("horn-loop.wav") == audio.horn.stream, "Loop PCM must be reused without adding another boundary guard")
		check(audio.loop_cache.size() <= 12, "Shared PCM cache must remain bounded")
		samples.append({"vehicle": id, "model": view.load_timings.duplicate(), "view_ms": (loaded - started) / 1000.0, "plate_ms": (plated - loaded) / 1000.0, "audio_ms": (finished - plated) / 1000.0, "total_ms": (finished - started) / 1000.0})
		audio.shutdown()
		check(view.model_cache.size() <= 1, "Model cache must remain bounded")
		for cached in view.model_cache.values():
			check(not cached.model.is_inside_tree(), "Inactive car must not render or process")
		await get_tree().process_frame
	view.notification(Node.NOTIFICATION_OS_MEMORY_WARNING)
	check(view.model_cache.is_empty() and is_instance_valid(view.model) and view.model.is_inside_tree(), "Memory pressure must release inactive cars and preserve the current car")
	var current_model = view.model
	check(not await view.load_vehicle("invalid") and view.model == current_model, "Invalid selections must preserve the current car")
	var peer = preload("res://scripts/vehicle_view.gd").new()
	add_child(peer)
	check(await peer.load_vehicle("ferrari"), "Peer must still load independently")
	check(peer.model_cache.is_empty(), "Peers must not retain unused cars")
	check(view.water.materials[0] != peer.water.materials[0] and view.water.materials[0].shader == peer.water.materials[0].shader, "Shader reuse must preserve separate per-car material uniforms")
	view.paint("#123456")
	peer.paint("#abcdef")
	var paint_key = view.materials.keys().filter(func(key): return str(key).begins_with("native_paint"))[0]
	check(view.materials[paint_key].get_shader_parameter("tint") != peer.materials[paint_key].get_shader_parameter("tint"), "Local paint must never change a peer's paint")
	var report = {"passed": failures.is_empty(), "checks": checks, "failures": failures, "renderer": RenderingServer.get_current_rendering_method(), "samples": samples}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://../../artifacts/android"))
	FileAccess.open("res://../../artifacts/android/vehicle-switch-optimized.json", FileAccess.WRITE).store_string(JSON.stringify(report, "  "))
	print("NATIVE_VEHICLE_SWITCH ", JSON.stringify(report))
	view.queue_free()
	audio.queue_free()
	peer.queue_free()
	await get_tree().create_timer(0.15).timeout # Allow the audio mixer to retire stopped playbacks.
	get_tree().quit(0 if failures.is_empty() else 1)
