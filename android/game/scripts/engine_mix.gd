extends RefCounted

static func from_wire(a: Dictionary, b: Dictionary, alpha: float) -> Dictionary:
	var current = a if alpha < 1 else b
	var velocity: Array = current.get("v", [0, 0, 0])
	var wheels: Array = []
	for wheel in current.get("w", []): wheels.append({"grounded": bool(wheel.get("c", 0)), "slip": wheel.get("sl", 0)})
	return {"rpm": lerpf(a.get("rpm", 900), b.get("rpm", 900), alpha),
		"engine_load": lerpf(a.get("au", {}).get("ld", a.get("in", {}).get("th", 0)), b.get("au", {}).get("ld", b.get("in", {}).get("th", 0)), alpha),
		"acceleration": lerpf(a.get("au", {}).get("ac", 0), b.get("au", {}).get("ac", 0), alpha),
		"shift_timer": current.get("au", {}).get("sh", 0), "gear": current.get("gr", 1), "velocity": Vector3(velocity[0], velocity[2], -velocity[1]), "wheels": wheels,
		"throttle": current.get("in", {}).get("th", 0), "brake": current.get("in", {}).get("br", 0), "handbrake": bool(current.get("in", {}).get("hb", 0)), "horn": bool(current.get("in", {}).get("hn", 0))}

# Presentation targets from src/engineMix.js; never fed back into physics.
static func targets(state: Dictionary, vehicle: Dictionary) -> Dictionary:
	var rpm = clampf(state.rpm, vehicle.idleRpm * 0.8, vehicle.redlineRpm + 300)
	var throttle = clampf(state.get("engine_load", state.get("throttle", 0)), 0, 1)
	var acceleration = clampf(state.get("acceleration", 0), -12, 12)
	var shifting = state.get("shift_timer", 0) > 0
	var idle = 1 - smoothstep(vehicle.idleRpm * 1.05, vehicle.idleRpm + 1250, rpm)
	var load_factor = 0.055 if shifting else clampf(0.08 + 0.83 * pow(throttle, 0.72) + 0.08 * maxf(0, acceleration) / 8, 0.08, 1)
	return {"rpm": rpm, "idle": idle, "running": sqrt(maxf(0, 1 - idle * idle)), "load": load_factor, "shifting": shifting}

static func weights(entries: Array, rpm: float) -> Array:
	var result: Array = []
	result.resize(entries.size())
	result.fill(0.0)
	if entries.is_empty(): return result
	if rpm <= entries[0].rpm:
		result[0] = 1.0
		return result
	for i in range(1, entries.size()):
		if rpm <= entries[i].rpm:
			var t = smoothstep(float(entries[i - 1].rpm), float(entries[i].rpm), rpm)
			result[i - 1] = cos(t * PI / 2)
			result[i] = sin(t * PI / 2)
			return result
	result[-1] = 1.0
	return result
