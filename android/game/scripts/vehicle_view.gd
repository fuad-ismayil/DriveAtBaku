extends Node3D

signal loading_progress(progress: float)

const IDS = ["ferrari", "elantra", "amg", "prado"]
var vehicle_id = ""
var model: Node3D
var wheels: Array = []
var materials: Dictionary = {}
var headlight_mode = 0
var signal_mode = "off"
var signal_epoch = 0.0
var painted_color = ""
var lamps: Array = []
var signal_materials: Array = []
var plate_nodes: Array = []
var plate_lamps: Array = []
var plate_text = ""
var detail_bias = 0.55
var plate_builder: Node
var headlight_energy_scale = 1.0
var water = preload("res://scripts/vehicle_water.gd").new()
var load_timings: Dictionary = {}
var cache_limit = 0 # Local player keeps one previous car; peers retain no idle models.
var model_cache: Dictionary = {}
static var metadata: Dictionary = {}
static var vehicle_definitions: Dictionary = {}

func load_vehicle(id: String) -> bool:
	var started = Time.get_ticks_usec()
	load_timings = {}
	if id not in IDS: return false
	if vehicle_id == id and is_instance_valid(model):
		load_timings.cache_hit = true
		return true
	if model_cache.has(id):
		var cached: Dictionary = model_cache[id]
		model_cache.erase(id)
		_retire_model()
		for key in cached: set(key, cached[key])
		vehicle_id = id
		add_child(model)
		load_timings.cache_hit = true
		load_timings.assembly_ms = (Time.get_ticks_usec() - started) / 1000.0
		return true
	var path = "res://assets/vehicles/%s.glb" % id
	if ResourceLoader.load_threaded_request(path) != OK: return false
	while ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
		var progress: Array = []
		ResourceLoader.load_threaded_get_status(path, progress)
		loading_progress.emit(float(progress[0]) * 0.7 if not progress.is_empty() else 0.0)
		await get_tree().process_frame
	if ResourceLoader.load_threaded_get_status(path) != ResourceLoader.THREAD_LOAD_LOADED: return false
	loading_progress.emit(0.72)
	var packed = ResourceLoader.load_threaded_get(path)
	if packed == null: return false
	load_timings.resource_ms = (Time.get_ticks_usec() - started) / 1000.0
	var assembled = Time.get_ticks_usec()
	_retire_model()
	model = packed.instantiate()
	model.hide()
	add_child(model)
	load_timings.instantiate_ms = (Time.get_ticks_usec() - assembled) / 1000.0
	vehicle_id = id
	wheels.clear()
	materials.clear()
	painted_color = ""
	if metadata.is_empty(): metadata = JSON.parse_string(FileAccess.get_file_as_string("res://assets/vehicles/metadata.json"))
	if vehicle_definitions.is_empty(): vehicle_definitions = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/vehicles.json"))
	var definitions = {}
	var water_definitions = {}
	water = preload("res://scripts/vehicle_water.gd").new()
	for definition in metadata[id].get("water", []): water_definitions[definition.name] = definition
	signal_materials.clear()
	plate_nodes.clear()
	plate_lamps.clear()
	plate_text = ""
	for definition in metadata[id].get("indicators", []): definitions[definition.name] = definition
	for definition in metadata[id].get("lights", []):
		var combined: Dictionary = definitions.get(definition.name, {}).duplicate(true)
		combined.merge(definition, true)
		definitions[definition.name] = combined
	for i in metadata[id].wheels.size():
		var item = metadata[id].wheels[i].duplicate()
		item.steer_node = model.find_child("steer_%d" % i, true, false)
		item.spin_node = model.find_child("spin_%d" % i, true, false)
		wheels.append(item)
	for mesh in model.find_children("*", "MeshInstance3D", true, false):
		mesh.layers = 2
		mesh.lod_bias = detail_bias
		for surface in mesh.mesh.get_surface_count():
			var original = mesh.get_active_material(surface)
			if original == null: continue
			var key = original.resource_name
			if not materials.has(key):
				if definitions.has(key) and original is StandardMaterial3D:
					var signal_material = preload("res://scripts/signal_material.gd").create(original, definitions[key])
					materials[key] = signal_material
					signal_materials.append({"material": signal_material, "definition": definitions[key]})
				elif water_definitions.has(key) and original is StandardMaterial3D:
					materials[key] = water.create(original, water_definitions[key].glass)
				else: materials[key] = original.duplicate()
			mesh.set_surface_override_material(surface, materials[key])
	if not is_instance_valid(plate_builder):
		plate_builder = preload("res://scripts/license_plate.gd").new()
		add_child(plate_builder)
	for format in metadata[id].get("plate_mounts", {}):
		for name in metadata[id].plate_mounts[format]:
			var mount = model.find_child(name, true, false)
			if mount: plate_nodes.append({"node": mount, "format": format, "plate": null})
	for definition in metadata[id].get("plate_lights", []):
		var mount = model.find_child(definition.mount, true, false)
		if not mount: continue
		var light = SpotLight3D.new()
		light.name = "RegistrationPlateLamp"
		var p = definition.position
		var target = definition.target
		light.position = Vector3(p[0], p[1], p[2])
		light.basis = Basis.looking_at(Vector3(target[0], target[1], target[2]) - light.position)
		light.light_color = Color(definition.color[0], definition.color[1], definition.color[2]).linear_to_srgb()
		light.light_energy = 0
		light.light_cull_mask = 2
		light.spot_range = definition.range
		light.spot_angle = rad_to_deg(definition.angle)
		light.spot_attenuation = definition.decay
		light.spot_angle_attenuation = 1.0
		light.shadow_enabled = false
		mount.add_child(light)
		plate_lamps.append({"node": light, "energy": definition.energy})
	lamps.clear()
	for side in [-1, 1]:
		var light = SpotLight3D.new()
		var settings = vehicle_definitions[id]
		light.position = Vector3(side * 0.55, settings.get("headlightHeight", 0.77 if id == "elantra" else 0.6), -settings.dims.length * 0.43)
		light.spot_attenuation = 2.0
		light.light_color = Color("fff1d6")
		light.light_energy = 0
		light.shadow_enabled = false
		model.add_child(light)
		lamps.append(light)
	load_timings.assembly_ms = (Time.get_ticks_usec() - assembled) / 1000.0
	model.show()
	loading_progress.emit(1.0)
	return true

