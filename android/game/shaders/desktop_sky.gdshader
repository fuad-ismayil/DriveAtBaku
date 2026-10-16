shader_type sky;

uniform float night : hint_range(0.0, 1.0) = 0.0;
uniform float cloudCover : hint_range(0.0, 1.0) = 0.0;
uniform sampler2D cloud_texture : filter_linear_mipmap, repeat_enable;

float hash_cloud(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void sky() {
	vec3 direction = normalize(EYEDIR);
	float elevation = max(direction.y, 0.0);
	float horizon = exp(-elevation * 6.0);
	vec3 sun_direction = normalize(vec3(450.0, 310.0, -165.0));
	float sun = max(dot(direction, sun_direction), 0.0);
	vec3 day = mix(vec3(0.085, 0.23, 0.48), vec3(0.58, 0.69, 0.77), horizon);
	day += vec3(0.32, 0.25, 0.17) * pow(sun, 16.0) * (1.0 - cloudCover);
	day += vec3(8.0, 7.5, 6.7) * smoothstep(0.99993, 0.99997, sun) * (1.0 - cloudCover);
	vec2 projected = direction.xz / max(direction.y + 0.18, 0.08) * 2.1;
	float field = texture(cloud_texture, projected * 0.08 + vec2(0.21, 0.37)).r;
	float coverage = smoothstep(mix(0.57, 0.18, cloudCover), mix(0.77, 0.55, cloudCover), field);
	coverage *= smoothstep(0.025, 0.23, elevation);
	vec3 cloud_color = mix(vec3(0.55, 0.62, 0.70), vec3(1.02, 1.04, 1.07), smoothstep(0.4, 0.76, field));
	day = mix(day, cloud_color, coverage * 0.9);
	day = mix(day, mix(vec3(0.32, 0.39, 0.48), vec3(0.62, 0.67, 0.73), horizon), cloudCover * 0.65);
	vec3 dark = mix(vec3(0.003, 0.008, 0.022), vec3(0.034, 0.054, 0.085), horizon);
	vec3 moon_direction = normalize(vec3(270.0, 590.0, -190.0));
	float moon = max(dot(direction, moon_direction), 0.0);
	dark += vec3(0.07, 0.11, 0.19) * pow(moon, 35.0);
	dark += vec3(2.0, 2.25, 2.6) * smoothstep(0.99990, 0.99996, moon) * (1.0 - cloudCover);
	vec2 star_uv = vec2(atan(direction.z, direction.x), asin(clamp(direction.y, -1.0, 1.0))) * 190.0;
	float star = step(0.994, hash_cloud(floor(star_uv))) * (1.0 - smoothstep(0.02, 0.16, length(fract(star_uv) - 0.5)));
	dark += vec3(0.55, 0.69, 0.9) * star * smoothstep(0.1, 0.35, elevation) * (1.0 - cloudCover) * (1.0 - coverage);
	dark = mix(dark, vec3(0.045, 0.064, 0.092), coverage * 0.4);
	vec3 atmosphere = mix(day, dark, night);
	vec3 ground = mix(vec3(0.11, 0.12, 0.13), vec3(0.006, 0.009, 0.014), night);
	COLOR = mix(ground, atmosphere, smoothstep(-0.12, 0.025, direction.y));
}
