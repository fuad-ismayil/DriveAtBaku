extends Node3D

var room_root = Node3D.new()
var activity: RefCounted
var room_material = ShaderMaterial.new()
var state_texture: ImageTexture
var frame_material = StandardMaterial3D.new()
var flag_material = StandardMaterial3D.new()
var flag = MeshInstance3D.new()
var cloth
var flag_arrays: Array = []
var flag_elapsed = 0.0
var room_elapsed = 0.0
var night = false
var observer = Vector3.ZERO
var room_count = 0
var stats: Dictionary = {}

func setup():
	stats = JSON.parse_string(FileAccess.get_file_as_string("res://assets/world/effects.json"))
	add_child(room_root)
	var bytes = FileAccess.get_file_as_bytes("res://assets/world/rooms.bin")
	room_count = bytes.decode_u32(4)
	activity = preload("res://scripts/room_activity.gd").new(room_count, randi())
	state_texture = ImageTexture.create_from_image(_state_image())
	var shader = Shader.new()
	shader.code = """shader_type spatial;
render_mode unshaded,blend_add,cull_disabled,depth_draw_never,shadows_disabled;
uniform sampler2D mask_texture : source_color,filter_linear_mipmap;
uniform sampler2D room_states : filter_nearest;
uniform float room_time = 0.0;
void fragment(){
 vec4 room=texture(room_states,UV2);
 float fade=smoothstep(0.0,1.0,(room_time-room.b)/max(room.a,.01));
 float level=mix(room.r,room.g,fade)*.55;
 if(level<.004){discard;}
 vec4 mask=texture(mask_texture,UV);
 ALBEDO=COLOR.rgb*mask.rgb;
 ALPHA=mask.a*level;
 if(ALPHA<.004){discard;}
}
"""
	room_material.shader = shader
	room_material.set_shader_parameter("mask_texture", load("res://assets/world/room-mask.png"))
	room_material.set_shader_parameter("room_states", state_texture)
	var offset = 12
	for chunk in bytes.decode_u32(8):
		var count = bytes.decode_u32(offset)
		offset += 4
		var vertices = PackedVector3Array()
		var uv = PackedVector2Array()
		var uv2 = PackedVector2Array()
		var colors = PackedColorArray()
		for i in count:
			vertices.append(Vector3(bytes.decode_float(offset), bytes.decode_float(offset + 4), bytes.decode_float(offset + 8)))
			uv.append(Vector2(bytes.decode_float(offset + 12), bytes.decode_float(offset + 16)))
			var id = int(bytes.decode_float(offset + 20))
			uv2.append(Vector2((id % 256 + 0.5) / 256.0, (floori(id / 256.0) + 0.5) / ceil(room_count / 256.0)))
			colors.append(Color(bytes.decode_float(offset + 24), bytes.decode_float(offset + 28), bytes.decode_float(offset + 32)))
			offset += 36
		var arrays: Array = []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = vertices
		arrays[Mesh.ARRAY_TEX_UV] = uv
		arrays[Mesh.ARRAY_TEX_UV2] = uv2
		arrays[Mesh.ARRAY_COLOR] = colors
		var instance = _mesh(arrays, room_material)
		instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		instance.visibility_range_end = 900
		room_root.add_child(instance)
		if chunk % 4 == 0: await get_tree().process_frame
	_setup_frames()
	_setup_flag()
	set_night(false)
	print("NATIVE_CITY_EFFECTS rooms=%d chunks=%d house_windows=%d flag_vertices=561" % [room_count, room_root.get_child_count(), stats.houseWindows])

func _state_image() -> Image:
	var data = activity.states.duplicate()
	data.resize(256 * int(ceil(room_count / 256.0)) * 4)
	return Image.create_from_data(256, int(ceil(room_count / 256.0)), false, Image.FORMAT_RGBAF, data.to_byte_array())

func _mesh(arrays: Array, material: Material) -> MeshInstance3D:
	var instance = MeshInstance3D.new()
	var mesh = ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, material)
	instance.mesh = mesh
	return instance

