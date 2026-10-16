extends CanvasLayer

signal requested(action: String)
signal vehicle_selected(id: String)
signal setting_changed(key: String)

var controls = preload("res://scripts/driving_controls.gd").new()
var root = Control.new()
var panel = PanelContainer.new()
var loading = Label.new()
var speed = Label.new()
var status = Label.new()
var telemetry = Label.new()
var menu_title = Label.new()
var tabs = TabContainer.new()
var online_button: Button
var leave_button: Button
var driving = false
var fields: Dictionary = {}
var credits = AcceptDialog.new()

func _ready():
	add_child(root)
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var theme = Theme.new()
	theme.default_font = load("res://assets/data/AlteDIN1451-Regular.ttf")
	theme.default_font_size = 22
	var style = StyleBoxFlat.new()
	style.bg_color = Color(0.055, 0.078, 0.10, 0.94)
	style.border_color = Color(0.65, 0.78, 0.9, 0.26)
	style.set_border_width_all(1)
	style.set_corner_radius_all(22)
	style.content_margin_left = 24
	style.content_margin_right = 24
	style.content_margin_top = 18
	style.content_margin_bottom = 18
	theme.set_stylebox("panel", "PanelContainer", style)
	for state in ["normal", "hover", "pressed", "focus"]:
		var button_style = style.duplicate()
		button_style.bg_color = Color(0.15, 0.24, 0.31, 0.95) if state != "normal" else Color(0.10, 0.15, 0.20, 0.90)
		button_style.set_corner_radius_all(15)
		button_style.content_margin_top = 10
		button_style.content_margin_bottom = 10
		theme.set_stylebox(state, "Button", button_style)
	root.theme = theme
	root.add_child(controls)
	controls.action_requested.connect(func(action): requested.emit(action))
	var toolbar = HBoxContainer.new()
	toolbar.position = Vector2(22, 18)
	toolbar.add_theme_constant_override("separation", 10)
	root.add_child(toolbar)
	for item in [["Menu", "pause"], ["Camera", "camera"], ["Gearbox", "transmission"], ["Lights", "lights"], ["Recover", "recover"]]:
		_button(toolbar, item[0], func(): requested.emit(item[1]))
	leave_button = _button(toolbar, "Leave Room", func(): requested.emit("disconnect"))
	leave_button.hide()
	var signals = HBoxContainer.new()
	signals.position = Vector2(22, 152)
	signals.add_theme_constant_override("separation", 8)
	root.add_child(signals)
	for item in [["‹ Signal", "signal_left"], ["Hazard", "signal_hazard"], ["Signal ›", "signal_right"]]:
		_button(signals, item[0], func(): requested.emit(item[1]))
	status.position = Vector2(26, 90)
	status.add_theme_font_size_override("font_size", 20)
	root.add_child(status)
	speed.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	speed.offset_left = -285
	speed.offset_right = -25
	speed.offset_top = 24
	speed.offset_bottom = 104
	speed.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	speed.add_theme_font_size_override("font_size", 34)
	root.add_child(speed)
	telemetry.position = Vector2(26, 120)
	telemetry.add_theme_font_size_override("font_size", 16)
	root.add_child(telemetry)
	loading.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	loading.offset_left = -420
	loading.offset_right = 420
	loading.offset_top = -70
	loading.offset_bottom = 70
	loading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	loading.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	loading.add_theme_font_size_override("font_size", 30)
	root.add_child(loading)
	_build_menu()
	panel.hide()
	root.add_child(credits)
	credits.title = "Credits and licenses"
	credits.min_size = Vector2i(760, 420)
	var notices = RichTextLabel.new()
	notices.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	notices.text = FileAccess.get_file_as_string("res://assets/data/third-party-notices.txt")
	credits.add_child(notices)

func _button(parent: Node, text: String, callback: Callable) -> Button:
	var button = Button.new()
	button.text = text
	button.custom_minimum_size.y = 48
	button.pressed.connect(callback)
	parent.add_child(button)
	return button

