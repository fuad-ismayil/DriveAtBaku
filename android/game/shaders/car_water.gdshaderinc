// Generated from src/vehicleWater.js by prepare_water_shader.mjs.
vec3 carWaterHash(vec2 p) {
  vec3 h = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  h += dot(h, h.yxz + 33.33);
  return fract((h.xxy + h.yzz) * h.zyx);
}
vec3 carWaterUnion(vec3 a, vec3 b) {
  // Smoothly join beads into larger drops and short rivulets.
  if (min(a.z, b.z) <= 0.0) return a.z > b.z ? a : b;
  float h = clamp(.5 + .5 * (a.z - b.z) / .045, 0.0, 1.0);
  return vec3(mix(b.xy, a.xy, h), mix(b.z, a.z, h) + .045 * h * (1.0 - h));
}
vec3 carWaterCap(vec2 q, float radius, vec2 footprint) {
  // Convolve the dome with the pixel footprint, conserving its covered area.
  // This widens only the pixel reconstruction kernel, never the physical bead.
  vec2 radiusSquared = vec2(radius * radius) + footprint * footprint * .12;
  float area = radius * radius / sqrt(radiusSquared.x * radiusSquared.y);
  float cap = max(1.0 - dot(q * q, 1.0 / radiusSquared), 0.0);
  // Analytic optical slope survives when adjacent pixels miss the same bead.
  // A rounded cap has a contact angle, rather than a fixed shallow height that
  // flattens progressively larger drops. XY = slope, Z = filtered coverage.
  return vec3(-4.0 * cap * q / radiusSquared * radius * .32 * area, cap * cap * area);
}
vec3 carWaterDrops(vec2 p, vec2 footprint, vec2 flow, float stretch, float wet, float mobile) {
  vec2 cell = floor(p), f = fract(p);
  vec3 height = vec3(0.0);
  vec2 along = flow / max(length(flow), .0001);
  vec2 across = vec2(-along.y, along.x);
  if (length(flow) < .0001) { along = vec2(0, 1); across = vec2(1, 0); }
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 offset = vec2(float(x), float(y));
    vec3 seed = carWaterHash(cell + offset);
    vec2 q = f - offset - (.05 + seed.xy * .90);
    float age = fract(carWaterTime * .19 + seed.z * 13.0);
    float arrival = mix(1.0, smoothstep(0.0, .16, age) * (1.0 - smoothstep(.87, 1.0, age)), carWaterRain);
    float coverage = smoothstep(seed.z, seed.z + .16, wet * .88);
    float radius = mix(.08, .32, seed.z) * mix(.45, 1.0, arrival);
    float extension = 1.0 + stretch * mobile * (.5 + seed.y);
    vec2 ellipse = vec2(dot(q, across), dot(q, along) / extension);
    vec2 filteredFootprint = vec2(dot(abs(across), footprint), dot(abs(along), footprint) / extension);
    vec3 dome = carWaterCap(ellipse, radius, filteredFootprint) * coverage;
    // A neighbouring bead grows into the moving head, then drains as a tail.
    vec2 joined = ellipse - vec2(radius * .8, radius * .5);
    vec3 second = carWaterCap(joined, radius * .8062, filteredFootprint);
    dome = carWaterUnion(dome, second * coverage * mobile * wet * .75);
    dome.xy = across * dome.x + along * dome.y / extension;
    height = carWaterUnion(height, dome);
  }
  return height;
}