func _retire_model():
	if not is_instance_valid(model): return
	remove_child(model)
	if cache_limit > 0:
		var cached = {}
		for key in ["model", "wheels", "materials", "painted_color", "lamps", "signal_materials", "plate_nodes", "plate_lamps", "plate_text", "water"]:
			var value = get(key)
			cached[key] = value.duplicate() if value is Array or value is Dictionary else value
		model_cache[vehicle_id] = cached
		while model_cache.size() > cache_limit:
			var oldest = model_cache.keys()[0]
			model_cache[oldest].model.free()
			model_cache.erase(oldest)
	else: model.free()

func clear_model_cache():
	for cached in model_cache.values(): cached.model.free()
	model_cache.clear()

func _notification(what):
	if what == NOTIFICATION_OS_MEMORY_WARNING: clear_model_cache()

func _exit_tree():
	clear_model_cache()

func registration(settings: Dictionary):
	settings = preload("res://scripts/license_plate_settings.gd").normalize(settings)
	var key = JSON.stringify(settings)
	if key == plate_text: return
	plate_text = key
	for plate in plate_nodes:
		plate.node.visible = settings.get("enabled", true) and plate.format == settings.get("format", "long")
		if is_instance_valid(plate.plate): plate.plate.queue_free()
		plate.plate = null
		if plate.node.visible:
			plate.plate = plate_builder.create(settings)
			plate.node.add_child(plate.plate)

func paint(color: String):
	if color == painted_color: return
	painted_color = color
	for key in materials:
		if str(key).begins_with("native_paint"):
			if materials[key] is ShaderMaterial: materials[key].set_shader_parameter("tint", Color(color))
			else: materials[key].albedo_color = Color(color)

func animate(state: Dictionary, dt: float, clock_ms: float):
	if state.is_empty(): return
	water.update(self, state.get("velocity", Vector3.ZERO), dt)
	for wheel in wheels:
		var physical = state.wheels[int(wheel.index)]
		if is_instance_valid(wheel.steer_node):
			wheel.steer_node.rotation.y = lerpf(wheel.steer_node.rotation.y, float(physical.steer), 1 - exp(-12 * dt))
			wheel.steer_node.position.y = wheel.base_y + physical.compression - state.get("static_compression", 0.0)
		if is_instance_valid(wheel.spin_node):
			wheel.spin_node.rotation.x = float(physical.spin) * wheel.spin_direction
	var braking = float(state.get("brake_force", 0)) > 0.1 or state.get("handbrake", false)
	for lamp in plate_lamps:
		lamp.node.light_energy = lamp.energy if headlight_mode > 0 and lamp.node.is_visible_in_tree() else 0.0
	var reverse = int(state.get("gear", 1)) == 0
	var on = fmod(maxf(0, clock_ms - signal_epoch), 800) < 400
	var levels = Vector2(float(on and signal_mode in ["left", "hazard"]), float(on and signal_mode in ["right", "hazard"]))
	for item in signal_materials:
		item.material.set_shader_parameter("signal_levels", levels)
		var definition: Dictionary = item.definition
		var roles: Array = definition.get("roles", [])
		var emission = 0.0
		if "brake" in roles: emission = 3.6 if braking else (0.72 if headlight_mode > 0 else 0.3)
		elif "headlight" in roles:
			var enabled = headlight_mode > 0 and (not definition.get("high_only", false) or headlight_mode == 2)
			emission = (1.575 if headlight_mode == 1 else 2.775) * definition.get("scale", 1) if enabled else 0.0
		elif "reverse" in roles and not definition.get("reverse_overlay", false): emission = 2.5 if reverse else 0.0
		if not roles.is_empty(): item.material.set_shader_parameter("emission_level", emission)
		item.material.set_shader_parameter("reverse_level", 1.0 if reverse and definition.get("reverse_overlay", false) else 0.0)
	for light in lamps:
		var high = headlight_mode == 2
		light.light_energy = 0 if headlight_mode == 0 else (585.0 if high else 172.5) * headlight_energy_scale
		light.spot_range = 68 if high else 30
		light.spot_angle = rad_to_deg(0.24 if high else 0.36)
		light.spot_angle_attenuation = 0.8 if high else 0.65
		var target = Vector3(signf(light.position.x) * 0.22, -0.55 if high else -0.8, -56 if high else -24)
		light.basis = Basis.looking_at(target - light.position)
