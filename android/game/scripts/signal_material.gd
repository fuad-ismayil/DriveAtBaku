extends RefCounted

static var shaders: Dictionary = {}

static func create(source: StandardMaterial3D, definition: Dictionary) -> ShaderMaterial:
	var transparent = source.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED
	var mode = "blend_mix,depth_prepass_alpha,cull_disabled" if transparent else "cull_disabled"
	var code = """shader_type spatial;
render_mode %s;
uniform vec4 tint : source_color = vec4(1.0);
uniform sampler2D color_texture : source_color,filter_linear_mipmap_anisotropic;
uniform bool has_texture = false;
uniform float roughness_value = 0.5;
uniform float metallic_value = 0.0;
uniform vec3 base_emission : source_color = vec3(0.0);
uniform float emission_level = 0.0;
uniform float reverse_level = 0.0;
uniform vec2 signal_levels = vec2(0.0);
uniform mat4 to_vehicle;
varying vec3 signalPosition;
varying vec3 lampPosition;
void vertex(){ lampPosition = VERTEX; signalPosition = (to_vehicle * vec4(VERTEX, 1.0)).xyz; }
void fragment(){
 vec4 color = tint;
 if(has_texture){color *= texture(color_texture, UV);}
 float region = %s;
 float level = region * (signalPosition.x < 0.0 ? signal_levels.x : signal_levels.y);
 ALBEDO = mix(color.rgb, vec3(1.0, 0.23, 0.008), level * 0.85);
 ROUGHNESS = roughness_value;
 METALLIC = metallic_value;
 vec3 lamp = base_emission * emission_level * (%s);
 lamp += vec3(2.4, 2.75, 3.1) * reverse_level * (%s);
 EMISSION = mix(lamp * (1.0 - (%s)), vec3(4.0, 0.48, 0.008), level);
 %s
}
""" % [mode, definition.get("mask", "0.0"), definition.get("emission_mask", "1.0"), definition.get("reverse_mask", "1.0"), definition.get("rest_mask", "0.0"), "ALPHA = max(color.a, level * 0.98);" if transparent else ""]
	var material = ShaderMaterial.new()
	if not shaders.has(code):
		var shader = Shader.new()
		shader.code = code
		shaders[code] = shader
	material.shader = shaders[code]
	material.resource_name = source.resource_name
	material.set_shader_parameter("tint", source.albedo_color)
	material.set_shader_parameter("has_texture", source.albedo_texture != null)
	if source.albedo_texture: material.set_shader_parameter("color_texture", source.albedo_texture)
	material.set_shader_parameter("roughness_value", source.roughness)
	material.set_shader_parameter("metallic_value", source.metallic)
	material.set_shader_parameter("base_emission", source.emission)
	material.set_shader_parameter("emission_level", source.emission_energy_multiplier if source.emission_enabled else 0.0)
	if definition.has("color"):
		var color = definition.color
		material.set_shader_parameter("base_emission", Color(color[0], color[1], color[2]).linear_to_srgb())
	var m = definition.get("to_vehicle", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
	material.set_shader_parameter("to_vehicle", Transform3D(Basis(Vector3(m[0], m[1], m[2]), Vector3(m[4], m[5], m[6]), Vector3(m[8], m[9], m[10])), Vector3(m[12], m[13], m[14])))
	return material
