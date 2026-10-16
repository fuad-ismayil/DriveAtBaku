extends Node3D

const VehicleView = preload("res://scripts/vehicle_view.gd")
const Interface = preload("res://scripts/interface.gd")
const Multiplayer = preload("res://scripts/multiplayer.gd")
const EngineSound = preload("res://scripts/engine_audio.gd")
const IDS = ["ferrari", "elantra", "amg", "prado"]

var simulation
var interface = Interface.new()
var session = Multiplayer.new()
var sound = EngineSound.new()
var tire_effects = preload("res://scripts/tire_effects.gd").new()
var player = VehicleView.new()
var camera = Camera3D.new()
var environment = WorldEnvironment.new()
var sun = DirectionalLight3D.new()
var precipitation = CPUParticles3D.new()
var state: Dictionary = {}
var previous: Dictionary = {}
var vehicles: Dictionary = {}
var route: Dictionary = {}
var ready_to_drive = false
var is_driving = false
var switching = false
var camera_ready = false
var hood_camera = false
var camera_yaw = 0.0
var camera_pitch = 0.0
var camera_position = Vector3.ZERO
var camera_look = Vector3.ZERO
var camera_velocity = Vector3.ZERO
var look_velocity = Vector3.ZERO
var tracked_car = Vector3.ZERO
var camera_acceleration = 0.0
var camera_pullback = 0.0
var lighting_materials: Dictionary = {}
var world_meshes: Array = []
var remotes: Dictionary = {}
var indicator = {"mode": "off", "revision": 0, "epoch": 0.0}
var recovered_at = 0.0
var last_safe = Vector3.ZERO
var last_safe_heading = 0.0
var hud_elapsed = 0.0
var profile_elapsed = 0.0
var profile_frames: Array = []
var city_effects = preload("res://scripts/city_effects.gd").new()
var surface_materials: Dictionary = {}
var local_probe = ReflectionProbe.new()
var reflection_elapsed = 0.0

func _ready():
	add_child(interface)
	add_child(session)
	add_child(sound)
	add_child(tire_effects)
	add_child(player)
	add_child(camera)
	camera.current = true
	camera.near = 0.15
	camera.far = 3000
	_setup_environment()
	interface.requested.connect(_action)
	interface.vehicle_selected.connect(_select_vehicle)
	interface.setting_changed.connect(_setting_changed)
	session.welcomed.connect(_welcome)
	session.player_joined.connect(_remote_joined)
	session.player_left.connect(_remote_left)
	session.snapshot_received.connect(_snapshot)
	session.status_changed.connect(func(message):
		interface.update_network(message)
		if message == "OFFLINE" or message == "RECONNECTING" or message in ["SERVER FULL", "PROTOCOL MISMATCH", "CONNECTION REJECTED"]: _clear_remotes())
	player.loading_progress.connect(func(progress): interface.show_loading("Preparing your vehicle…", lerpf(0.70, 0.85, progress) if not ready_to_drive else progress))
	interface.show_loading("Preparing your drive…", 0.02)
	await get_tree().process_frame
	if not ClassDB.class_exists("NativeDriving"):
		interface.show_loading("The driving library could not start.", -1, true)
		return
	simulation = ClassDB.instantiate("NativeDriving")
	vehicles = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/vehicles.json"))
	route = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/route.json"))
	interface.show_loading("Preparing Baku streets…", 0.05)
	for asset in ["baku", "buildings"]:
		var path = "res://assets/world/%s.glb" % asset
		if ResourceLoader.load_threaded_request(path) != OK:
			interface.show_loading("Could not prepare the city streets.", -1, true)
			return
		while ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
			var progress: Array = []
			ResourceLoader.load_threaded_get_status(path, progress)
			var base = 0.05 if asset == "baku" else 0.35
			interface.show_loading("Preparing %s…" % ("Baku streets" if asset == "baku" else "the skyline"), base + float(progress[0] if not progress.is_empty() else 0) * 0.28)
			await get_tree().process_frame
		if ResourceLoader.load_threaded_get_status(path) != ResourceLoader.THREAD_LOAD_LOADED:
			interface.show_loading("The city could not finish loading.", -1, true)
			return
		var resource = ResourceLoader.load_threaded_get(path)
		if resource == null:
			interface.show_loading("The %s scene could not be loaded." % asset, -1, true)
			return
		var city = resource.instantiate()
		add_child(city)
		for mesh in city.find_children("*", "MeshInstance3D", true, false):
			mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mesh.visibility_range_end = Preferences.values.render_distance
			mesh.visibility_range_end_margin = 100
			mesh.lod_bias = 0.8
			world_meshes.append(mesh)
			for surface in mesh.mesh.get_surface_count():
				var material = mesh.get_active_material(surface)
				if material is StandardMaterial3D and not lighting_materials.has(material.get_instance_id()):
					lighting_materials[material.get_instance_id()] = {"material": material, "color": material.albedo_color, "roughness": material.roughness}
		await get_tree().process_frame
	interface.show_loading("Preparing road contact and suspension…", 0.65)
	await get_tree().process_frame
	if not simulation.load_world("res://assets/world/collisions.bin"):
		interface.show_loading("The road contact data could not be loaded.", -1, true)
		return
	_setup_occlusion()
	if not await _select_vehicle(Preferences.values.vehicle): return
	interface.show_loading("Preparing city windows and flag…", 0.86)
	add_child(city_effects)
	await city_effects.setup()
	interface.show_loading("Setting the atmosphere…", 0.96)
	await get_tree().process_frame
	_setup_surface_materials()
	_apply_graphics()
	_apply_weather()
	ready_to_drive = true
	_reset_at(_from_wire(route.spawn), route.heading)
	interface.show_menu()
	print("NATIVE_READY vehicle=%s world_meshes=%d" % [player.vehicle_id, world_meshes.size()])
	if "--smoke-test" in OS.get_cmdline_user_args() or OS.has_feature("offline_verification"):
		await _smoke_test()

