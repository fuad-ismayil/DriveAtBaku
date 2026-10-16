extends Node

var game
var failures: Array = []
var checks = 0
var output = "res://../../artifacts/android/ui-flow"
var saved: Dictionary

func _ready():
	call_deferred("run")

func check(condition: bool, message: String):
	checks += 1
	if condition: return
	failures.append(message)
	push_error(message)

func settle(seconds = 0.45):
	await get_tree().create_timer(seconds).timeout

func capture(name: String):
	await settle()
	if DisplayServer.get_name() == "headless": return
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(output.path_join(name + ".png"))

func press(name: String):
	var buttons = game.interface.menu.find_children(name, "Button", true, false)
	check(not buttons.is_empty(), "Missing menu action: " + name)
	if not buttons.is_empty(): buttons[0].pressed.emit()
	await settle()

func run():
	saved = Preferences.values.duplicate(true)
	if OS.has_feature("android"): output = "user://ui"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	Preferences.values.night = false
	Preferences.values.vehicle = "ferrari"
	Preferences.values.reduce_motion = false
	game = load("res://scripts/game.gd").new()
	add_child(game)
	await capture("01-loading")
	var deadline = Time.get_ticks_msec() + 150000
	while not game.ready_to_drive and Time.get_ticks_msec() < deadline:
		await get_tree().process_frame
	check(game.ready_to_drive, "Full game must finish preparing")
	if game.ready_to_drive:
		await capture("02-main-menu")
		check(not game.interface.controls.active, "Main menu must disable control sampling")
		await press("Start driving")
		check(game.is_driving and game.interface.controls.active, "Start must enable driving")
		await capture("03-driving")
		game.interface.controls.throttle = 1
		game._action("pause")
		check(not game.is_driving and game.interface.controls.throttle == 0, "Pause must stop simulation input")
		await capture("04-pause")
		await press("Garage")
		await game._select_vehicle("elantra")
		check(game.interface.page == "garage" and game.interface.paused, "Vehicle change must preserve pause garage")
		check(game.player.vehicle_id == "elantra", "Garage must load selected vehicle")
		await capture("05-garage")
		game.interface.back()
		await settle()
		await press("Resume driving")
		check(game.is_driving, "Pause resume must continue driving")
		game._notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
		check(not game.is_driving and game.interface.paused, "Focus loss while driving must pause")
		game._notification(Node.NOTIFICATION_APPLICATION_FOCUS_IN)
		game._notification(Node.NOTIFICATION_WM_GO_BACK_REQUEST)
		check(game.is_driving, "Android Back from pause must resume")
		game._action("pause")
		game.interface.navigate("settings")
		game.interface.category = "Atmosphere"
		game.interface.navigate("settings")
		await capture("06-settings")
		game._notification(Node.NOTIFICATION_WM_GO_BACK_REQUEST)
		check(game.interface.page == "home" and not game.is_driving, "Android Back from settings must return to pause")
		await press("Main menu")
		check(not game.interface.paused and not game.is_driving and game.session.status == "OFFLINE", "Main menu must leave the room and preserve offline play")
		game._notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
		game._notification(Node.NOTIFICATION_APPLICATION_FOCUS_IN)
		check(not game.interface.paused, "Returning from browser on main menu must retain main menu")
		game.interface.navigate("multiplayer")
		game.session._status("RECONNECTING")
		await capture("07-reconnecting")
		check(game.interface.online_button.disabled, "Pending connection must prevent duplicate Join")
		game._action("disconnect")
		check(not game.session.active and not game.is_driving, "Leave room must remain usable")
		game._action("main_menu")
		game.interface._change("night", true)
		await capture("08-night-menu")
		game.interface._change("reduce_transparency", true)
		game.interface.show_menu()
		await capture("09-high-contrast")
	Preferences.values = saved
	Preferences.save()
	var report = {"passed": failures.is_empty(), "checks": checks, "failures": failures, "renderer": RenderingServer.get_current_rendering_method(), "viewport": str(get_viewport().get_visible_rect().size)}
	FileAccess.open(output.path_join("verification.json"), FileAccess.WRITE).store_string(JSON.stringify(report, "  "))
	print("NATIVE_INTERFACE_FLOW ", JSON.stringify(report))
	game.queue_free()
	await settle()
	get_tree().quit(0 if failures.is_empty() else 1)
