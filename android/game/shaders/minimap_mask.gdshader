shader_type canvas_item;
render_mode unshaded;

uniform vec2 map_size = vec2(144.0);
uniform vec4 map_rect = vec4(0.0, 0.0, 1.0, 1.0);

void fragment() {
	float radius = min(map_size.x, map_size.y) * 0.5;
	vec2 map_position = (SCREEN_UV - map_rect.xy) / map_rect.zw * map_size;
	float edge = length(map_position - map_size * 0.5) - radius;
	COLOR.a *= 1.0 - smoothstep(-0.8, 0.2, edge);
}
