extends Node

var failures: Array = []
var controls

func _ready():
	call_deferred("run")

func check(condition: bool, message: String):
	if not condition:
		failures.append(message)
		push_error(message)

func touch(index: int, position: Vector2, pressed: bool):
	var event = InputEventScreenTouch.new()
	event.index = index
	event.position = position
	event.pressed = pressed
	controls._input(event)

func run():
	await get_tree().process_frame
	var saved = Preferences.values.duplicate(true)
	controls = load("res://scripts/driving_controls.gd").new()
	get_tree().root.add_child(controls)
	controls.set_anchors_preset(Control.PRESET_TOP_LEFT)
	controls.size = Vector2(1480, 720)
	controls._layout()
	controls.active = true
	Preferences.values.control_mode = "sliders"
	Preferences.values.automatic = false
	var gas: Rect2 = controls.regions.throttle
	var brake: Rect2 = controls.regions.brake
	var steering: Rect2 = controls.regions.steering
	touch(10, gas.get_center(), true)
	touch(11, Vector2(brake.get_center().x, brake.end.y - 14 - (brake.size.y - 28) * 0.25), true)
	touch(12, steering.get_center(), true)
	var input = controls.sample(1.0 / 120)
	check(absf(input.throttle - 0.5) < 0.0001, "Half slider must request 50% throttle")
	check(absf(input.brake - 0.25) < 0.0001, "Brake slider must preserve partial input")
	check(controls.fingers.size() == 3, "Three independent fingers must remain captured")
	var shift_up: Rect2 = controls.regions.shift_up
	touch(13, shift_up.get_center(), true)
	check(controls.sample(1.0 / 120).shift_up, "Manual gear press must be consumed")
	check(not controls.sample(1.0 / 120).shift_up, "Held gear button must not repeat at physics frequency")
	touch(10, gas.get_center(), false)
	touch(11, brake.get_center(), false)
	input = controls.sample(1.0 / 120)
	check(input.throttle == 0 and input.brake == 0, "Released pedals must request zero")
	controls.steering_value = 0
	controls.steering_velocity = 0
	controls.steering_target = 0.8
	controls.finger_speed = 0
	for i in 4: controls.sample(1.0 / 120)
	var slow = controls.steering_value
	controls.steering_value = 0
	controls.steering_velocity = 0
	controls.finger_speed = 10
	for i in 4: controls.sample(1.0 / 120)
	var fast = controls.steering_value
	check(fast > slow, "Fast finger movement must respond sooner")
	check(fast > 0 and fast < 0.8, "Fast steering must retain damping")
	for i in 240: controls.sample(1.0 / 120)
	check(absf(controls.steering_value - pow(0.8, 1 + 0.65 * Preferences.values.weight)) < 0.0001, "Velocity must not change the final steering angle")
	touch(12, steering.get_center(), false)
	for i in 240: controls.sample(1.0 / 120)
	check(absf(controls.steering_value) < 0.0001, "Released steering must self-center")
	controls.clear()
	Preferences.values.control_mode = "buttons"
	touch(1, controls.regions.left.get_center(), true)
	touch(2, controls.regions.right.get_center(), true)
	check(controls.sample(1.0 / 120).steer == 0, "Opposing steering buttons must cancel")
	controls.clear()
	check(controls.fingers.is_empty() and controls.shifts.is_empty() and controls.throttle == 0 and controls.brake == 0, "Cancellation must clear all held inputs")
	for mirrored in [false, true]:
		Preferences.values.left_handed = mirrored
		for scale_value in [0.75, 1.0, 1.35]:
			Preferences.values.control_scale = scale_value
			controls._layout()
			var handbrake: Rect2 = controls.regions.handbrake
			check(absf((handbrake.position.x if mirrored else controls.size.x - handbrake.end.x) - 24) < 0.01, "Handbrake must stay close to the outer edge")
			check(handbrake.end.y < controls.regions.throttle.position.y, "Handbrake must not overlap pedals at any control size")
			check(handbrake.position.y > 0 and handbrake.end.y < controls.size.y, "Handbrake must remain inside the screen")
			touch(20, handbrake.get_center(), true)
			check(controls.sample(1.0 / 120).handbrake, "The relocated handbrake must respond to touch")
			touch(20, handbrake.get_center(), false)
			check(not controls.sample(1.0 / 120).handbrake, "Handbrake release must clear input")
			for mode in ["buttons", "sliders"]:
				Preferences.values.control_mode = mode
				controls.clear()
				controls._layout()
				var horn: Rect2 = controls.regions.horn
				var steering_control: Rect2 = controls.regions.steering if mode == "sliders" else controls.regions.left
				if mode == "sliders":
					check(absf(horn.get_center().x - steering_control.get_center().x) < 0.01 and horn.end.y < steering_control.position.y, "Horn must sit centered above the steering slider")
				else:
					var left: Rect2 = controls.regions.left
					var right: Rect2 = controls.regions.right
					check(absf(horn.get_center().x - (left.get_center().x + right.get_center().x) * 0.5) < 0.01, "Horn must sit between steering buttons")
					check(not horn.intersects(left) and not horn.intersects(right), "Horn must not overlap steering buttons")
				touch(21, horn.get_center(), true)
				touch(22, steering_control.get_center(), true)
				touch(23, controls.regions.throttle.get_center(), true)
				var held = controls.sample(1.0 / 120)
				check(held.horn and held.throttle > 0 and controls.fingers.size() == 3, "Horn, steering and throttle must work simultaneously")
				touch(21, horn.get_center(), false)
				check(not controls.sample(1.0 / 120).horn, "Releasing horn must stop it")
				touch(21, horn.get_center(), true)
				var canceled = InputEventScreenTouch.new()
				canceled.index = 21
				canceled.canceled = true
				controls._input(canceled)
				check(not controls.sample(1.0 / 120).horn, "Canceled horn touches must stop it")
				touch(21, horn.get_center(), true)
				controls.clear()
				check(not controls.sample(1.0 / 120).horn, "Opening a menu must release horn input")
	Preferences.values = saved
	controls.queue_free()
	await get_tree().process_frame
	if failures.is_empty(): print("NATIVE_CONTROLS_PASS proportional pedals, multi-touch, shifts, weighted response, centering, cancellation")
	get_tree().quit(0 if failures.is_empty() else 1)
