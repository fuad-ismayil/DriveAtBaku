extends CanvasLayer

signal requested(action: String)
signal vehicle_selected(id: String)
signal setting_changed(key: String)

const Glass = preload("res://scripts/glass_panel.gd")
const Icons = preload("res://scripts/ui_icons.gd")
const COFFEE_URL = "https://kofe.al/@fuadismayil"
const VEHICLES = {"ferrari": "Ferrari 458 Italia", "elantra": "Hyundai Elantra / Avante", "amg": "Mercedes-AMG", "prado": "Toyota Prado"}
const MUTED = Color(0.79, 0.83, 0.84)

var controls = preload("res://scripts/driving_controls.gd").new()
var root = Control.new()
var hud = Control.new()
var menu = Control.new()
var safe = MarginContainer.new()
var panel: Control
var loading_screen = preload("res://scripts/loading_interface.gd").new()
var speed = Label.new()
var status = Label.new()
var telemetry = Label.new()
var online_button: Button
var leave_button: Button
var network_label: Label
var vehicle_label: Label
var driving = false
var paused = false
var page = "home"
var category = "Driving"
var network_status = "OFFLINE"
var fields: Dictionary = {}
var transition: Tween
var menu_content: VBoxContainer
var press_tweens: Dictionary = {}
var scene_capture = BackBufferCopy.new()
var medium_font: SystemFont

func _ready():
	add_child(root)
	_full(root)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_theme()
	root.add_child(controls)
	controls.action_requested.connect(func(action): requested.emit(action))
	scene_capture.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
	root.add_child(scene_capture)
	root.add_child(hud)
	_full(hud)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_hud()
	root.add_child(menu)
	_full(menu)
	var shade = ColorRect.new()
	shade.color = Color(0.015, 0.022, 0.025, 0.18)
	menu.add_child(shade)
	_full(shade)
	menu.add_child(safe)
	_full(safe)
	root.add_child(loading_screen)
	_full(loading_screen)
	loading_screen.retry_requested.connect(func(): requested.emit("retry"))
	root.resized.connect(_safe_layout)
	_safe_layout()
	menu.hide()
	hud.hide()

func _build_theme():
	var theme = Theme.new()
	var font = SystemFont.new()
	font.font_names = PackedStringArray(["Segoe UI", "Roboto", "Noto Sans", "sans-serif"])
	medium_font = font.duplicate()
	medium_font.font_weight = 600
	theme.default_font = font
	theme.default_font_size = 22
	theme.set_color("font_color", "Label", Color(0.97, 0.98, 0.98))
	theme.set_color("font_shadow_color", "Label", Color(0, 0, 0, 0.38))
	theme.set_constant("shadow_offset_y", "Label", 1)
	for kind in ["Button", "OptionButton", "LineEdit", "CheckButton", "PopupMenu"]:
		for state_name in ["normal", "hover", "pressed", "focus", "disabled", "read_only", "panel"]:
			var style = StyleBoxFlat.new()
			style.bg_color = Color(0.04, 0.05, 0.055, 0.50)
			style.border_color = Color(1, 1, 1, 0.2)
			style.set_border_width_all(1)
			style.set_corner_radius_all(24)
			style.content_margin_left = 20
			style.content_margin_right = 20
			style.content_margin_top = 12
			style.content_margin_bottom = 12
			if state_name == "hover": style.bg_color = Color(0.3, 0.33, 0.34, 0.6)
			if state_name == "pressed": style.bg_color = Color(0.5, 0.53, 0.54, 0.5)
			if state_name == "focus":
				style.bg_color = Color.TRANSPARENT
				style.border_color = Color(0.72, 0.94, 0.93, 0.95)
				style.set_border_width_all(2)
			if kind == "PopupMenu": style.bg_color = Color(0.055, 0.07, 0.075, 0.98)
			theme.set_stylebox(state_name, kind, style)
	for kind in ["OptionButton", "LineEdit", "Button", "CheckButton"]:
		theme.set_color("font_color", kind, Color(0.97, 0.98, 0.98))
		theme.set_color("font_hover_color", kind, Color.WHITE)
		theme.set_color("font_pressed_color", kind, Color.WHITE)
	var track = StyleBoxFlat.new()
	track.bg_color = Color(1, 1, 1, 0.16)
	track.set_corner_radius_all(3)
	track.content_margin_top = 3
	track.content_margin_bottom = 3
	theme.set_stylebox("slider", "HSlider", track)
	var fill = track.duplicate()
	fill.bg_color = Color(0.78, 0.92, 0.90)
	theme.set_stylebox("grabber_area", "HSlider", fill)
	theme.set_stylebox("grabber_area_highlight", "HSlider", fill)
	root.theme = theme

