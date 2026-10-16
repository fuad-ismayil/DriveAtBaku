shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D color_texture : source_color, filter_linear_mipmap;
uniform vec4 tint : source_color = vec4(1.0);
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform float night = 0.0;

void fragment() {
	vec4 lights = texture(color_texture, UV * uv_scale + uv_offset) * tint;
	if (night < 0.01 || lights.a < 0.02) { discard; }
	ALBEDO = lights.rgb * 1.25;
	ALPHA = lights.a * night * 0.7;
}