func _build_menu():
	root.add_child(panel)
	panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	panel.offset_left = -440
	panel.offset_top = -290
	panel.offset_right = 440
	panel.offset_bottom = 290
	var content = VBoxContainer.new()
	content.add_theme_constant_override("separation", 10)
	panel.add_child(content)
	menu_title.text = "DRIVE AT BAKU"
	menu_title.add_theme_font_size_override("font_size", 36)
	content.add_child(menu_title)
	var actions = HBoxContainer.new()
	content.add_child(actions)
	_button(actions, "Drive / Resume", func(): requested.emit("drive"))
	online_button = _button(actions, "Join multiplayer", func(): requested.emit("online"))
	_button(actions, "Return to start", func(): requested.emit("restart"))
	tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	tabs.custom_minimum_size.y = 365
	content.add_child(tabs)
	var driving_tab = _tab("Driving")
	_option(driving_tab, "Touch controls", "control_mode", ["buttons", "sliders"], ["Buttons", "Analog sliders"])
	_check(driving_tab, "Automatic transmission", "automatic")
	_slider(driving_tab, "Steering sensitivity", "sensitivity", 0.4, 1.6)
	_slider(driving_tab, "Steering weight", "weight", 0, 1)
	_slider(driving_tab, "Quick-turn response", "quick_response", 0, 1)
	_check(driving_tab, "Self-centering", "self_center_enabled")
	_slider(driving_tab, "Self-centering speed", "self_center", 0, 1)
	_slider(driving_tab, "Control size", "control_scale", 0.75, 1.35)
	_check(driving_tab, "Mirror control layout", "left_handed")
	for aid in ["abs", "tcs", "esc"]:
		_check(driving_tab, aid.to_upper(), aid)
	var garage = _tab("Garage")
	for item in [["ferrari", "Ferrari 458 Italia"], ["elantra", "Hyundai Elantra / Avante"], ["amg", "Mercedes-AMG"], ["prado", "Toyota Prado"]]:
		_button(garage, item[1], func(): vehicle_selected.emit(item[0]))
	var paint_row = HBoxContainer.new()
	garage.add_child(paint_row)
	var paint_label = Label.new()
	paint_label.text = "Paint"
	paint_row.add_child(paint_label)
	var paint = ColorPickerButton.new()
	paint.color = Color(Preferences.values.paint)
	paint.custom_minimum_size = Vector2(140, 48)
	paint.color_changed.connect(func(color): Preferences.update("paint", "#" + color.to_html(false)); setting_changed.emit("paint"))
	paint_row.add_child(paint)
	_check(garage, "Registration plates", "plate_enabled")
	_line(garage, "Plate region", "plate_region", 2)
	_line(garage, "Plate letters", "plate_letters", 2)
	_line(garage, "Plate number", "plate_serial", 3)
	_check(garage, "Plate separators", "plate_hyphens")
	_option(garage, "Plate format", "plate_format", ["long", "compact"], ["Standard long", "Compact"])
	var graphics = _tab("Graphics & audio")
	_option(graphics, "Graphics quality", "quality", ["performance", "balanced"], ["Performance", "Balanced"])
	_option(graphics, "Rendering height", "resolution", [540, 720, 900, 1080], ["540p", "720p", "900p", "1080p"])
	_slider(graphics, "Render distance", "render_distance", 400, 3000, 100)
	_slider(graphics, "Engine volume", "volume", 0, 1)
	_check(graphics, "Night", "night")
	_option(graphics, "Weather", "weather", ["sunny", "overcast", "wet", "rain", "snow"], ["Sunny", "Overcast", "Wet roads", "Rain", "Snow"])
	var online = _tab("Multiplayer")
	_line(online, "Nickname", "nickname", 16)
	_line(online, "Relay address", "server_url", 200)
	var note = Label.new()
	note.text = "Single-player works offline.\nOnline play shares the existing browser relay.\nRemote vehicles are non-colliding ghosts."
	online.add_child(note)
	_button(online, "Leave Room", func(): requested.emit("disconnect"))
	_button(online, "Credits and licenses", func(): credits.popup_centered(Vector2i(820, 500)))
	_button(content, "Quit", func(): requested.emit("quit"))