func _from_wire(value: Array) -> Vector3:
	return Vector3(float(value[0]), float(value[2]), -float(value[1]))

func _rotation_from_wire(value: Array) -> Quaternion:
	return Quaternion(float(value[0]), float(value[2]), -float(value[1]), float(value[3])).normalized()

func _reset_at(position: Vector3, heading: float):
	simulation.reset(IDS.find(Preferences.values.vehicle), position, heading, Preferences.values.automatic)
	simulation.set_aids(Preferences.values.abs, Preferences.values.tcs, Preferences.values.esc)
	state = simulation.snapshot()
	previous = state.duplicate(true)
	camera_ready = false
	tire_effects.reset_tracks()
	interface.controls.clear()
	last_safe = position
	last_safe_heading = heading
	recovered_at = 0
	_present(1)

func _select_vehicle(id: String):
	if switching: return false
	switching = true
	var was_driving = is_driving
	var was_paused = interface.paused
	is_driving = false
	interface.show_loading("Preparing %s…" % Interface.VEHICLES.get(id, id), 0.0 if ready_to_drive else 0.70)
	await get_tree().process_frame
	var success = await player.load_vehicle(id)
	if success:
		Preferences.update("vehicle", id)
		player.paint(Preferences.values.paint)
		player.registration(Preferences.plate_settings())
		sound.setup(id, vehicles[id])
		indicator = {"mode": "off", "revision": 0, "epoch": session.server_time()}
		if ready_to_drive:
			_reset_at(player.position, state.get("heading", route.heading))
	else:
		push_error("Could not load native vehicle %s" % id)
	switching = false
	if ready_to_drive:
		if was_driving: _action("drive")
		else: interface.show_menu(was_paused, true)
	if not success: interface.show_loading("Your vehicle could not finish loading.", -1, true)
	return success

func _physics_process(dt):
	if not ready_to_drive or not is_driving or switching: return
	previous = state
	var input = interface.controls.sample(dt)
	simulation.advance(input, dt)
	state = simulation.snapshot()
	if state.position.y < -5 or not state.position.is_finite():
		_reset_at(last_safe, last_safe_heading)
		return
	if int(state.grounded) >= 3 and state.velocity.length() < 34:
		recovered_at += dt
		if recovered_at > 1.5:
			last_safe = state.position - state.rotation * Vector3(0, state.com_height, 0)
			last_safe_heading = state.heading
			recovered_at = 0

