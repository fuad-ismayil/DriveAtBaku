extends Control

signal action_requested(action: String)

const Icons = preload("res://scripts/ui_icons.gd")

var active = false
var fingers: Dictionary = {}
var regions: Dictionary = {}
var shifts: Array = []
var steering_target = 0.0
var steering_value = 0.0
var steering_velocity = 0.0
var finger_speed = 0.0
var throttle = 0.0
var brake = 0.0
var font = ThemeDB.fallback_font
var last_pointer: Dictionary = {}
var camera_drag = -1
var camera_delta = Vector2.ZERO
var safe_insets = Vector4.ZERO
var blocked_regions: Array = []
var automatic = true

func set_automatic(value: bool):
	if automatic == value: return
	automatic = value
	# Release held gear/clutch touches when the actual transmission mode changes.
	clear()
	queue_redraw()

func _ready():
	automatic = Preferences.values.automatic
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(_layout)
	_layout()

func _layout():
	var factor = float(Preferences.values.control_scale)
	var w = size.x
	var h = size.y
	var pedal_h = 205.0 * factor
	var pedal_w = maxf(88, 90.0 * factor)
	var handbrake_side = maxf(88, 88.0 * factor)
	var handbrake_center_y = minf(h * 0.5, h - pedal_h - 40 - 16 * factor - handbrake_side * 0.5)
	var horn_side = maxf(88, 88.0 * factor)
	var horn_y = h - (240.0 if Preferences.values.control_mode == "sliders" else 140.0) * factor
	var steering_width = maxf(350 * factor, 3 * 88 + 32)
	var arrow_width = maxf(88, 118 * factor)
	regions = {
		"steering": Rect2(48, h - 136 * factor, steering_width, maxf(88, 92 * factor)),
		"left": Rect2(48, h - 150 * factor, arrow_width, maxf(88, 108 * factor)),
		"right": Rect2(48 + steering_width - arrow_width, h - 150 * factor, arrow_width, maxf(88, 108 * factor)),
		"horn": Rect2(48 + (steering_width - horn_side) * 0.5, horn_y, horn_side, horn_side),
		"throttle": Rect2(w - 142 * factor, h - pedal_h - 40, pedal_w, pedal_h),
		"brake": Rect2(w - 260 * factor, h - pedal_h - 40, pedal_w, pedal_h),
		"shift_down": Rect2(w - 370 * factor, h - 132 * factor, maxf(88, 80 * factor), maxf(88, 90 * factor)),
		"shift_up": Rect2(w - 370 * factor, h - 132 * factor - maxf(104, 106 * factor), maxf(88, 80 * factor), maxf(88, 90 * factor)),
		"handbrake": Rect2(w - 24 - handbrake_side, handbrake_center_y - handbrake_side * 0.5, handbrake_side, handbrake_side),
		"clutch": Rect2(570 * factor, h - maxf(112 * factor, 112), maxf(88, 100 * factor), maxf(88, 70 * factor))
	}
	for key in ["shift_up", "shift_down"]:
		regions[key].position.x = regions.brake.position.x - regions[key].size.x - 16 * factor
	# Manual controls form one accessible column beside the pedals, leaving the
	# bottom center free for instruments at every supported control scale.
	regions.clutch = Rect2(regions.shift_up.position - Vector2(0, 104 * factor), Vector2(regions.shift_up.size.x, maxf(88, 88 * factor)))
	# Keep a full thumb's clearance above the slider at the smallest size.
	if Preferences.values.control_mode == "sliders": regions.horn.position.y = regions.steering.position.y - horn_side - 16 * factor
	if Preferences.values.left_handed:
		for key in regions:
			var r: Rect2 = regions[key]
			r.position.x = w - r.end.x
			regions[key] = r
	for key in regions:
		var rect: Rect2 = regions[key]
		rect.position.x += safe_insets.x if rect.get_center().x < w * 0.5 else -safe_insets.z
		rect.position.y -= safe_insets.w
		regions[key] = rect
	queue_redraw()

func clear():
	fingers.clear()
	last_pointer.clear()
	shifts.clear()
	throttle = 0
	brake = 0
	steering_target = 0
	steering_velocity = 0
	finger_speed = 0
	camera_drag = -1
	camera_delta = Vector2.ZERO
	queue_redraw()