func _full(node: Control):
	node.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

func _safe_layout():
	var inset = Vector4(36, 24, 36, 24)
	if OS.has_feature("android"):
		var area = DisplayServer.get_display_safe_area()
		var window = Vector2(DisplayServer.window_get_size())
		var ratio = root.size / window.max(Vector2.ONE)
		inset.x = maxf(inset.x, area.position.x * ratio.x + 20)
		inset.y = maxf(inset.y, area.position.y * ratio.y + 16)
		inset.z = maxf(inset.z, (window.x - area.end.x) * ratio.x + 20)
		inset.w = maxf(inset.w, (window.y - area.end.y) * ratio.y + 16)
	for pair in [["margin_left", inset.x], ["margin_top", inset.y], ["margin_right", inset.z], ["margin_bottom", inset.w]]:
		safe.add_theme_constant_override(pair[0], int(pair[1]))
	loading_screen.set_insets(inset)

func _label(parent: Node, text: String, font_size = 22, color = Color.WHITE) -> Label:
	var label = Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	parent.add_child(label)
	return label

func _box(parent: Node, vertical = true, gap = 12) -> BoxContainer:
	var box: BoxContainer = VBoxContainer.new() if vertical else HBoxContainer.new()
	box.add_theme_constant_override("separation", gap)
	parent.add_child(box)
	return box

func _space(parent: Node):
	var spacer = Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(spacer)

func _icon(parent: Node, id: String, side = 26):
	var icon = TextureRect.new()
	icon.texture = Icons.get_icon(id)
	icon.custom_minimum_size = Vector2(side, side)
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(icon)

func _ignore_children(node: Node):
	for child in node.get_children():
		if child is Control: child.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_ignore_children(child)

func _button(parent: Node, text: String, callback: Callable, icon = "arrow", subtitle = "", primary = false) -> Button:
	var button = Button.new()
	button.name = (text if not text.is_empty() else icon).validate_node_name()
	button.tooltip_text = text
	button.custom_minimum_size = Vector2(0, 88)
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for state_name in ["normal", "hover", "pressed", "disabled"]: button.add_theme_stylebox_override(state_name, StyleBoxEmpty.new())
	parent.add_child(button)
	var lens = Glass.new()
	lens.radius = 44
	lens.density = 0.12 if primary else 0.30
	button.add_child(lens)
	_full(lens)
	lens.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var padding = MarginContainer.new()
	button.add_child(padding)
	_full(padding)
	for side in ["margin_left", "margin_right"]: padding.add_theme_constant_override(side, 22)
	var row = _box(padding, false, 16)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	if not text.is_empty():
		var words = _box(row, true, 1)
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_label(words, text, 24).add_theme_font_override("font", medium_font)
		if not subtitle.is_empty(): _label(words, subtitle, 17, MUTED)
	_icon(row, icon, 28)
	button.custom_minimum_size.x = maxf(88, row.get_combined_minimum_size().x + 44)
	_ignore_children(button)
	button.pressed.connect(callback)
	button.button_down.connect(func(): _press(button, lens, true))
	button.button_up.connect(func(): _press(button, lens, false))
	button.mouse_exited.connect(func(): _press(button, lens, false))
	return button

func _press(button: Button, lens: Control, down: bool):
	lens.density = 0.08 if down else 0.28
	lens._refresh()
	if Preferences.values.reduce_motion: return
	var id = button.get_instance_id()
	if press_tweens.has(id) and press_tweens[id].is_valid(): press_tweens[id].kill()
	button.pivot_offset = button.size * 0.5
	var tween = button.create_tween()
	press_tweens[id] = tween
	tween.tween_property(button, "scale", Vector2.ONE * (0.98 if down else 1.0), 0.12).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)

func _coffee(parent: Node):
	var button = _button(parent, "Buy me a coffee", _open_coffee, "coffee")
	button.tooltip_text = "Support the developer · opens kofe.al in your browser"
	button.custom_minimum_size.y = 88
	return button