func _process(dt):
	if not ready_to_drive: return
	if OS.has_feature("debug") and profile_frames.size() < 600:
		profile_elapsed += dt
		profile_frames.append(dt * 1000)
		if profile_frames.size() == 600:
			var sorted = profile_frames.duplicate()
			sorted.sort()
			print("NATIVE_PROFILE " + JSON.stringify({"median_ms": sorted[300], "p95_ms": sorted[570], "draws": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), "triangles": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME), "texture_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED), "buffer_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED), "scale": get_viewport().scaling_3d_scale, "resolution": get_window().size.y}))
	_present(Engine.get_physics_interpolation_fraction() if is_driving else 1.0)
	_update_camera(minf(dt, 0.1))
	player.signal_mode = indicator.mode
	player.signal_epoch = indicator.epoch
	player.animate(state, dt, session.server_time())
	if not is_driving: state.horn = false
	sound.update(state, is_driving, dt)
	tire_effects.update(state, vehicles[player.vehicle_id], dt, is_driving)
	session.send_vehicle(state, player.position, player.vehicle_id, player.headlight_mode, indicator, dt)
	_update_remotes(dt)
	precipitation.position = camera.position + Vector3(0, 10, 0)
	city_effects.observer = camera.position
	reflection_elapsed += dt
	if reflection_elapsed > 5 and local_probe.position.distance_squared_to(player.position) > 60 * 60:
		local_probe.position = player.position + Vector3.UP * 2
		reflection_elapsed = 0
	hud_elapsed += dt
	if hud_elapsed > 0.1:
		hud_elapsed = 0
		interface.update_state(state, session.status, remotes.size() + 1)

func _present(alpha: float):
	if state.is_empty(): return
	var rotation: Quaternion = previous.get("rotation", state.rotation).slerp(state.rotation, alpha)
	player.quaternion = rotation
	player.position = previous.get("position", state.position).lerp(state.position, alpha) - rotation * Vector3(0, state.com_height, 0)

func _spring(current: Vector3, velocity: Vector3, target: Vector3, frequency: float, dt: float) -> Array:
	var difference = current - target
	var decay = exp(-frequency * dt)
	return [target + difference * ((1 + frequency * dt) * decay) + velocity * (dt * decay), velocity * ((1 - frequency * dt) * decay) + difference * (-frequency * frequency * dt * decay)]

func _update_camera(dt: float):
	var drag: Vector2 = interface.controls.camera_delta
	interface.controls.camera_delta = Vector2.ZERO
	camera_yaw -= drag.x * 0.004
	camera_pitch = clampf(camera_pitch + drag.y * 0.003, -0.3, 0.5)
	var return_blend = preload("res://scripts/camera_return.gd").blend(Vector2(state.velocity.x, state.velocity.z).length() * 3.6, dt, interface.controls.camera_drag != -1)
	camera_yaw = lerpf(camera_yaw, 0, return_blend)
	camera_pitch = lerpf(camera_pitch, 0, return_blend * 0.6)
	var forward = -player.basis.z
	forward.y = 0
	forward = forward.normalized()
	var speed_kmh = Vector2(state.velocity.x, state.velocity.z).length() * 3.6
	camera_acceleration = lerpf(camera_acceleration, clampf(state.acceleration, -10, 12), 1 - exp(-4 * dt))
	var kick = 1.55 * clampf((camera_acceleration - 0.8) / 5.2, 0, 1) * (1 - smoothstep(45, 155, speed_kmh))
	camera_pullback = lerpf(camera_pullback, kick, 1 - exp(-(5 if kick > camera_pullback else 1.6) * dt))
	var id = player.vehicle_id
	var distance = {"ferrari": 5.85, "elantra": 6.1, "amg": 6.35, "prado": 7.0}[id] + camera_pullback
	var height = (2.9 if id == "prado" else 2.35) + 0.1 * smoothstep(0, 150, speed_kmh) + 0.1 * clampf(absf(state.angular_velocity.y) / 1.2, 0, 1) + 0.08 * camera_pullback
	var desired = player.position - forward.rotated(Vector3.UP, camera_yaw) * distance + Vector3.UP * (height + sin(camera_pitch) * distance)
	desired.y = maxf(desired.y, simulation.road_height(desired + Vector3.UP * 6) + 1.2)
	var look = player.position + forward * (-0.45 if state.speed < -1.3 else 1.45) + Vector3.UP * (1.08 + 0.25 * camera_pitch)
	var movement = player.position - tracked_car
	if camera_ready and movement.length() < 25:
		camera_position += Vector3(movement.x, movement.y * 0.68, movement.z)
		camera_look += Vector3(movement.x, movement.y * 0.82, movement.z)
	else: camera_ready = false
	tracked_car = player.position
	if not camera_ready:
		camera_position = desired
		camera_look = look
		camera_velocity = Vector3.ZERO
		look_velocity = Vector3.ZERO
		camera_ready = true
	else:
		var position_spring = _spring(camera_position, camera_velocity, desired, 12, dt)
		camera_position = position_spring[0]
		camera_velocity = position_spring[1]
		var look_spring = _spring(camera_look, look_velocity, look, 16, dt)
		camera_look = look_spring[0]
		look_velocity = look_spring[1]
	if hood_camera:
		var hood = vehicles[id].get("hoodCamera", {"height": 1.15 if id == "elantra" else 0.88, "forward": 1.3 if id == "elantra" else 1.22})
		camera.position = player.position - player.basis.z * hood.forward + player.basis.y * hood.height
		camera.look_at(camera.position - player.basis.z * 12 + player.basis.y * 0.4, player.basis.y)
	else:
		camera.position = camera_position
		camera.look_at(camera_look)
	camera.fov = lerpf(camera.fov, 62 if hood_camera else 60 + 2 * smoothstep(0, 150, speed_kmh) + 1.2 * camera_pullback / 1.55, 1 - exp(-5 * dt))