func _input(event):
	if not active:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_E: shifts.append("shift_up")
			KEY_Q: shifts.append("shift_down")
			KEY_T: action_requested.emit("transmission")
			KEY_C: action_requested.emit("camera")
			KEY_ESCAPE: action_requested.emit("pause")
			KEY_R: action_requested.emit("recover")
			KEY_L: action_requested.emit("lights")
	if event is InputEventScreenTouch:
		if event.pressed and not event.canceled:
			for blocked in blocked_regions:
				if blocked.has_point(event.position): return
			var control = _hit(event.position)
			if control != "" and not fingers.values().has(control):
				fingers[event.index] = control
				last_pointer[event.index] = {"position": event.position, "time": Time.get_ticks_usec()}
				if control in ["shift_up", "shift_down"]:
					shifts.append(control)
				_update_pointer(event.index, event.position)
			elif control == "" and event.position.y > 100 and event.position.y < size.y * 0.58 and camera_drag == -1:
				camera_drag = event.index
		else:
			if fingers.has(event.index):
				var control = fingers[event.index]
				fingers.erase(event.index)
				last_pointer.erase(event.index)
				if control == "throttle": throttle = 0
				if control == "brake": brake = 0
				if control == "steering": finger_speed = 0
			if camera_drag == event.index:
				camera_drag = -1
		queue_redraw()
	elif event is InputEventScreenDrag:
		if fingers.has(event.index):
			_update_pointer(event.index, event.position)
		elif event.index == camera_drag:
			camera_delta += event.relative

func _hit(point: Vector2) -> String:
	var sliders = Preferences.values.control_mode == "sliders"
	for key in regions:
		if sliders and key in ["left", "right"]: continue
		if not sliders and key == "steering": continue
		if key in ["shift_up", "shift_down", "clutch"] and automatic: continue
		if regions[key].has_point(point): return key
	return ""

func _update_pointer(index: int, point: Vector2):
	var control = fingers[index]
	var rect: Rect2 = regions[control]
	var sliders = Preferences.values.control_mode == "sliders"
	if control == "steering":
		var normalized = clampf(-(point.x - rect.get_center().x) / (rect.size.x * 0.42), -1, 1)
		var previous = last_pointer[index]
		var dt = maxf(0.001, (Time.get_ticks_usec() - int(previous.time)) / 1000000.0)
		finger_speed = minf(20, absf(point.x - previous.position.x) / (rect.size.x * 0.42) / dt)
		steering_target = normalized
	elif control == "throttle":
		throttle = clampf((rect.end.y - point.y - 14) / (rect.size.y - 28), 0, 1) if sliders else 1.0
	elif control == "brake":
		brake = clampf((rect.end.y - point.y - 14) / (rect.size.y - 28), 0, 1) if sliders else 1.0
	last_pointer[index] = {"position": point, "time": Time.get_ticks_usec()}
	queue_redraw()

func sample(dt: float) -> Dictionary:
	var held = fingers.values()
	var keyboard = float(Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT)) - float(Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT))
	var target = steering_target
	if Preferences.values.control_mode == "buttons":
		target = float(held.has("left")) - float(held.has("right"))
		steering_value = target
	else:
		if not held.has("steering") and Preferences.values.self_center_enabled:
			steering_target = move_toward(steering_target, 0.0, (0.6 + 4.0 * Preferences.values.self_center) * dt)
			target = steering_target
		var gamma = 1.0 + 0.65 * clampf(Preferences.values.weight, 0, 1)
		target = signf(target) * pow(absf(target), gamma)
		var omega = lerpf(34.0, 12.0, clampf(Preferences.values.weight, 0, 1))
		omega += minf(finger_speed, 8) * 5 * Preferences.values.quick_response
		finger_speed *= exp(-12 * dt)
		# Exact critically damped update at fixed simulation time. Fast finger
		# movements increase response frequency without altering the final angle.
		var difference = steering_value - target
		var decay = exp(-omega * dt)
		var next = target + (difference * (1 + omega * dt) + steering_velocity * dt) * decay
		steering_velocity = (steering_velocity * (1 - omega * dt) - difference * omega * omega * dt) * decay
		steering_value = clampf(next, -1, 1)
	var shift = shifts.pop_front() if not shifts.is_empty() else ""
	var result = {
		"steer": clampf((steering_value + keyboard) * Preferences.values.sensitivity, -1, 1),
		"throttle": maxf(throttle, float(Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP))),
		"brake": maxf(brake, float(Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN))),
		"handbrake": held.has("handbrake") or Input.is_physical_key_pressed(KEY_SPACE),
		"clutch": held.has("clutch") or Input.is_physical_key_pressed(KEY_X),
		"horn": held.has("horn") or Input.is_physical_key_pressed(KEY_H),
		"shift_up": shift == "shift_up", "shift_down": shift == "shift_down"
	}
	queue_redraw()
	return result