func _setup_frames():
	var bytes = FileAccess.get_file_as_bytes("res://assets/world/house-frames.bin")
	var vertices = PackedVector3Array()
	var normals = PackedVector3Array()
	var indices = PackedInt32Array()
	for i in bytes.size() / 24:
		vertices.append(Vector3(bytes.decode_float(i * 24), bytes.decode_float(i * 24 + 4), bytes.decode_float(i * 24 + 8)))
		normals.append(Vector3(bytes.decode_float(i * 24 + 12), bytes.decode_float(i * 24 + 16), bytes.decode_float(i * 24 + 20)))
		indices.append(i - i % 3 + ([0, 2, 1][i % 3]))
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = indices
	frame_material.albedo_color = Color("bab09a")
	frame_material.roughness = 0.9
	frame_material.emission = Color("ffb956")
	frame_material.emission_enabled = true
	add_child(_mesh(arrays, frame_material))

func _setup_flag():
	var group = Node3D.new()
	group.position = Vector3(stats.houseOrigin[0], 0, -stats.houseOrigin[1])
	group.rotation.y = stats.houseAngle
	add_child(group)
	var pole = MeshInstance3D.new()
	var cylinder = CylinderMesh.new()
	cylinder.top_radius = 0.075
	cylinder.bottom_radius = 0.14
	cylinder.height = 36
	cylinder.radial_segments = 12
	var metal = StandardMaterial3D.new()
	metal.albedo_color = Color("a9adb0")
	metal.metallic = 0.65
	metal.roughness = 0.4
	cylinder.material = metal
	pole.mesh = cylinder
	pole.position = Vector3(-0.6, 35, 32.5)
	group.add_child(pole)
	var finial = MeshInstance3D.new()
	var sphere = SphereMesh.new()
	sphere.radius = 0.19
	sphere.height = 0.38
	sphere.radial_segments = 10
	sphere.rings = 8
	sphere.material = metal
	finial.mesh = sphere
	finial.position = Vector3(-0.6, 53.1, 32.5)
	group.add_child(finial)
	flag_material.albedo_texture = load("res://assets/world/flag.png")
	flag_material.roughness = 0.94
	flag_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	flag_material.emission_enabled = true
	flag_material.emission_texture = flag_material.albedo_texture
	cloth = ClassDB.instantiate("NativeFlag")
	var sample = cloth.advance(0)
	flag_arrays.resize(Mesh.ARRAY_MAX)
	flag_arrays[Mesh.ARRAY_VERTEX] = sample.positions
	flag_arrays[Mesh.ARRAY_NORMAL] = sample.normals
	var uv = PackedVector2Array()
	var indices = PackedInt32Array()
	for row in 17:
		for col in 33:
			uv.append(Vector2(col / 32.0, row / 16.0))
			var i = row * 33 + col
			if row < 16 and col < 32: indices.append_array(PackedInt32Array([i, i + 1, i + 33, i + 33, i + 1, i + 34]))
	flag_arrays[Mesh.ARRAY_TEX_UV] = uv
	flag_arrays[Mesh.ARRAY_INDEX] = indices
	flag.mesh = ArrayMesh.new()
	flag.mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, flag_arrays)
	flag.material_override = flag_material
	flag.position = Vector3(-0.6, 52.7, 32.5)
	flag.extra_cull_margin = 8
	group.add_child(flag)

func set_night(enabled: bool):
	night = enabled
	room_root.visible = enabled
	frame_material.emission_energy_multiplier = 0.18 if enabled else 0
	flag_material.emission_energy_multiplier = 0.16 if enabled else 0

func _process(dt):
	if not is_instance_valid(activity): return
	if night:
		room_elapsed += dt
		if room_elapsed >= 0.1:
			if activity.update(room_elapsed):
				state_texture.update(_state_image())
			room_elapsed = 0
		room_material.set_shader_parameter("room_time", activity.time)
	if cloth != null and observer.distance_squared_to(flag.global_position) < 350 * 350:
		flag_elapsed += dt
		if flag_elapsed >= 1.0 / 30:
			var sample = cloth.advance(flag_elapsed)
			flag_arrays[Mesh.ARRAY_VERTEX] = sample.positions
			flag_arrays[Mesh.ARRAY_NORMAL] = sample.normals
			flag.mesh.clear_surfaces()
			flag.mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, flag_arrays)
			flag_elapsed = 0
