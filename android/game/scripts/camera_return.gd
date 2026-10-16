extends RefCounted

# Leave manual orbit untouched while parking; recover progressively above
# 8 km/h, reaching the existing driving return rate at 32 km/h.
static func blend(speed_kmh: float, dt: float, dragging: bool) -> float:
	if dragging: return 0.0
	return 1 - exp(-1.5 * smoothstep(8.0, 32.0, absf(speed_kmh)) * maxf(0, dt))