func _draw():
	if not active: return
	var sliders = Preferences.values.control_mode == "sliders"
	for key in regions:
		if sliders and key in ["left", "right"]: continue
		if not sliders and key == "steering": continue
		if key in ["shift_up", "shift_down", "clutch"] and automatic: continue
		var r: Rect2 = regions[key]
		var style = StyleBoxFlat.new()
		var pressed = fingers.values().has(key)
		style.bg_color = Color(0.035, 0.06, 0.09, 0.32 if not pressed else 0.58)
		style.border_color = Color(0.85, 0.93, 1.0, 0.28 if not pressed else 0.72)
		style.set_border_width_all(1)
		style.set_corner_radius_all(roundi(r.size.x * 0.5) if key in ["handbrake", "horn"] else 30)
		style.shadow_color = Color(0.005, 0.015, 0.025, 0.18)
		style.shadow_size = 5
		draw_style_box(style, r)
		if key not in ["handbrake", "horn"]: draw_line(r.position + Vector2(30, 1), Vector2(r.end.x - 30, r.position.y + 1), Color(1, 1, 1, 0.28), 1, true)
		var text = {"left": "‹", "right": "›", "throttle": "", "brake": "", "shift_up": "+", "shift_down": "−", "handbrake": "", "horn": "", "clutch": "CLUTCH", "steering": ""}[key]
		if key == "steering":
			var middle = r.get_center()
			draw_line(Vector2(r.position.x + 24, middle.y), Vector2(r.end.x - 24, middle.y), Color(0.02, 0.04, 0.06, 0.55), 9, true)
			draw_line(Vector2(r.position.x + 24, middle.y - 1), Vector2(r.end.x - 24, middle.y - 1), Color(1, 1, 1, 0.26), 2, true)
			draw_line(middle - Vector2(0, 15), middle + Vector2(0, 15), Color(1, 1, 1, 0.55), 2)
			draw_line(middle, middle - Vector2(steering_value * r.size.x * 0.42, 0), Color(0.36, 0.73, 1, 0.85), 5, true)
			draw_circle(middle - Vector2(steering_target * r.size.x * 0.42, 0), 25, Color(1, 1, 1, 0.4), false, 1.3, true)
			draw_circle(middle - Vector2(steering_target * r.size.x * 0.42, 0), 22, Color(0.92, 0.96, 1, 0.95), true, -1, true)
			draw_circle(middle - Vector2(steering_value * r.size.x * 0.42, 0), 7, Color(0.2, 0.62, 1), true, -1, true)
		elif key in ["throttle", "brake"] and sliders:
			var value = throttle if key == "throttle" else brake
			var fill = Rect2(r.position.x + 12, r.end.y - 14 - (r.size.y - 28) * value, r.size.x - 24, (r.size.y - 28) * value)
			var liquid = StyleBoxFlat.new()
			liquid.bg_color = Color(0.35, 0.72, 1.0, 0.42) if key == "throttle" else Color(1.0, 0.55, 0.38, 0.42)
			liquid.set_corner_radius_all(18)
			if fill.size.y > 0: draw_style_box(liquid, fill)
		if key in ["throttle", "brake", "handbrake", "horn"]:
			var icon_side = minf(44.0 * float(Preferences.values.control_scale), minf(r.size.x, r.size.y) - 24)
			var center = r.get_center() - Vector2(0, 14 if sliders and key in ["throttle", "brake"] else 0)
			draw_texture_rect(Icons.get_icon(key), Rect2(center - Vector2.ONE * icon_side * 0.5, Vector2.ONE * icon_side), false)
			if sliders and key in ["throttle", "brake"]:
				var value = throttle if key == "throttle" else brake
				var percent = "%d%%" % int(value * 100)
				var width = font.get_string_size(percent, HORIZONTAL_ALIGNMENT_LEFT, -1, 17).x
				draw_string(font, Vector2(r.get_center().x - width * 0.5, center.y + icon_side * 0.5 + 27), percent, HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color.WHITE)
			continue
		var lines = str(text).split("\n")
		for i in lines.size():
			var fs = 42 if key in ["left", "right", "shift_up", "shift_down"] else 17
			var width = font.get_string_size(lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
			draw_string(font, Vector2(r.get_center().x - width / 2, r.get_center().y + 7 + i * 23), lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)