func _action(action: String):
	if action == "retry":
		sound.shutdown()
		session.disconnect_from_relay()
		get_tree().reload_current_scene()
		return
	if action == "quit":
		Preferences.save()
		ready_to_drive = false
		city_effects.set_process(false)
		sound.shutdown()
		get_tree().quit()
		return
	if not ready_to_drive: return
	match action:
		"drive":
			is_driving = true
			interface.show_driving()
		"pause":
			is_driving = false
			interface.show_menu(true)
		"main_menu":
			is_driving = false
			session.disconnect_from_relay()
			_clear_remotes()
			interface.show_menu()
		"camera": hood_camera = not hood_camera
		"transmission":
			Preferences.update("automatic", not Preferences.values.automatic)
			simulation.set_automatic(Preferences.values.automatic)
			state = simulation.snapshot()
		"lights": player.headlight_mode = (player.headlight_mode + 1) % 3
		"signal_left", "signal_right", "signal_hazard":
			var mode = action.trim_prefix("signal_")
			indicator.mode = "off" if indicator.mode == mode else mode
			indicator.revision = (indicator.revision + 1) & 0xffffffff
			indicator.epoch = session.server_time()
			session.send_vehicle(state, player.position, player.vehicle_id, player.headlight_mode, indicator, 0, true)
		"restart":
			_reset_at(_from_wire(route.spawn), route.heading)
			_action("drive")
		"recover":
			var p = player.position
			p.y = simulation.road_height(p)
			_reset_at(p if p.y > -4 else last_safe, state.heading)
		"online":
			_clear_remotes()
			session.connect_to_relay(Preferences.values.server_url, Preferences.values.nickname)
			_action("drive")
		"disconnect":
			session.disconnect_from_relay()
			_clear_remotes()
			_action("pause")

func _setting_changed(key: String):
	interface.controls.clear()
	interface.controls._layout()
	if not ready_to_drive: return
	if key == "automatic": simulation.set_automatic(Preferences.values.automatic)
	if key in ["abs", "tcs", "esc"]: simulation.set_aids(Preferences.values.abs, Preferences.values.tcs, Preferences.values.esc)
	if key in ["quality", "resolution", "render_distance"]: _apply_graphics()
	if key in ["night", "weather"]: _apply_weather()
	if key == "paint": player.paint(Preferences.values.paint)
	if key.begins_with("plate_"): player.registration(Preferences.plate_settings())

func _setup_environment():
	add_child(environment)
	environment.environment = Environment.new()
	var env = environment.environment
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	var sky_material = ShaderMaterial.new()
	sky_material.shader = load("res://shaders/sky.gdshader")
	env.sky.sky_material = sky_material
	env.sky.radiance_size = Sky.RADIANCE_SIZE_128
	env.sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.67, 0.77, 0.88)
	env.ambient_light_energy = 0.4
	env.ambient_light_sky_contribution = 0.0
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.fog_enabled = true
	# The reference sky shader is not fogged. Godot otherwise fogs its infinite
	# distance completely, hiding clouds/stars behind a flat fog-color screen.
	env.fog_sky_affect = 0.0
	env.fog_density = 0.0008
	env.fog_light_color = Color(0.65, 0.76, 0.85)
	add_child(sun)
	sun.rotation_degrees = Vector3(-35, -55, 0)
	sun.light_energy = 0.8
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 80
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	add_child(precipitation)
	precipitation.amount = 600
	precipitation.lifetime = 1.5
	precipitation.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	precipitation.emission_box_extents = Vector3(18, 1, 18)
	precipitation.direction = Vector3(0.05, -1, 0)
	precipitation.spread = 4
	precipitation.gravity = Vector3(0, -6, 0)
	precipitation.initial_velocity_min = 12
	precipitation.initial_velocity_max = 18
	var quad = QuadMesh.new()
	quad.size = Vector2(0.018, 0.25)
	var material = StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = Color(0.74, 0.84, 0.96, 0.5)
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	quad.material = material
	precipitation.mesh = quad
	precipitation.emitting = false

