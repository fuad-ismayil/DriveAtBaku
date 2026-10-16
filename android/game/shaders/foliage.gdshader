shader_type spatial;
render_mode cull_disabled, diffuse_lambert_wrap, specular_disabled;

uniform sampler2D color_texture : source_color, filter_linear_mipmap_anisotropic;
uniform vec4 tint : source_color = vec4(1.0);
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform float snow = 0.0;

void fragment() {
	vec4 leaf = texture(color_texture, UV * uv_scale + uv_offset) * tint;
	ALBEDO = mix(leaf.rgb, vec3(0.76, 0.82, 0.85), snow * 0.42);
	ALPHA = leaf.a;
	ALPHA_SCISSOR_THRESHOLD = 0.38;
	ROUGHNESS = 0.95;
	METALLIC = 0.0;
	SPECULAR = 0.0;
	// Crossed cards need the same diffuse response on both visible sides.
	if (!FRONT_FACING) { NORMAL = -NORMAL; }
	BACKLIGHT = leaf.rgb * 0.08;
}