func _tab(title: String) -> VBoxContainer:
	var scroll = ScrollContainer.new()
	scroll.name = title
	tabs.add_child(scroll)
	var box = VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 8)
	scroll.add_child(box)
	return box

func _row(parent: Node, title: String) -> HBoxContainer:
	var row = HBoxContainer.new()
	parent.add_child(row)
	var label = Label.new()
	label.text = title
	label.custom_minimum_size.x = 270
	row.add_child(label)
	return row

func _option(parent: Node, title: String, key: String, options: Array, labels: Array):
	var row = _row(parent, title)
	var select = OptionButton.new()
	select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for label in labels: select.add_item(label)
	select.selected = maxi(0, options.find(Preferences.values[key]))
	select.item_selected.connect(func(i): Preferences.update(key, options[i]); setting_changed.emit(key))
	row.add_child(select)
	fields[key] = select

func _check(parent: Node, title: String, key: String):
	var button = CheckButton.new()
	button.text = title
	button.button_pressed = Preferences.values[key]
	button.toggled.connect(func(value): Preferences.update(key, value); setting_changed.emit(key))
	parent.add_child(button)
	fields[key] = button

func _slider(parent: Node, title: String, key: String, low: float, high: float, step = 0.01):
	var row = _row(parent, title)
	var slider = HSlider.new()
	slider.min_value = low
	slider.max_value = high
	slider.step = step
	slider.value = Preferences.values[key]
	slider.custom_minimum_size = Vector2(300, 40)
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var value_label = Label.new()
	value_label.custom_minimum_size.x = 60
	value_label.text = str(snappedf(slider.value, 0.01))
	slider.value_changed.connect(func(value): Preferences.update(key, value); value_label.text = str(snappedf(value, 0.01)); setting_changed.emit(key))
	row.add_child(slider)
	row.add_child(value_label)
	fields[key] = slider

func _line(parent: Node, title: String, key: String, maximum: int):
	var row = _row(parent, title)
	var edit = LineEdit.new()
	edit.text = Preferences.values[key]
	edit.max_length = maximum
	edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	edit.text_changed.connect(func(value): Preferences.update(key, value); setting_changed.emit(key))
	row.add_child(edit)
	fields[key] = edit

func show_loading(message: String):
	loading.text = message
	loading.show()
	panel.hide()
	controls.active = false
	controls.clear()

func show_menu():
	loading.hide()
	panel.show()
	controls.active = false
	controls.clear()
	controls.queue_redraw()
	if fields.has("automatic"):
		fields.automatic.set_pressed_no_signal(Preferences.values.automatic)

func show_driving():
	loading.hide()
	panel.hide()
	controls.active = true
	controls.queue_redraw()

func update_state(state: Dictionary, network_status: String, count: int):
	if state.is_empty(): return
	leave_button.visible = network_status.begins_with("ONLINE") or network_status in ["CONNECTING", "RECONNECTING"]
	online_button.disabled = leave_button.visible
	var gear = ["R", "N", "1", "2", "3", "4", "5", "6", "7"][clampi(state.gear, 0, 8)]
	speed.text = "%03d km/h   %s\n%s  ·  %d RPM" % [roundi(Vector2(state.velocity.x, state.velocity.z).length() * 3.6), gear, "AUTO" if state.automatic else "MANUAL", roundi(state.rpm)]
	status.text = "%s  ·  %s  ·  %d DRIVER%s" % [Preferences.values.vehicle.to_upper(), network_status, count, "S" if count != 1 else ""]
	telemetry.text = "%d FPS    ABS %s   TCS %s   ESC %s" % [Engine.get_frames_per_second(), "●" if state.abs_active else "○", "●" if state.tcs_active else "○", "●" if state.esc_active else "○"]