func _open_coffee():
	var result = OS.shell_open(COFFEE_URL)
	if result != OK:
		var dialog = AcceptDialog.new()
		dialog.title = "Buy me a coffee"
		dialog.dialog_text = "Open this address in your browser:\n" + COFFEE_URL
		root.add_child(dialog)
		dialog.popup_centered()
		dialog.confirmed.connect(dialog.queue_free)

func _build_hud():
	var toolbar = _box(hud, false, 10)
	toolbar.position = Vector2(36, 24)
	for item in [["Pause", "pause", "pause"], ["Camera", "camera", "camera"], ["Gearbox", "transmission", "gear"], ["Lights", "lights", "lights"], ["Recover", "recover", "recover"]]:
		var button = _button(toolbar, "DriveAtBaku" if item[0] == "Pause" else "", func(): requested.emit(item[1]), item[2])
		button.tooltip_text = item[0]
	leave_button = _button(toolbar, "Leave room", func(): requested.emit("disconnect"), "external")
	leave_button.custom_minimum_size.x = 180
	leave_button.hide()
	var signals = _box(hud, false, 10)
	signals.position = Vector2(36, 152)
	for item in [["Left", "signal_left", "left"], ["Hazards", "signal_hazard", "hazard"], ["Right", "signal_right", "arrow"]]:
		var button = _button(signals, "", func(): requested.emit(item[1]), item[2])
		button.tooltip_text = item[0]
	status.position = Vector2(42, 106)
	status.add_theme_font_size_override("font_size", 18)
	hud.add_child(status)
	telemetry.position = Vector2(42, 230)
	telemetry.add_theme_font_size_override("font_size", 16)
	hud.add_child(telemetry)
	hud.add_child(speed)
	speed.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	speed.offset_left = -280
	speed.offset_right = -36
	speed.offset_top = 24
	speed.offset_bottom = 118
	speed.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	speed.add_theme_font_size_override("font_size", 32)

func _build_menu():
	for tween in press_tweens.values():
		if tween.is_valid(): tween.kill()
	press_tweens.clear()
	for child in safe.get_children():
		safe.remove_child(child)
		child.queue_free()
	fields.clear()
	online_button = null
	network_label = null
	vehicle_label = null
	menu_content = _box(safe, true, 18)
	var header = _box(menu_content, false, 14)
	if page != "home":
		var back_button = _button(header, "Back", back, "back")
		back_button.custom_minimum_size.x = 152
		back_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	else:
		_icon(header, "road", 38)
	var brand = _box(header, true, 0)
	brand.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_label(brand, "DriveAtBaku", 24)
	_label(brand, "AN OPEN ROAD EXPERIENCE", 12, MUTED)
	_space(header)
	_label(header, "BAKU, AZERBAIJAN   /   40.4093° N · 49.8671° E", 15, MUTED).vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var body = _box(menu_content, false, 24)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	if page == "home":
		_build_home(body)
	else:
		_build_detail(body)
	var footer = _box(menu_content, false, 16)
	_label(footer, "THE CITY IS YOURS.", 14, MUTED)
	_space(footer)
	_label(footer, "PREFERENCES SAVE AUTOMATICALLY", 13, MUTED)
	if not Preferences.values.reduce_motion:
		if transition: transition.kill()
		menu_content.modulate.a = 0
		transition = create_tween()
		transition.tween_property(menu_content, "modulate:a", 1.0, 0.24).set_trans(Tween.TRANS_SINE)

