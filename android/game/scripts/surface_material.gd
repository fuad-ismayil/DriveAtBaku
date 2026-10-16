extends RefCounted

static func create(source: StandardMaterial3D, path: String) -> ShaderMaterial:
	var material = ShaderMaterial.new()
	material.shader = load(path)
	material.resource_name = source.resource_name
	material.set_shader_parameter("tint", source.albedo_color)
	material.set_shader_parameter("has_texture", source.albedo_texture != null)
	if source.albedo_texture: material.set_shader_parameter("color_texture", source.albedo_texture)
	material.set_shader_parameter("uv_scale", Vector2(source.uv1_scale.x, source.uv1_scale.y))
	material.set_shader_parameter("uv_offset", Vector2(source.uv1_offset.x, source.uv1_offset.y))
	material.set_shader_parameter("roughness_value", source.roughness)
	material.set_shader_parameter("metallic_value", source.metallic)
	return material

static func is_road(name: String) -> bool:
	var regex = RegEx.new()
	regex.compile("(?i)^(ROAD_(AZER|OFFTRACK_[AB])|BAK_OFFTRACK_B|ROADA_([0-9]+|MAIN))(-|$)")
	return regex.search(name) != null
