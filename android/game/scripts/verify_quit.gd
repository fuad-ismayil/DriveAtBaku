extends Node

func _ready():
	call_deferred("run")

func run():
	Preferences.storage_path = "user://quit-verification.cfg"
	Preferences.values.volume = 0.0
	var game = load("res://main.tscn").instantiate()
	add_child(game)
	var deadline = Time.get_ticks_msec() + 180000
	while not game.ready_to_drive and Time.get_ticks_msec() < deadline: await get_tree().process_frame
	if not game.ready_to_drive:
		push_error("Quit verification could not load the game")
		get_tree().quit(1)
		return
	game.interface.loading_screen.hide()
	game._action("drive")
	game._action("pause")
	await get_tree().process_frame
	if DisplayServer.get_name() != "headless" and Input.mouse_mode != Input.MOUSE_MODE_VISIBLE:
		push_error("Pause must release the mouse before quitting")
		get_tree().quit(1)
		return
	var buttons = game.interface.root.find_children("Quit game", "Button", true, false)
	if buttons.size() != 1:
		push_error("Pause must expose one Quit game button")
		get_tree().quit(1)
		return
	buttons[0].pressed.connect(func(): verify_cleanup(game))
	print("NATIVE_QUIT_BUTTON_INVOKED")
	if DisplayServer.get_name() == "headless":
		buttons[0].pressed.emit()
	else:
		var center = buttons[0].get_global_rect().get_center()
		var move = InputEventMouseMotion.new()
		move.position = center
		move.global_position = center
		Input.parse_input_event(move)
		await get_tree().process_frame
		for pressed in [true, false]:
			var click = InputEventMouseButton.new()
			click.button_index = MOUSE_BUTTON_LEFT
			click.position = center
			click.global_position = center
			click.pressed = pressed
			Input.parse_input_event(click)
			await get_tree().process_frame
		await get_tree().create_timer(2).timeout
		push_error("Visible pause-menu Quit button must respond to a mouse click")
		get_tree().quit(1)

func verify_cleanup(game):
	if game.ready_to_drive or game.is_driving or game.interface.controls.active:
		push_error("Quit must stop driving and input before closing")
		get_tree().quit(1)
		return
	print("NATIVE_QUIT_CLEANUP_PASS")