func _build_home(body: BoxContainer):
	panel = Glass.new()
	panel.density = 0.38
	panel.custom_minimum_size.x = 496
	body.add_child(panel)
	var content = _box(panel, true, 8)
	_label(content, "YOUR DRIVE / PAUSED" if paused else "●  THE CITY IS YOURS", 15, Color(0.72, 0.91, 0.87))
	var title = _label(content, "Take a breath." if paused else "DriveAt\nBaku.", 40 if paused else 48)
	title.add_theme_font_override("font", medium_font)
	title.add_theme_constant_override("line_spacing", -10)
	_label(content, "Your city. Your pace." if paused else "Nowhere to be. Everything to discover.", 20, MUTED)
	_space(content)
	_button(content, "Resume driving" if paused else "Start driving", func(): requested.emit("drive"), "play" if paused else "arrow", "Your road is right where you left it." if paused else "Single player · Free roam", true)
	if paused:
		var shortcuts = _box(content, false, 10)
		_button(shortcuts, "Garage", func(): navigate("garage"), "garage")
		_button(shortcuts, "Settings", func(): navigate("settings"), "settings")
		_button(content, "Main menu", func(): requested.emit("main_menu"), "back")
	else:
		_button(content, "Drive together", func(): navigate("multiplayer"), "people", "Multiplayer · Share the city")
		_button(content, "Your garage", func(): navigate("garage"), "garage", "Four ways to make it yours")
	var scene = _box(body, true, 14)
	scene.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_space(scene)
	var card = Glass.new()
	card.size_flags_horizontal = Control.SIZE_SHRINK_END
	card.custom_minimum_size.x = 400
	scene.add_child(card)
	var detail = _box(card, true, 7)
	_label(detail, "YOUR NEXT CHAPTER", 13, MUTED)
	vehicle_label = _label(detail, VEHICLES[Preferences.values.vehicle], 25)
	_label(detail, "Along the Caspian · " + ("After hours" if Preferences.values.night else "Daylight"), 17, MUTED)
	var utilities = _box(detail, false, 10)
	if paused: _button(utilities, "Restart", func(): requested.emit("restart"), "recover")
	else: _button(utilities, "Settings", func(): navigate("settings"), "settings")
	_button(utilities, "Credits", func(): navigate("credits"), "info")
	var row = _box(detail, false, 10)
	_button(row, "Night" if not Preferences.values.night else "Day", _toggle_day, "moon" if not Preferences.values.night else "sun")
	_button(row, "Weather", func(): category = "Atmosphere"; navigate("settings"), "settings")
	_coffee(detail)
	network_label = _label(detail, _network_copy(), 16, MUTED)
	if network_status != "OFFLINE": _button(detail, "Leave room", func(): requested.emit("disconnect"), "external")

func _build_detail(body: BoxContainer):
	var rail = Glass.new()
	rail.custom_minimum_size.x = 280
	body.add_child(rail)
	var nav = _box(rail, true, 12)
	_label(nav, "MAKE IT YOURS", 14, MUTED)
	_label(nav, {"garage": "Your garage.", "settings": "Your settings.", "multiplayer": "Drive together.", "credits": "The makers."}[page], 30)
	if page == "settings":
		for title in ["Driving", "Graphics & audio", "Atmosphere", "Accessibility"]:
			var button = _button(nav, title, func(): category = title; _build_menu(), "check" if title == category else "arrow")
			button.custom_minimum_size.y = 88
	if page != "settings":
		_space(nav)
		_label(nav, "YOUR CITY.\nYOUR PACE.", 18, MUTED)
		_coffee(nav)
	var sheet = Glass.new()
	sheet.density = 0.55
	sheet.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(sheet)
	var scroll = ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.follow_focus = true
	sheet.add_child(scroll)
	var content = _box(scroll, true, 16)
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	match page:
		"garage": _garage(content)
		"settings": _settings(content)
		"multiplayer": _multiplayer(content)
		"credits":
			_label(content, "Made for the open road.", 32)
			_label(content, "DriveAtBaku · Credits & licenses", 20, MUTED)
			var notices = RichTextLabel.new()
			notices.text = FileAccess.get_file_as_string("res://assets/data/third-party-notices.txt")
			notices.fit_content = true
			notices.scroll_active = false
			notices.custom_minimum_size.x = 600
			notices.add_theme_font_size_override("normal_font_size", 20)
			content.add_child(notices)

func _garage(content: VBoxContainer):
	_label(content, "Choose your next drive.", 30)
	var grid = GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 14)
	content.add_child(grid)
	for id in VEHICLES:
		var selected = Preferences.values.vehicle == id
		_button(grid, VEHICLES[id], func(): vehicle_selected.emit(id), "check" if selected else "arrow", "Selected" if selected else "Select vehicle", selected)
	_label(content, "THE FINISHING TOUCHES", 15, MUTED)
	var row = _row(content, "Paint")
	var paint = ColorPickerButton.new()
	paint.color = Color(Preferences.values.paint)
	paint.custom_minimum_size = Vector2(220, 88)
	paint.color_changed.connect(func(color): _change("paint", "#" + color.to_html(false)))
	row.add_child(paint)
	_check(content, "Registration plates", "plate_enabled")
	_line(content, "Region", "plate_region", 2)
	_line(content, "Letters", "plate_letters", 2)
	_line(content, "Number", "plate_serial", 3)
	_check(content, "Plate separators", "plate_hyphens")
	_option(content, "Plate format", "plate_format", ["long", "compact"], ["Standard long", "Compact"])
	for aid in ["abs", "tcs", "esc"]: _check(content, aid.to_upper(), aid)