func _setup_occlusion():
	var bytes = FileAccess.get_file_as_bytes("res://assets/world/occluders.bin")
	if bytes.is_empty() or bytes.size() % 36 != 0: return
	var vertices = PackedVector3Array()
	var indices = PackedInt32Array()
	vertices.resize(bytes.size() / 12)
	indices.resize(vertices.size())
	for i in vertices.size():
		vertices[i] = Vector3(bytes.decode_float(i * 12), bytes.decode_float(i * 12 + 4), bytes.decode_float(i * 12 + 8))
		indices[i] = i
	var instance = OccluderInstance3D.new()
	var occluder = ArrayOccluder3D.new()
	occluder.set_arrays(vertices, indices)
	instance.occluder = occluder
	add_child(instance)
	get_viewport().use_occlusion_culling = true

func _apply_graphics():
	var viewport = get_viewport()
	var display_height = float(get_window().size.y)
	viewport.scaling_3d_scale = minf(1.0, float(Preferences.values.resolution) / maxf(display_height, 1))
	viewport.msaa_3d = Viewport.MSAA_2X if Preferences.values.quality == "balanced" else Viewport.MSAA_DISABLED
	for mesh in world_meshes:
		mesh.visibility_range_end = Preferences.values.render_distance
	Engine.max_fps = 60

func _apply_weather():
	var night = Preferences.values.night
	var weather = Preferences.values.weather
	var env = environment.environment
	city_effects.set_night(night)
	env.tonemap_exposure = 1.1 if night else 0.97
	for item in surface_materials.values():
		if item.kind == "road":
			item.material.set_shader_parameter("wetness", 1.0 if weather in ["wet", "rain"] else (0.25 if weather == "snow" else 0.0))
			item.material.set_shader_parameter("rainfall", 1.0 if weather == "rain" else 0.0)
			item.material.set_shader_parameter("snow", 0.9 if weather == "snow" else 0.0)
		else: item.material.set_shader_parameter("night", 1.0 if night else 0.0)
	local_probe.position += Vector3(0.001, 0, 0)
	var preset_sun = {"sunny": 1.0, "overcast": 0.16, "wet": 0.55, "rain": 0.09, "snow": 0.12}[weather]
	var clouds = {"sunny": 0.0, "overcast": 0.94, "wet": 0.55, "rain": 0.97, "snow": 0.97}[weather]
	# Match the reference's relative weather changes. Godot's direct/ambient
	# energy scale is calibrated against captured Three.js views, not copied
	# numerically as though both renderers used the same light units.
	var lighting_scale = 0.42
	sun.light_energy = (0.60 if night else 2.75) * preset_sun * lighting_scale
	sun.light_color = Color("b4ccff") if night else Color("fff7ee")
	sun.basis = Basis.looking_at(-Vector3(270, 590, -190).normalized() if night else -Vector3(450, 310, -165).normalized())
	env.ambient_light_color = Color("99b9ee") if night else Color("d6e3ee")
	env.ambient_light_energy = ((0.46 if night else 0.65) + clouds * (0.1 if night else 0.42)) * lighting_scale
	local_probe.ambient_color = env.ambient_light_color
	local_probe.ambient_color_energy = env.ambient_light_energy
	var sky = env.sky.sky_material
	sky.set_shader_parameter("night", 1.0 if night else 0.0)
	sky.set_shader_parameter("cloudCover", clouds)
	var fog_colors = {"sunny": Color("b7c9d3"), "overcast": Color("aab7c3"), "wet": Color("aabcca"), "rain": Color("9baabb"), "snow": Color("c1cbd4")}
	var fog_density = {"sunny": 0.00014, "overcast": 0.00055, "wet": 0.00030, "rain": 0.00085, "snow": 0.00105}[weather]
	env.fog_light_color = Color("263b56") if night else fog_colors[weather]
	# Godot's exponential extinction differs from Three's squared distance fog.
	env.fog_density = fog_density * 0.35 * (1.25 if night else 1.0)
	precipitation.emitting = weather in ["rain", "snow"]
	precipitation.initial_velocity_min = 2 if weather == "snow" else 12
	precipitation.initial_velocity_max = 4 if weather == "snow" else 18
	precipitation.mesh.size = Vector2(0.065, 0.065) if weather == "snow" else Vector2(0.018, 0.25)
	for item in lighting_materials.values():
		var material = item.material
		var name = material.resource_name.to_lower()
		var ground = "road" in name or "tarmac" in name or "asphalt" in name
		material.albedo_color = item.color
		material.roughness = item.roughness
		if surface_materials.has(material.get_instance_id()): continue
		if ground and weather in ["wet", "rain"]:
			material.albedo_color = item.color.darkened(0.25)
			material.roughness = 0.16
		elif weather == "snow" and ground:
			material.albedo_color = item.color.lerp(Color(0.9, 0.93, 0.96), 0.55)

