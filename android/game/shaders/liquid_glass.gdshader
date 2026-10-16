shader_type canvas_item;
render_mode unshaded;

// One scene copy beneath the interface, shared by every lens. No mipmap blur.
uniform sampler2D scene : hint_screen_texture, repeat_disable, filter_linear;
uniform vec2 lens_size = vec2(400.0, 200.0);
uniform float radius = 30.0;
uniform float density = 0.26;
uniform bool detailed = false;
varying vec2 local_position;

void vertex() { local_position = VERTEX; }

void fragment() {
	vec2 half_size = lens_size * 0.5;
	float r = min(radius, min(half_size.x, half_size.y));
	vec2 p = local_position - half_size;
	vec2 q = abs(p) - half_size + r;
	float distance_to_edge = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
	float mask = 1.0 - smoothstep(-0.6, 0.7, distance_to_edge);
	vec2 normal = normalize(p / max(half_size, vec2(1.0)) + vec2(0.0001));
	float bevel = exp(-abs(distance_to_edge) / 5.0);
	vec2 sample_uv = SCREEN_UV + normal * bevel * SCREEN_PIXEL_SIZE * 2.2;
	vec3 background = texture(scene, sample_uv).rgb;
	if (detailed) {
		vec2 d = SCREEN_PIXEL_SIZE * 1.2;
		background = background * 0.6 + (texture(scene, sample_uv + vec2(d.x, 0)).rgb + texture(scene, sample_uv - vec2(d.x, 0)).rgb + texture(scene, sample_uv + vec2(0, d.y)).rgb + texture(scene, sample_uv - vec2(0, d.y)).rgb) * 0.1;
	}
	float top_light = pow(clamp(1.0 - local_position.y / lens_size.y, 0.0, 1.0), 3.0);
	float rim = exp(-abs(distance_to_edge + 1.0) * 1.45);
	float glint = 0.25 + 0.65 * abs(dot(normal, normalize(vec2(-0.7, -1.0))));
	float luminance = dot(background, vec3(0.2126, 0.7152, 0.0722));
	float readable_density = min(0.97, density + 0.26 * smoothstep(0.24, 0.75, luminance));
	vec3 glass = background * (1.0 - readable_density) + vec3(0.018, 0.022, 0.024) * readable_density;
	glass += vec3(top_light * 0.065 + bevel * 0.022 + rim * glint * 0.38);
	COLOR = vec4(glass, mask) * COLOR;
}