func _settings(content: VBoxContainer):
	_label(content, category, 32)
	match category:
		"Driving":
			_label(content, "Comfortable controls. Confident corners.", 19, MUTED)
			_option(content, "Touch controls", "control_mode", ["buttons", "sliders"], ["Buttons", "Analog sliders"])
			_check(content, "Automatic transmission", "automatic")
			_slider(content, "Steering sensitivity", "sensitivity", 0.4, 1.6)
			_slider(content, "Steering weight", "weight", 0, 1)
			_slider(content, "Quick-turn response", "quick_response", 0, 1)
			_check(content, "Self-centering", "self_center_enabled")
			_slider(content, "Self-centering speed", "self_center", 0, 1)
			_slider(content, "Control size", "control_scale", 0.75, 1.35)
			_check(content, "Mirror control layout", "left_handed")
		"Graphics & audio":
			_option(content, "Graphics quality", "quality", ["performance", "balanced"], ["Performance", "Balanced"])
			_option(content, "Rendering height", "resolution", [540, 720, 900, 1080], ["540p", "720p", "900p", "1080p"])
			_slider(content, "Render distance", "render_distance", 400, 3000, 100)
			_slider(content, "Engine volume", "volume", 0, 1)
		"Atmosphere":
			_check(content, "After hours · Night mode", "night")
			_option(content, "Weather", "weather", ["sunny", "overcast", "wet", "rain", "snow"], ["Sunny", "Overcast", "Wet roads", "Rain", "Snow"])
		"Accessibility":
			_check(content, "Reduce motion", "reduce_motion")
			_check(content, "Increase glass contrast", "reduce_transparency")
			_label(content, "Simpler transitions and deeper surfaces for easier reading.", 19, MUTED)

func _multiplayer(content: VBoxContainer):
	_label(content, "A whole city. Better together.", 32)
	_label(content, "Single player is always available offline.", 20, MUTED)
	_line(content, "Driver nickname", "nickname", 16)
	_line(content, "Relay address", "server_url", 200)
	network_label = _label(content, _network_copy(), 20, MUTED)
	network_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	online_button = _button(content, "Join drive", func(): requested.emit("online"), "people", "Share the road with other drivers", true)
	online_button.disabled = network_status != "OFFLINE"
	online_button.modulate.a = 0.45 if online_button.disabled else 1.0
	_button(content, "Leave room", func(): requested.emit("disconnect"), "external")
	_label(content, "Remote vehicles are non-colliding ghosts.", 18, MUTED)

func _network_copy() -> String:
	match network_status:
		"OFFLINE": return "Single player · Ready when you are"
		"CONNECTING": return "Connecting to the city… You can leave at any time."
		"RECONNECTING": return "Connection lost. Retrying… Leave room to play offline."
		"SERVER FULL", "PROTOCOL MISMATCH", "CONNECTION REJECTED": return network_status.capitalize() + ". Leave room, then try again."
	return network_status.capitalize()

func _toggle_day():
	_change("night", not Preferences.values.night)
	_build_menu()

func _change(key: String, value):
	Preferences.update(key, value)
	setting_changed.emit(key)
	if key in ["reduce_transparency", "quality"]:
		for lens in root.find_children("*", "PanelContainer", true, false):
			if lens.has_method("_refresh"): lens._refresh()

func _row(parent: Node, title: String) -> HBoxContainer:
	var row = _box(parent, false, 20)
	row.custom_minimum_size.y = 88
	var label = _label(row, title, 22)
	label.custom_minimum_size.x = 270
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	return row

func _option(parent: Node, title: String, key: String, options: Array, labels: Array):
	var row = _row(parent, title)
	var select = OptionButton.new()
	select.custom_minimum_size = Vector2(280, 88)
	for label in labels: select.add_item(label)
	select.selected = maxi(0, options.find(Preferences.values[key]))
	select.item_selected.connect(func(i): _change(key, options[i]))
	row.add_child(select)
	fields[key] = select