func _setup_surface_materials():
	var converter = preload("res://scripts/surface_material.gd")
	for mesh in world_meshes:
		for surface in mesh.mesh.get_surface_count():
			var source = mesh.get_active_material(surface)
			if not source is StandardMaterial3D: continue
			var key = source.get_instance_id()
			if not surface_materials.has(key):
				if converter.is_road(source.resource_name):
					surface_materials[key] = {"kind": "road", "material": converter.create(source, "res://shaders/road.gdshader")}
				elif city_effects.stats.houseMasks.has(source.resource_name):
					var material = converter.create(source, "res://shaders/government_house.gdshader")
					material.set_shader_parameter("house_surface", load("res://assets/world/%s" % city_effects.stats.houseMasks[source.resource_name]))
					surface_materials[key] = {"kind": "house", "material": material}
			if surface_materials.has(key): mesh.set_surface_override_material(surface, surface_materials[key].material)
	# One bounded, time-sliced capture shared by cars and wet asphalt. Static
	# geometry only; the player's own mesh is excluded from its reflection.
	local_probe.size = Vector3(240, 80, 240)
	local_probe.max_distance = 180
	local_probe.mesh_lod_threshold = 4
	local_probe.cull_mask = 1
	local_probe.enable_shadows = false
	local_probe.ambient_mode = ReflectionProbe.AMBIENT_COLOR
	local_probe.update_mode = ReflectionProbe.UPDATE_ONCE
	local_probe.blend_distance = 24
	local_probe.intensity = 0.85
	local_probe.position = _from_wire(route.spawn) + Vector3.UP * 2
	add_child(local_probe)

func _welcome(packet: Dictionary):
	_clear_remotes()
	var index = int(packet.get("spawnIndex", 0)) % 16
	var forward = Vector3(-sin(route.heading), 0, -cos(route.heading))
	var right = Vector3(cos(route.heading), 0, -sin(route.heading))
	_reset_at(_from_wire(route.spawn) + forward * (-floori(index / 2.0) * 8.5) + right * (-2.3 if index % 2 == 0 else 2.3), route.heading)
	for remote in packet.get("players", []):
		_remote_joined(remote)
		if remote.get("state") is Dictionary:
			_push_remote(str(remote.id), remote.state, float(packet.serverTime))

func _remote_joined(info: Dictionary):
	var id = str(info.get("id", ""))
	if id.is_empty() or id == session.own_id or remotes.has(id): return
	var root = Node3D.new()
	add_child(root)
	var label = Label3D.new()
	label.text = str(info.get("nick", "Player")).substr(0, 16)
	label.position.y = 2.2
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 48
	label.pixel_size = 0.008
	label.visibility_range_end = 150
	label.outline_size = 5
	root.add_child(label)
	var effects = preload("res://scripts/tire_effects.gd").new()
	add_child(effects)
	remotes[id] = {"root": root, "view": null, "audio": null, "effects": effects, "buffer": [], "loading": false, "vehicle": "", "label": label, "last_sequence": -1}

func _remote_left(id: String):
	if remotes.has(id):
		if is_instance_valid(remotes[id].audio): remotes[id].audio.shutdown()
		remotes[id].effects.queue_free()
		remotes[id].root.queue_free()
		remotes.erase(id)

func _clear_remotes():
	for id in remotes.keys(): _remote_left(id)

