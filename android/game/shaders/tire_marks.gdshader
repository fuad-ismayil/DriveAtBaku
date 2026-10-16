shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled;
uniform float effect_time = 0.0;
varying vec2 mark;
void vertex() { mark = INSTANCE_CUSTOM.rg; }
void fragment() {
 float edge = smoothstep(0.0, 0.16, UV.x) * smoothstep(0.0, 0.16, 1.0 - UV.x);
 float grooves = mix(0.65, 1.0, smoothstep(0.08, 0.24, abs(sin(UV.x * 25.0))));
 ALBEDO = vec3(0.022, 0.024, 0.026);
 ALPHA = mark.y * edge * grooves * (1.0 - smoothstep(25.0, 55.0, effect_time - mark.x));
 if (ALPHA < 0.003) discard;
}
