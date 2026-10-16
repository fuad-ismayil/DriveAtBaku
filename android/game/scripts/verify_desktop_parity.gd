extends "res://scripts/verify_desktop_graphics.gd"

func exercise():
	game.interface.loading_screen.show_message("Preparing your drive…", .65, false)
	await capture("loading")
	game.interface.loading_screen.hide()
	game._action("main_menu")
	game.interface.show_menu()
	await capture("main-menu")
	for i in 3: await get_tree().process_frame
	check(game.interface.version_label.visible and game.interface.version_label.text == "v1.0.0", "Main menu must show the shared version")
	check(not game.interface.hud_toolbar.visible and not game.interface.hud_signals.visible, "Desktop must hide mobile toolbar and signals")
	check(game.interface.root.find_children("Download", "Button", true, false).is_empty(), "Native menu must not offer a download button")
	check(game.interface.root.find_children("Quit game", "Button", true, false).size() == 1, "Native main menu must offer Quit game")
	game._action("drive")
	for i in 5: await get_tree().process_frame
	check(not game.interface.version_label.visible, "Version must be hidden while driving")
	check(game.interface.instruments.size == Vector2(264,62), "Desktop telemetry must match shared dimensions")
	check(game.interface.minimap_button.size == Vector2(176,176) and game.interface.minimap.size == Vector2(168,168), "Minimap must match shared desktop dimensions")
	if DisplayServer.get_name() != "headless": check(Input.mouse_mode == Input.MOUSE_MODE_CAPTURED, "Driving must capture the mouse")
	game.interface.update_map({"position":Vector3(10,0,-20),"heading":PI/2,"velocity":Vector3.ZERO},[],PI)
	check(is_equal_approx(game.interface.minimap.camera_heading,PI) and is_equal_approx(game.interface.minimap.heading,PI/2), "Minimap must keep camera and car headings independent")
	await capture("driving")
	game._action("map")
	await capture("full-map")
	check(game.interface.map_overlay.visible, "Full map must open")
	if DisplayServer.get_name() != "headless": check(Input.mouse_mode == Input.MOUSE_MODE_VISIBLE, "Map must release the mouse")
	game._action("map_close")
	game._action("pause")
	for i in 5: await get_tree().process_frame
	if DisplayServer.get_name() != "headless": check(Input.mouse_mode == Input.MOUSE_MODE_VISIBLE, "Pausing after driving must leave the cursor visible")
	check(game.interface.root.find_children("Quit game", "Button", true, false).size() == 1, "Pause menu must offer Quit game")
	var quit = game.interface.root.find_children("Quit game", "Button", true, false)[0]
	if DisplayServer.get_name() != "headless":
		check(game.interface.detail_scroll.get_global_rect().encloses(quit.get_global_rect()), "Pause Quit game must be reachable without scrolling through settings")
		check(get_viewport().gui_get_focus_owner().accessibility_name == "RESUME DRIVING", "Pause must focus Resume for keyboard use")
	await capture("pause-settings")
	check(not game.interface.version_label.visible, "Pause menu must hide the version")
	for key in ["aspect_ratio","fullscreen","quality","resolution","render_scale","abs","tcs","esc"]:
		check(game.interface.fields.has(key), "Desktop settings must expose " + key)
	game.interface.navigate("garage")
	var selected = game.interface.vehicle_buttons[Preferences.values.vehicle]
	check(selected.button_pressed, "Garage must expose the selected car state")
	selected.mouse_exited.emit()
	check(is_equal_approx(selected.get_child(0).density, .46), "Selected garage highlight must survive mouse exit")
	await get_tree().create_timer(2.0).timeout
	await capture("garage")
	if DisplayServer.get_name() != "headless":
		for resolution in [Vector2i(1920,1080),Vector2i(1920,1200),Vector2i(2560,1080),Vector2i(1280,720)]:
			Preferences.values.aspect_ratio = "auto"
			get_window().size = resolution
			game._apply_display()
			for i in 8: await get_tree().process_frame
			check(get_window().content_scale_size == resolution, "Auto aspect must use the whole desktop at " + str(resolution))
			check(game.interface.root.size.is_equal_approx(Vector2(resolution)), "UI must fill the desktop at " + str(resolution))
		Preferences.values.aspect_ratio = "4:3"
		game._apply_display()
		for i in 8: await get_tree().process_frame
		var fit = get_window().content_scale_size
		check(absf(float(fit.x)/fit.y-4.0/3.0)<.003, "Selected aspect must fit without stretching")
		game._action("drive")
		await capture("driving-4x3")
		Preferences.values.aspect_ratio = "auto"
		get_window().size = Vector2i(1600,900)
		game._apply_display()
	var spec = preload("res://scripts/presentation_spec.gd").data.nameplate
	check(spec.font == "Segoe UI" and spec.fontSize == 48 and spec.height == 2.2 and spec.fadeEnd == 150, "Multiplayer nameplate spec must match Web")
	game._remote_joined({"id":"presentation-test", "nick":"Test Driver"})
	var label = game.remotes["presentation-test"].label
	check(label.modulate == Color.WHITE and label.text == "Test Driver", "Remote names must be white text")
	check(label.font_size == spec.fontSize and is_equal_approx(label.pixel_size, spec.pixelSize), "Remote label size must match the shared specification")
	check(label.billboard == BaseMaterial3D.BILLBOARD_ENABLED and is_equal_approx(label.position.y, spec.height), "Remote labels must billboard at the shared height")
	game._remote_left("presentation-test")