func _snapshot(packet: Dictionary):
	for id in packet.get("states", {}):
		var incoming = packet.states[id]
		if id == session.own_id:
			var light = incoming.get("li", {})
			if int(light.get("sigRev", -1)) == indicator.revision and light.get("sig", "off") == indicator.mode:
				indicator.epoch = light.get("sigAt", indicator.epoch)
		else:
			if not remotes.has(id): _remote_joined({"id": id, "nick": incoming.get("nick", "Player")})
			_push_remote(id, incoming, float(packet.ts))

func _push_remote(id: String, incoming: Dictionary, timestamp: float):
	if not remotes.has(id) or not incoming.get("p") is Array or not incoming.get("q") is Array: return
	var remote = remotes[id]
	var seq = int(incoming.get("seq", 0)) & 0xffffffff
	if remote.last_sequence >= 0:
		var delta = (seq - int(remote.last_sequence)) & 0xffffffff
		if delta == 0 or delta >= 0x80000000: return
	remote.last_sequence = seq
	var buffer: Array = remote.buffer
	if not buffer.is_empty() and _from_wire(incoming.p).distance_to(_from_wire(buffer[-1].state.p)) > 30:
		buffer.clear()
		remote.effects.reset_tracks()
	buffer.append({"state": incoming, "time": timestamp})
	if buffer.size() > 32: buffer.pop_front()
	if not remote.loading and remote.vehicle != str(incoming.get("cid", "ferrari")):
		_load_remote_vehicle(id, str(incoming.get("cid", "ferrari")))

func _load_remote_vehicle(id: String, vehicle_id: String):
	if not remotes.has(id): return
	var remote = remotes[id]
	remote.loading = true
	var view = VehicleView.new()
	view.detail_bias = 0.15
	remote.root.add_child(view)
	var success = await view.load_vehicle(vehicle_id)
	if not remotes.has(id) or remotes[id] != remote: return
	remote.loading = false
	if success:
		if is_instance_valid(remote.view): remote.view.queue_free()
		if is_instance_valid(remote.audio):
			remote.audio.shutdown()
			remote.audio.queue_free()
		remote.audio = null
		remote.effects.reset_tracks()
		remote.view = view
		remote.vehicle = vehicle_id
	else: view.queue_free()

