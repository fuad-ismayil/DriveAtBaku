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
	for field in ["enabled", "region", "letters", "serial", "hyphens", "format"]:
		Preferences.values["plate_" + field] = Preferences.DEFAULTS["plate_" + field]
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
	interface.show_menu()
	var quit_buttons = interface.root.find_children("Quit game", "Button", true, false)
	check(quit_buttons.size() == 1, "Mobile main menu must offer Quit game")
	check(interface.root.find_children("Download", "Button", true, false).is_empty(), "Native mobile menu must not offer downloads")
	if not quit_buttons.is_empty():
		quit_buttons[0].pressed.emit()
		check(actions.back() == "quit", "Quit game must request application shutdown")
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
	interface.garage_category = "Registration"
	interface.navigate("garage")
	await capture("registration-long")
	var editor = interface.plate_editor
	check(is_instance_valid(editor), "Registration needs a dedicated editor")
	check_inline_plate(editor, true)
	editor.edits.region.grab_focus()
	await capture("registration-inline-focus")
	editor.edits.region.release_focus()
	editor.edits.region.text = "5"
	editor._edit("region", "5")
	editor._commit()
	check(Preferences.plate_settings().region == "05", "Partial region must pad on commit")
	editor.edits.letters.text = "iqab"
	editor._edit("letters", "iqab")
	editor._commit()
	check(Preferences.plate_settings().letters == "AB", "Letters must use the same alphabet as the web")
	editor._edit("serial", "99-BC-808")
	check(Preferences.plate_settings().region == "99" and Preferences.plate_settings().serial == "808", "Whole registration paste must populate all fields")
	editor._edit("serial", "000")
	editor._commit()
	check(Preferences.plate_settings().serial == "808", "An invalid edit must preserve the saved registration")
	interface._change("plate_format", "compact")
	await capture("registration-compact")
	check_inline_plate(editor, false)
	interface.fields.plate_hyphens.button_pressed = false
	check(Preferences.plate_settings().identity == "new", "RFID and separators must change together")
	interface.fields.plate_enabled.button_pressed = false
	check(not editor.options.visible and editor.disabled_note.visible, "Disabled plates must hide options and explain how to restore them")
	interface.fields.plate_enabled.button_pressed = true
	interface.inspect_plate("front")
	check(interface.plate_view == "front" and not interface.menu.visible and not interface.controls.active, "Plate inspection must expose the car and keep input paused")
	interface.back()
	check(interface.plate_view == "car" and interface.menu.visible, "Back from inspection must restore registration")
	interface.garage_category = "Driving aids"
	interface.navigate("garage")
	await capture("driving-aids")
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
	var mock = {"position": Vector3(681.197388, 1.6, -479.707794), "heading": -1.128934, "velocity": Vector3.ZERO, "gear": 2, "rpm": 900, "automatic": true, "abs_active": false, "tcs_active": false, "esc_active": false}
	interface.update_state(mock, "OFFLINE", 1)
	interface.update_map(mock, [])
	check(not interface.instruments is Panel and interface.instruments.size.y <= 64, "Readouts must have no background and take minimal vertical space")
	check(interface.minimap_button.size.x <= 156 and interface.minimap_button.size.y <= 156, "Minimap must remain a small corner element")
	check(not interface.status.text.contains("OFFLINE") and not interface.status.text.contains("FERRARI"), "Driving HUD must avoid repeated menu information")
	await capture("driving-buttons")
	Preferences.values.control_mode = "sliders"
	interface.controls._layout()
	interface.controls.throttle = 0.5
	interface.controls.brake = 0.25
	interface.controls.queue_redraw()
	await capture("driving-sliders")
	mock.automatic = false
	interface.update_state(mock, "OFFLINE", 1)
	await capture("driving-manual")
	interface.show_map()
	await capture("expanded-map")
	interface.close_map()
	for dimensions in [Vector2i(1280, 720), Vector2i(1600, 720), Vector2i(1024, 768)]:
		get_window().size = dimensions
		await settle()
		interface.show_driving()
		for mirrored in [false, true]:
			Preferences.values.left_handed = mirrored
			for factor in [0.75, 1.0, 1.35]:
				Preferences.values.control_scale = factor
				for mode in ["buttons", "sliders"]:
					Preferences.values.control_mode = mode
					interface._safe_layout()
					var bounds = interface.instruments.get_global_rect()
					check(absf(bounds.get_center().x - interface.root.size.x * 0.5) < 1, "Instruments must remain bottom centered")
					check(bounds.position.y > interface.root.size.y * 0.88, "HUD must leave the car's lower silhouette clear")
					for key in interface.controls.regions:
						if key == "steering" and mode != "sliders": continue
						if key in ["left", "right"] and mode == "sliders": continue
						check(not bounds.intersects(interface.controls.regions[key]), "Instruments must clear all manual controls: %s %s %s" % [key, factor, dimensions])
		interface.show_map()
		await settle()
		for button in interface.map_overlay.find_children("*", "Button", true, false):
			check(button.size.y >= 88 and interface.root.get_global_rect().encloses(button.get_global_rect()), "Expanded map buttons must remain touchable and in bounds")
		interface.close_map()
		interface.show_menu()
		await capture("menu-%dx%d" % [dimensions.x, dimensions.y])
		check_home_bounds()
		for destination in ["settings", "garage", "multiplayer", "credits"]:
			interface.navigate(destination)
			await settle()
			check(interface.detail_scroll.get_global_rect().end.x <= interface.root.size.x, "Detail sheet must fit " + destination)
			for control in interface.fields.values():
				check(control.size.y >= 88, "Fields must retain an 88-unit touch area")
				check(control.get_global_rect().end.x <= interface.root.size.x, "Fields must not overflow horizontally")
		interface.garage_category = "Registration"
		interface.navigate("garage")
		await settle()
		check_inline_plate(interface.plate_editor, false)
	Preferences.values = saved
	Preferences.save()
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

func check_inline_plate(editor, has_identity_box: bool):
	check(editor.find_children("*", "LineEdit", true, false).size() == 3, "Registration must have exactly three inline inputs and no extra fields")
	for edit in editor.edits.values():
		check(edit.get_parent() == editor.preview, "Registration inputs must be inside the plate preview")
		check(editor.preview.plate_rect.encloses(edit.get_rect()), "Inline input must stay inside the white plate")
		check(edit.size.x >= 88 and edit.size.y >= 88, "Inline plate input must retain an 88-unit touch target")
	if has_identity_box:
		check(editor.preview.chip_rect.encloses(editor.preview.az_text_rect), "AZ text must be inside its identity box")
