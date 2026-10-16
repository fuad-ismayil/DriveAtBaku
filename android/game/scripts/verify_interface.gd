extends Node

var failures: Array = []
var interface
var actions: Array = []
var output = "res://../../artifacts/android/ui"
var saved: Dictionary

func _ready():
	call_deferred("run")

func check(condition: bool, message: String):
	if condition: return
	failures.append(message)
	push_error(message)

func settle():
	for i in 5: await get_tree().process_frame

func capture(name: String):
	await settle()
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(output.path_join(name + ".png"))

func run():
	saved = Preferences.values.duplicate(true)
	if OS.has_feature("android"): output = "user://ui"
	Preferences.values.reduce_motion = true
	Preferences.values.vehicle = "ferrari"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	var backdrop = TextureRect.new()
	backdrop.texture = load("res://assets/ui/city.webp")
	backdrop.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	backdrop.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	add_child(backdrop)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	interface = load("res://scripts/interface.gd").new()
	add_child(interface)
	interface.requested.connect(func(action): actions.append(action))
	interface.show_loading("Preparing the skyline…", 0.42)
	await capture("loading")
	check(interface.loading_screen.progress_bar.value == 42, "Loading must display reported progress")
	interface.show_loading("City preparation interrupted.", -1, true)
	check(interface.loading_screen.retry.visible, "Loading failures need retry")
	interface.loading_screen.retry.pressed.emit()
	check(actions.back() == "retry", "Retry must reach the game")
	interface.show_menu()
	await capture("main-menu")
	check(not interface.controls.active and not interface.hud.visible, "Menus must disable driving controls and HUD")
	check(interface.root.find_children("Buy me a coffee", "Button", true, false).size() > 0, "Main menu needs coffee support")
	check(interface.COFFEE_URL == "https://kofe.al/@fuadismayil", "Coffee address must match web")
	check_home_bounds()
	for destination in ["garage", "settings", "multiplayer", "credits"]:
		interface.navigate(destination)
		await capture(destination.validate_filename())
		check(interface.page == destination, "Destination must be reachable: " + destination)
		interface.back()
		check(interface.page == "home", "Back must return home")
	for title in ["Graphics & audio", "Atmosphere", "Accessibility"]:
		interface.category = title
		interface.navigate("settings")
		await capture(title.validate_filename())
	interface.update_network("RECONNECTING")
	interface.navigate("multiplayer")
	check(interface.online_button.disabled and interface.network_label.text.contains("Retrying"), "Reconnect needs clear feedback and duplicate join prevention")
	interface.update_network("OFFLINE")
	check(not interface.online_button.disabled, "Offline must allow rejoin")
	interface.show_driving()
	interface.controls.throttle = 1
	interface.controls.fingers[1] = "throttle"
	interface.show_menu(true)
	await capture("pause")
	check(interface.controls.throttle == 0 and interface.controls.fingers.is_empty(), "Pause must release every held input")
	check(interface.paused and interface.page == "home", "Pause needs its own home state")
	check_home_bounds()
	interface.navigate("garage")
	interface.show_loading("Preparing vehicle…", 0.25)
	interface.show_menu(true, true)
	check(interface.paused and interface.page == "garage", "Vehicle loading must preserve pause and garage context")
	interface.back()
	interface.back()
	check(actions.back() == "drive", "Back from pause must resume")
	Preferences.values.control_mode = "buttons"
	Preferences.values.left_handed = false
	Preferences.values.control_scale = 1.0
	interface.show_driving()
	interface.controls._layout()
	await capture("driving-buttons")
	Preferences.values.control_mode = "sliders"
	interface.controls._layout()
	interface.controls.throttle = 0.5
	interface.controls.brake = 0.25
	interface.controls.queue_redraw()
	await capture("driving-sliders")
	for dimensions in [Vector2i(1280, 720), Vector2i(1600, 720), Vector2i(1024, 768)]:
		get_window().size = dimensions
		interface.show_menu()
		await capture("menu-%dx%d" % [dimensions.x, dimensions.y])
		check_home_bounds()
	Preferences.values = saved
	var report = {"failures": failures, "passed": failures.is_empty(), "coffee_url": interface.COFFEE_URL}
	FileAccess.open(output.path_join("verification.json"), FileAccess.WRITE).store_string(JSON.stringify(report, "  "))
	print("NATIVE_INTERFACE ", JSON.stringify(report))
	interface.queue_free()
	backdrop.queue_free()
	await settle()
	get_tree().quit(0 if failures.is_empty() else 1)

func check_home_bounds():
	var viewport_size = interface.root.size
	for button in interface.menu.find_children("*", "Button", true, false):
		if not button.is_visible_in_tree(): continue
		var bounds = button.get_global_rect()
		check(bounds.position.x >= 0 and bounds.position.y >= 0 and bounds.end.x <= viewport_size.x + 1 and bounds.end.y <= viewport_size.y + 1, "Home action outside viewport: %s %s / %s" % [button.name, bounds, viewport_size])
		check(button.size.y >= 88, "Home touch target too small: " + button.name)