func _update_remotes(dt: float):
	var target = session.server_time() - 120
	for remote in remotes.values():
		var buffer: Array = remote.buffer
		if buffer.is_empty(): continue
		while buffer.size() > 2 and buffer[1].time <= target: buffer.pop_front()
		var a = buffer[0]
		var b = buffer[1] if buffer.size() > 1 else a
		var alpha = clampf((target - a.time) / maxf(1, b.time - a.time), 0, 1)
		var p = _from_wire(a.state.p).lerp(_from_wire(b.state.p), alpha)
		if target > b.time and b.state.get("v") is Array:
			p = _from_wire(b.state.p) + _from_wire(b.state.v) * clampf((target - b.time) / 1000, 0, 0.15)
		remote.root.position = p
		remote.root.quaternion = _rotation_from_wire(a.state.q).slerp(_rotation_from_wire(b.state.q), alpha)
		var name_opacity = 1.0 - smoothstep(120.0, 150.0, remote.root.position.distance_to(camera.position))
		remote.label.modulate.a = name_opacity
		remote.label.outline_modulate.a = name_opacity
		if not is_instance_valid(remote.view): continue
		var incoming = buffer[-1].state
		remote.view.paint(str(incoming.get("col", "#a80719")))
		remote.view.headlight_mode = int(incoming.get("li", {}).get("head", 0))
		remote.view.signal_mode = str(incoming.get("li", {}).get("sig", "off"))
		remote.view.signal_epoch = float(incoming.get("li", {}).get("sigAt", 0))
		if incoming.get("plt") is Dictionary: remote.view.registration(incoming.plt)
		var wheel_states: Array = []
		for wheel in incoming.get("w", []):
			wheel_states.append({"steer": wheel.get("st", 0), "spin": wheel.get("rot", 0), "compression": 0, "slip": wheel.get("sl", 0), "grounded": bool(wheel.get("c", 0))})
		while wheel_states.size() < 4: wheel_states.append({"steer": 0, "spin": 0, "compression": 0, "slip": 0, "grounded": false})
		remote.view.animate({"wheels": wheel_states, "gear": incoming.get("gr", 1), "brake_force": 1.0 if incoming.get("li", {}).get("brake", 0) else incoming.get("in", {}).get("br", 0), "handbrake": bool(incoming.get("in", {}).get("hb", 0)), "velocity": _from_wire(incoming.get("v", [0, 0, 0]))}, dt, session.server_time())
		var distance = p.distance_to(camera.position)
		var fresh = session.server_time() - buffer[-1].time < 1500
		if distance < 105 and not is_instance_valid(remote.audio):
			remote.audio = EngineSound.new()
			remote.root.add_child(remote.audio)
			remote.audio.setup(remote.vehicle, vehicles[remote.vehicle])
		if is_instance_valid(remote.audio):
			var envelope = 1 - smoothstep(5, 105, distance)
			remote.audio.spatial_gain = 0.42 * envelope * envelope
			remote.audio.spatial_pan = clampf((p - camera.position).dot(camera.global_basis.x) / 25, -1, 1)
			var audio_state = preload("res://scripts/engine_mix.gd").from_wire(a.state, b.state, alpha)
			if a.state.get("cid") != remote.vehicle or b.state.get("cid") != remote.vehicle:
				audio_state = preload("res://scripts/engine_mix.gd").from_wire(incoming, incoming, 0)
			# Horn edges follow the latest packet, independently of movement interpolation.
			audio_state.horn = bool(incoming.get("in", {}).get("hn", 0))
			remote.audio.update(audio_state, session.joined and fresh and distance < 105 and incoming.get("cid") == remote.vehicle, dt)
		var effect_wheels: Array = []
		for wheel in incoming.get("w", []):
			var contact = wheel.get("cp")
			effect_wheels.append({"grounded": bool(wheel.get("c", 0)) and contact is Array, "contact": contact if contact is Array else [0, 0, 0], "steer": wheel.get("st", 0), "slip": wheel.get("sl", 0), "load": 220 if wheel.get("sk", 0) else 0, "normal": _from_wire(wheel.n).normalized() if wheel.get("n") is Array else Vector3.UP, "surface_mu": 1.0})
		remote.effects.update({"wheels": effect_wheels, "velocity": _from_wire(incoming.get("v", [0, 0, 0])), "rotation": remote.root.quaternion}, vehicles[remote.vehicle], dt, fresh and distance < 150)

func _notification(what):
	if what in [NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED]:
		sound.set_suspended(true)
		for remote in remotes.values():
			if is_instance_valid(remote.audio): remote.audio.set_suspended(true)
		is_driving = false
		if is_instance_valid(interface) and interface.is_inside_tree():
			interface.controls.clear()
			if ready_to_drive and interface.driving: interface.show_menu(true)
	elif what in [NOTIFICATION_APPLICATION_FOCUS_IN, NOTIFICATION_APPLICATION_RESUMED]:
		sound.set_suspended(false)
		for remote in remotes.values():
			if is_instance_valid(remote.audio): remote.audio.set_suspended(false)
	elif what == NOTIFICATION_WM_GO_BACK_REQUEST:
		if is_driving: _action("pause")
		else: interface.back()
	elif what == NOTIFICATION_WM_CLOSE_REQUEST:
		_action("quit")

func _smoke_test():
	var saved = Preferences.values.duplicate(true)
	var results: Array = []
	for id in IDS:
		await _select_vehicle(id)
		if player.vehicle_id != id:
			push_error("NATIVE_SMOKE_FAILED vehicle import: %s" % id)
			Preferences.values = saved
			Preferences.save()
			get_tree().quit(1)
			return
		_reset_at(_from_wire(route.spawn), route.heading)
		var start: Vector3 = state.position
		for i in 600:
			simulation.advance({"throttle": 0.5, "brake": 0.0, "steer": 0.0}, 1.0 / 120)
		state = simulation.snapshot()
		results.append({"vehicle": id, "distance": state.position.distance_to(start), "speed": state.speed, "gear": state.gear, "grounded": state.grounded, "finite": state.position.is_finite()})
		if not state.position.is_finite() or state.speed < 1 or state.gear < 2:
			push_error("NATIVE_SMOKE_FAILED %s" % id)
			Preferences.values = saved
			Preferences.save()
			get_tree().quit(1)
			return
	print("NATIVE_SMOKE_PASS " + JSON.stringify(results))
	ready_to_drive = false
	city_effects.set_process(false)
	Preferences.values = saved
	Preferences.save()
	sound.shutdown()
	await get_tree().create_timer(0.1).timeout
	get_tree().quit()
