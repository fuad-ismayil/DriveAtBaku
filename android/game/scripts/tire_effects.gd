extends Node3D

# Web reference: src/tireEffects.js. Fixed-size instanced pools keep mobile
# rendering bounded; only physics contact, load, grip and slip create effects.
const MARK_LIMIT = 2048
const SMOKE_LIMIT = 72
var clock = 0.0
var cursor = 0
var smoke_cursor = 0
var emitted_marks = 0
var emitted_smoke = 0
var tracks: Array = []
var particles: Array = []
var marks = MultiMeshInstance3D.new()
var smoke = MultiMeshInstance3D.new()
var mark_material = ShaderMaterial.new()
var smoke_material = ShaderMaterial.new()

func _ready():
	for i in 4: tracks.append({"valid": false, "point": Vector3.ZERO, "normal": Vector3.UP, "side": Vector3.RIGHT, "heat": 0.0, "credit": 0.0})
	var plane = PlaneMesh.new()
	plane.size = Vector2.ONE
	_pool(marks, plane, MARK_LIMIT)
	_pool(smoke, QuadMesh.new(), SMOKE_LIMIT)
	mark_material.shader = load("res://shaders/tire_marks.gdshader")
	smoke_material.shader = load("res://shaders/tire_smoke.gdshader")
	marks.material_override = mark_material
	smoke.material_override = smoke_material
	for i in SMOKE_LIMIT: particles.append({"born": -100.0, "life": 1.0, "strength": 0.0, "seed": 0.0, "point": Vector3.ZERO, "drift": Vector3.ZERO})
	marks.multimesh.visible_instance_count = 0

func _pool(node: MultiMeshInstance3D, mesh: Mesh, limit: int):
	node.multimesh = MultiMesh.new()
	node.multimesh.transform_format = MultiMesh.TRANSFORM_3D
	node.multimesh.use_custom_data = true
	node.multimesh.mesh = mesh
	node.multimesh.instance_count = limit
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	node.layers = 4 # Exclude smoke/marks from the cached reflection probe.
	add_child(node)
	for i in limit: node.multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO), Vector3.ZERO))

func reset_tracks():
	for track in tracks:
		track.valid = false
		track.heat = 0.0
		track.credit = 0.0
	for particle in particles: particle.strength = 0.0

func update(state: Dictionary, vehicle: Dictionary, dt: float, driving: bool):
	clock += dt
	mark_material.set_shader_parameter("effect_time", clock)
	var weather = Preferences.values.weather
	var dry = 0.0 if weather in ["wet", "rain", "snow"] else 1.0
	var wheel_states = state.get("wheels", [])
	for i in 4:
		var track = tracks[i]
		var wheel = wheel_states[i] if i < wheel_states.size() else {}
		var normal: Vector3 = wheel.get("normal", Vector3.UP)
		var slip = float(wheel.get("slip", 0))
		if not driving or not wheel.get("grounded", false) or wheel.get("load", 0) < 150 or normal.y < 0.45 or wheel.get("surface_mu", 1) < 0.9 or slip < 2.5:
			track.valid = false
			track.heat = 0.0
			track.credit = 0.0
			continue
		var cp = wheel.contact
		var point = Vector3(cp[0], cp[2], -cp[1])
		var forward = state.rotation * Vector3(-sin(float(wheel.steer)), 0, -cos(float(wheel.steer)))
		var side = forward.cross(normal).normalized()
		var distance = track.point.distance_to(point)
		var continuous = track.valid and distance < maxf(2, state.velocity.length() * dt * 2 + 0.5) and normal.dot(track.normal) > 0.85
		if continuous and distance >= 0.075:
			var up = (normal + track.normal).normalized()
			var along = point - track.point
			along -= up * along.dot(up)
			var lateral = along.normalized().cross(up)
			var transform = Transform3D(Basis(lateral * vehicle.wheelWidth * 0.85, up, -along), (point + track.point) * 0.5 + up * 0.014)
			marks.multimesh.set_instance_transform(cursor, transform)
			marks.multimesh.set_instance_custom_data(cursor, Color(clock, clampf((slip - 2.5) / 11, 0, 1) * 0.38 * (0.4 + 0.6 * dry), 0, 0))
			cursor = (cursor + 1) % MARK_LIMIT
			emitted_marks += 1
			marks.multimesh.visible_instance_count = mini(emitted_marks, MARK_LIMIT)
		if not continuous or distance >= 0.075:
			track.point = point
			track.normal = normal
			track.side = side
		track.valid = true
		track.heat = minf(1, track.heat + dt)
		var strength = clampf((slip - 4.5) / 12, 0, 1) * dry
		if track.heat > 0.18 and strength > 0:
			track.credit += strength * 5 * dt
			if track.credit >= 1:
				track.credit = fmod(track.credit, 1)
				var seed = fmod(emitted_smoke * 0.618034, 1)
				particles[smoke_cursor] = {"born": clock, "life": 0.8 + seed * 0.35, "strength": 0.11 * strength, "seed": seed, "point": point + Vector3.UP * 0.09, "drift": Vector3(clampf(state.velocity.x * 0.035, -0.6, 0.6) + 0.06, 0.16 + seed * 0.08, clampf(state.velocity.z * 0.035, -0.6, 0.6))}
				smoke_cursor = (smoke_cursor + 1) % SMOKE_LIMIT
				emitted_smoke += 1
	var active_smoke = 0
	for i in SMOKE_LIMIT:
		var particle = particles[i]
		var age = clock - particle.born
		var life = age / particle.life
		if life >= 1 or particle.strength <= 0:
			smoke.multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO), Vector3.ZERO))
			continue
		active_smoke += 1
		var point = particle.point + particle.drift * age + Vector3(0.025 * sin(age * 3 + particle.seed * 12), 0.12 * age * age, 0)
		var radius = lerpf(0.14, 0.66, clampf(life, 0, 1))
		smoke.multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * radius), point))
		smoke.multimesh.set_instance_custom_data(i, Color(life, particle.strength, 0, 0))
	smoke.visible = active_smoke > 0