func _check(parent: Node, title: String, key: String):
	var button = CheckButton.new()
	button.text = title
	button.custom_minimum_size.y = 88
	button.button_pressed = Preferences.values[key]
	button.toggled.connect(func(value): _change(key, value))
	parent.add_child(button)
	for state_name in ["normal", "hover", "pressed", "disabled"]:
		var padding = StyleBoxEmpty.new()
		padding.content_margin_left = 20
		padding.content_margin_right = 20
		button.add_theme_stylebox_override(state_name, padding)
	var lens = Glass.new()
	lens.radius = 34
	lens.density = 0.30
	lens.show_behind_parent = true
	button.add_child(lens)
	_full(lens)
	lens.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fields[key] = button

func _slider(parent: Node, title: String, key: String, low: float, high: float, step = 0.01):
	var group = _box(parent, true, 2)
	var header = _box(group, false, 12)
	_label(header, title, 22).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var value_label = _label(header, str(snappedf(float(Preferences.values[key]), 0.01)), 20, MUTED)
	var slider = HSlider.new()
	slider.min_value = low
	slider.max_value = high
	slider.step = step
	slider.value = Preferences.values[key]
	slider.custom_minimum_size = Vector2(0, 88)
	slider.value_changed.connect(func(value): _change(key, value); value_label.text = str(snappedf(value, 0.01)))
	group.add_child(slider)
	fields[key] = slider

func _line(parent: Node, title: String, key: String, maximum: int):
	var group = _box(parent, true, 6)
	_label(group, title, 18, MUTED)
	var edit = LineEdit.new()
	edit.text = Preferences.values[key]
	edit.max_length = maximum
	edit.custom_minimum_size.y = 88
	edit.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_URL if key == "server_url" else LineEdit.KEYBOARD_TYPE_DEFAULT
	edit.text_changed.connect(func(value): _change(key, value))
	group.add_child(edit)
	fields[key] = edit

func navigate(destination: String):
	page = destination
	_build_menu()

func back():
	if loading_screen.visible:
		if loading_screen.failed: requested.emit("quit")
		return
	if page != "home": navigate("home")
	elif paused: requested.emit("drive")
	else: requested.emit("quit")

func _unhandled_key_input(event):
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_ESCAPE and menu.visible:
		back()
		get_viewport().set_input_as_handled()

func show_loading(message: String, progress = -1.0, failed = false):
	scene_capture.copy_mode = BackBufferCopy.COPY_MODE_DISABLED
	loading_screen.show_message(message, progress, failed)
	menu.hide()
	hud.hide()
	driving = false
	controls.active = false
	controls.clear()
	controls.queue_redraw()

func show_menu(as_pause = false, preserve_page = false):
	scene_capture.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
	driving = false
	paused = as_pause
	if not preserve_page: page = "home"
	controls.active = false
	controls.clear()
	controls.queue_redraw()
	hud.hide()
	_build_menu()
	menu.show()
	loading_screen.finish()

func show_driving():
	scene_capture.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
	driving = true
	loading_screen.finish()
	menu.hide()
	hud.show()
	controls.clear()
	controls.active = true
	controls.queue_redraw()

func update_network(message: String):
	network_status = message
	leave_button.visible = message != "OFFLINE"
	if is_instance_valid(online_button):
		online_button.disabled = message != "OFFLINE"
		online_button.modulate.a = 0.45 if online_button.disabled else 1.0
	if is_instance_valid(network_label): network_label.text = _network_copy()

func update_state(state: Dictionary, connection: String, count: int):
	if state.is_empty(): return
	if network_status != connection: update_network(connection)
	var gear = ["R", "N", "1", "2", "3", "4", "5", "6", "7"][clampi(state.gear, 0, 8)]
	speed.text = "%03d km/h   %s\n%s  ·  %d RPM" % [roundi(Vector2(state.velocity.x, state.velocity.z).length() * 3.6), gear, "AUTO" if state.automatic else "MANUAL", roundi(state.rpm)]
	status.text = "%s  ·  %s  ·  %d DRIVER%s" % [Preferences.values.vehicle.to_upper(), connection, count, "S" if count != 1 else ""]
	telemetry.text = "ABS %s   TCS %s   ESC %s" % ["●" if state.abs_active else "○", "●" if state.tcs_active else "○", "●" if state.esc_active else "○"]
