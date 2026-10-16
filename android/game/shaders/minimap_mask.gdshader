shader_type canvas_item;
render_mode unshaded;

uniform vec2 map_size = vec2(144.0);
varying vec2 map_position;

void vertex() { map_position = VERTEX; }

void fragment() {
	float radius = min(map_size.x, map_size.y) * 0.5;
	float edge = length(map_position - map_size * 0.5) - radius;
	COLOR.a *= 1.0 - smoothstep(-0.8, 0.2, edge);
}
