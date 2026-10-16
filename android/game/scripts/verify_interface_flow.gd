extends Node

var game
var failures: Array = []
var checks = 0
var output = "res://../../artifacts/android/ui-flow"
var saved: Dictionary
var switch_samples: Array = []
var visibility_samples: Array = []

func check_vehicle_visibility():
	var body = Rect2()
	var first = true
	for mesh in game.player.model.find_children("*", "MeshInstance3D", true, false):
		var box: AABB = mesh.get_aabb()
		for corner in 8:
			var point = box.position + box.size * Vector3(float(corner & 1), float((corner >> 1) & 1), float((corner >> 2) & 1))
			var screen = game.camera.unproject_position(mesh.global_transform * point)
			if first:
				body = Rect2(screen, Vector2.ZERO)
				first = false
			else: body = body.expand(screen)
	var ui = game.interface
	var clear = true
	for element in [ui.instruments, ui.hud_toolbar, ui.hud_signals, ui.minimap_button]:
		clear = clear and not body.intersects(element.get_global_rect())
	check(clear, "Driving HUD must not cover the projected car body: " + game.player.vehicle_id)
	visibility_samples.append({"vehicle": game.player.vehicle_id, "car_rect": str(body), "readout_rect": str(ui.instruments.get_global_rect()), "clear": clear})

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
	Preferences.values.touch_controls = true
	if OS.has_feature("android"): output = "user://ui"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	Preferences.values.night = false
	Preferences.values.vehicle = "ferrari"
	Preferences.values.automatic = true
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
		var ui = game.interface
		check(ui.instruments is Control and not ui.instruments is Panel and ui.instruments.material == null, "Driving readouts must have no panel background or glass material")
		check(ui.instruments.size.y <= 64 and ui.instruments.position.y >= ui.root.size.y * 0.88, "Readouts must be compact and confined to the bottom edge")
		check(ui.minimap_button.size.x <= 156 and ui.minimap_button.size.y <= 156 and ui.minimap.material != null, "Minimap must be compact and circularly masked")
		check(ui.minimap_button.find_children("*", "Label", true, false).is_empty(), "Minimap must not have a bulky text footer")
		check_vehicle_visibility()
		for button in ui.hud_toolbar.get_children():
			var lens = button.get_child(0)
			check(button.size.x == 64 and button.size.y == 64 and lens.density < 0.4, "Edge actions must use closely spaced compact glass buttons")
		ui.gearbox_button.pressed.emit()
		check(not game.state.automatic and not ui.controls.automatic, "Gearbox toolbar must immediately expose manual controls")
		check(ui.controls._hit(ui.controls.regions.shift_up.get_center()) == "shift_up" and ui.controls._hit(ui.controls.regions.clutch.get_center()) == "clutch", "Manual shift and clutch targets must be visible and reachable")
		var before_gear = game.state.gear
		var gear_touch = InputEventScreenTouch.new()
		gear_touch.index = 20
		gear_touch.position = ui.controls.regions.shift_up.get_center()
		gear_touch.pressed = true
		ui.controls._input(gear_touch)
		await settle(0.2)
		gear_touch.pressed = false
		ui.controls._input(gear_touch)
		check(game.state.gear == before_gear + 1 and ui.gear_label.text == str(game.state.gear - 1), "Manual touch must change the actual gear and dashboard readout")
		await capture("03b-manual-hud")
		ui.gearbox_button.pressed.emit()
		check(game.state.automatic and ui.controls.automatic, "Returning to automatic must hide manual targets")
		# Real snapshot/interpolation path with two deterministic multiplayer peers.
		# No relay is contacted by the isolated interface QA app.
		var local = game.state.position
		var peer_inputs: Dictionary = {}
		for i in 2:
			var peer_id = "map-peer-%d" % i
			game._remote_joined({"id": peer_id, "nick": "Map driver %d" % (i + 1)})
			game.remotes[peer_id].vehicle = "ferrari" # Rendering models is covered by multiplayer feature QA.
			peer_inputs[peer_id] = {"seq": 1, "cid": "ferrari", "p": [local.x + 65 + i * 60, -local.z + 60, local.y], "q": [0, 0, sin(0.3), cos(0.3)]}
			game._snapshot({"ts": game.session.server_time(), "states": {peer_id: peer_inputs[peer_id].duplicate(true)}})
		var peer_timer = Timer.new()
		add_child(peer_timer)
		peer_timer.wait_time = 0.35
		peer_timer.timeout.connect(func():
			for peer_id in peer_inputs:
				if not game.remotes.has(peer_id): continue
				peer_inputs[peer_id].seq += 1
				game._snapshot({"ts": game.session.server_time(), "states": {peer_id: peer_inputs[peer_id].duplicate(true)}}))
		peer_timer.start()
		await settle(0.2)
		check(ui.minimap.peers.size() == 2 and ui.expanded_map.peers.size() == 2, "Both maps must show every live multiplayer peer")
		check(ui.minimap.peers[0].position.distance_to(Vector2(local.x + 65, -local.z + 60)) < 0.01 and absf(ui.minimap.peers[0].heading - 0.6) < 0.001, "Peer map markers must use interpolated position and correct heading")
		await capture("03c-multiplayer-minimap")
		var map_touch = InputEventScreenTouch.new()
		map_touch.index = 0
		map_touch.position = ui.minimap_button.get_global_rect().get_center()
		# Input.parse_input_event enters before the viewport stretch transform,
		# just like a physical screen touch. Desktop at 1:1 hid this distinction.
		map_touch.position = get_viewport().get_stretch_transform() * map_touch.position
		map_touch.pressed = true
		Input.parse_input_event(map_touch)
		await settle(0.05)
		check(ui.controls.camera_drag == -1, "Tapping the minimap must not rotate the driving camera")
		map_touch.pressed = false
		Input.parse_input_event(map_touch)
		await settle(0.15)
		check(ui.map_overlay.visible and not game.is_driving and not ui.controls.active, "Map tap must expand the map and release driving input")
		if not ui.map_overlay.visible: game._action("map")
		await capture("03d-expanded-map")
		ui.expanded_map.zoom_by(2)
		check(ui.expanded_map.zoom == 2, "Expanded map zoom must respond")
		ui.expanded_map.reset_view()
		var pinch_start = InputEventScreenTouch.new()
		pinch_start.index = 30
		pinch_start.pressed = true
		pinch_start.position = Vector2(400, 200)
		ui.expanded_map._gesture(pinch_start)
		pinch_start.index = 31
		pinch_start.position = Vector2(500, 200)
		ui.expanded_map._gesture(pinch_start)
		var pinch_drag = InputEventScreenDrag.new()
		pinch_drag.index = 31
		pinch_drag.position = Vector2(600, 200)
		ui.expanded_map._gesture(pinch_drag)
		check(ui.expanded_map.zoom == 2, "Two-finger pinch must zoom the map")
		pinch_start.pressed = false
		ui.expanded_map._gesture(pinch_start)
		pinch_drag.index = 30
		pinch_drag.position = Vector2(425, 215)
		ui.expanded_map._gesture(pinch_drag)
		check(ui.expanded_map.pan.distance_to(Vector2(25, 15)) < 0.1, "One-finger drag must pan the map")
		ui.expanded_map.reset_view()
		check(ui.expanded_map.zoom == 1 and ui.expanded_map.pan == Vector2.ZERO and ui.expanded_map.pointers.is_empty(), "Fit city must reset zoom, pan and gesture state")
		ui.expanded_map.locate_player()
		check(ui.expanded_map.project(ui.expanded_map.player).distance_to(ui.expanded_map.size * 0.5) < 1, "Locate must center the player's car")
		game._notification(Node.NOTIFICATION_WM_GO_BACK_REQUEST)
		check(not ui.map_overlay.visible and game.is_driving and ui.controls.active, "Android Back must close map and restore released driving controls")
		var old_marker: Vector2 = ui.minimap.peers[0].position if not ui.minimap.peers.is_empty() else Vector2.ZERO
		peer_inputs["map-peer-0"].p[0] = local.x + 80
		await settle(0.65)
		check(not ui.minimap.peers.is_empty() and ui.minimap.peers[0].position.x > old_marker.x + 10, "Map markers must follow incoming player movement")
		game._remote_left("map-peer-0")
		await settle(0.2)
		check(ui.minimap.peers.size() == 1, "Leaving players must disappear from both maps")
		peer_timer.stop()
		peer_timer.queue_free()
		game.remotes["map-peer-1"].buffer[-1].time = game.session.server_time() - 4000
		await settle(0.2)
		check(ui.minimap.peers.is_empty() and ui.expanded_map.peers.is_empty(), "Stale player markers must be removed")
		game._clear_remotes()
		game.interface.controls.throttle = 1
		game._action("pause")
		check(not game.is_driving and game.interface.controls.throttle == 0, "Pause must stop simulation input")
		await capture("04-pause")
		await press("Garage")
		var retained_sheet = game.interface.detail_scroll
		await game._select_vehicle("elantra")
		check(game.interface.page == "garage" and game.interface.paused, "Vehicle change must preserve pause garage")
		check(game.player.vehicle_id == "elantra", "Garage must load selected vehicle")
		check(game.interface.detail_scroll == retained_sheet and retained_sheet.is_inside_tree(), "Switching must update the existing garage without rebuilding it")
		await capture("05-garage")
		check_vehicle_visibility()
		check(game.interface.menu.visible and not game.interface.loading_screen.visible, "Car changes must leave garage visible")
		for id in ["amg", "prado", "amg", "prado", "prado"]:
			var requested_at = Time.get_ticks_usec()
			await game._select_vehicle(id)
			if DisplayServer.get_name() != "headless": await RenderingServer.frame_post_draw
			var sample = game.switch_timings.duplicate(true)
			sample.presented_ms = (Time.get_ticks_usec() - requested_at) / 1000.0
			sample.texture_bytes = RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED)
			sample.buffer_bytes = RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED)
			switch_samples.append(sample)
			await settle(0.2)
			check_vehicle_visibility()
		check(game.player.model_cache.size() <= 1, "Local cache must retain at most one previous car")
		game.interface.garage_category = "Registration"
		game.interface.navigate("garage")
		await capture("05b-registration")
		var editor = game.interface.plate_editor
		check(editor.preview.chip_rect.encloses(editor.preview.az_text_rect), "AZ must be framed by its identity box")
		for edit in editor.edits.values():
			check(edit.get_parent() == editor.preview and editor.preview.plate_rect.encloses(edit.get_rect()), "Registration editing must happen inside the plate")
		var stored_plate = Preferences.plate_settings()
		editor.edits.region.grab_focus()
		await capture("05e-inline-edit")
		editor.edits.region.text = "77"
		editor.edits.region.text_changed.emit("77")
		editor._commit()
		check(Preferences.plate_settings().region == "77" and JSON.parse_string(game.player.plate_text).region == "77", "Inline edits must update saved and mounted plates")
		editor.edits.region.release_focus()
		game.interface.hide_keyboard()
		Preferences.update_plate(stored_plate)
		game.interface.setting_changed.emit("plate_registration")
		editor._sync_fields()
		game.interface._change("plate_format", "compact")
		await capture("05f-inline-compact")
		for edit in editor.edits.values():
			check(editor.preview.plate_rect.encloses(edit.get_rect()) and edit.size.y >= 88, "Compact inline fields must fit and remain touchable")
		game.interface._change("plate_format", stored_plate.format)
		game.interface.inspect_plate("front")
		var front_badge = game.player.model.find_child("Object_52", true, false)
		check(front_badge != null and front_badge.get_active_material(0).shader.code.contains("cull_disabled;"), "Prado front Toyota badge must preserve authored two-sided faces")
		await capture("05c-front-plate")
		check(game.camera.position.distance_to(game.player.position) < 5, "Front inspection must frame the mounted plate")
		game.interface.plate_view = "rear"
		await capture("05d-rear-plate")
		game._notification(Node.NOTIFICATION_WM_GO_BACK_REQUEST)
		check(game.interface.plate_view == "car" and game.interface.page == "garage", "Back must leave inspection without leaving garage")
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
		game.interface._change("reduce_transparency", false)
		game._action("drive")
		await capture("10-night-driving")
		check_vehicle_visibility()
	Preferences.values = saved
	Preferences.save()
	var report = {"passed": failures.is_empty(), "checks": checks, "failures": failures, "switch_samples": switch_samples, "vehicle_visibility": visibility_samples, "renderer": RenderingServer.get_current_rendering_method(), "viewport": str(get_viewport().get_visible_rect().size)}
	FileAccess.open(output.path_join("verification.json"), FileAccess.WRITE).store_string(JSON.stringify(report, "  "))
	print("NATIVE_INTERFACE_FLOW ", JSON.stringify(report))
	game.queue_free()
	await settle()
	get_tree().quit(0 if failures.is_empty() else 1)
