shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled;
varying vec2 particle;
void vertex() {
 particle = INSTANCE_CUSTOM.rg;
 float radius = length(MODEL_MATRIX[0].xyz);
 MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
 VERTEX *= radius;
}
void fragment() {
 vec2 p = UV * 2.0 - 1.0;
 float soft = exp(-dot(p, p) * 4.5) * (1.0 - smoothstep(0.65, 1.0, length(p)));
 float fade = smoothstep(0.0, 0.14, particle.x) * (1.0 - smoothstep(0.3, 1.0, particle.x));
 ALBEDO = vec3(0.58, 0.60, 0.62);
 ALPHA = soft * fade * particle.y;
 if (ALPHA < 0.002) discard;
}
