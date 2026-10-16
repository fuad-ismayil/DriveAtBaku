extends "res://scripts/interface.gd"

# Desktop layout follows the Web UI in CSS pixels. Mobile retains interface.gd.
var desktop_canvas: Control
var desktop_card: Control
var location_card: Control
var plate_frame: Control
var desktop_origin = "home"
var multiplayer_expanded = false

func _coffee(parent: Node):
	var button = _button(parent, "Buy me a coffee", _open_coffee, "coffee")
	button.custom_minimum_size.y = 40
	return button

func _ready():
	Preferences.values.touch_controls = false
	super._ready()

func _build_theme():
	super._build_theme()
	root.theme.default_font_size = 12
	var thumb_image = Image.new()
	thumb_image.load_svg_from_string('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#f5f9fc" stroke="#ffffff"/></svg>')
	for state_name in ["grabber", "grabber_highlight", "grabber_disabled"]: root.theme.set_icon(state_name, "HSlider", ImageTexture.create_from_image(thumb_image))
	for kind in ["Button", "OptionButton", "LineEdit", "CheckButton", "PopupMenu"]:
		root.theme.set_font_size("font_size", kind, 12)
		for state_name in ["normal", "hover", "pressed", "focus", "disabled", "read_only", "panel"]:
			var style = root.theme.get_stylebox(state_name, kind).duplicate()
			style.set_corner_radius_all(13)
			style.content_margin_top = 9
			style.content_margin_bottom = 9
			style.content_margin_left = 12
			style.content_margin_right = 12
			root.theme.set_stylebox(state_name, kind, style)
	for state_name in ["normal", "hover", "pressed", "focus", "disabled"]: root.theme.set_stylebox(state_name, "CheckButton", StyleBoxEmpty.new())
	for on in [true, false]:
		var image = Image.new()
		image.load_svg_from_string('<svg xmlns="http://www.w3.org/2000/svg" width="38" height="23"><rect x=".5" y=".5" width="37" height="22" rx="11" fill="%s" stroke="#ffffff66"/><circle cx="%d" cy="11.5" r="7.5" fill="#ffffff"/></svg>' % ["#d4e6f066" if on else "#ffffff1a", 27 if on else 11])
		for suffix in ["", "_disabled", "_mirrored", "_disabled_mirrored"]: root.theme.set_icon(("on" if on else "off") + suffix, "CheckButton", ImageTexture.create_from_image(image))

func _label(parent: Node, text: String, font_size = 22, color = Color.WHITE) -> Label:
	var label = super._label(parent, text, font_size, color)
	if font_size >= 30:
		var font = root.theme.default_font.duplicate()
		font.font_weight = 500
		label.add_theme_font_override("font", font)
	return label

func _button(parent: Node, text: String, callback: Callable, icon = "arrow", subtitle = "", primary = false) -> Button:
	var button = super._button(parent, text, callback, icon, subtitle, primary)
	button.custom_minimum_size = Vector2(48 if text.is_empty() else 0, 63 if not subtitle.is_empty() else 48)
	var lens = button.get_child(0)
	lens.radius = 24
	lens.density = 0.30 if primary else 0.22
	lens._refresh()
	button.set_meta("glass_density", lens.density)
	for label in button.find_children("*", "Label", true, false): label.add_theme_font_size_override("font_size", 11 if label.text == subtitle else 12)
	for artwork in button.find_children("*", "TextureRect", true, false): artwork.custom_minimum_size = Vector2(18, 18)
	return button

func _row(parent: Node, title: String) -> HBoxContainer:
	var row = _box(parent, false, 12)
	row.custom_minimum_size.y = 52
	var label = _label(row, title, 12)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return row

func _hint(parent: Node, text: String) -> Label:
	var label = _label(parent, text, 11, MUTED)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return label

func _option(parent: Node, title: String, key: String, options: Array, labels: Array):
	var row = _row(parent, title)
	var select = OptionButton.new()
	select.custom_minimum_size = Vector2(135, 40)
	select.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	for label in labels: select.add_item(label)
	select.selected = maxi(0, options.find(Preferences.values[key]))
	select.item_selected.connect(func(i): _change(key, options[i]))
	select.accessibility_name = title
	row.add_child(select)
	fields[key] = select

func _check(parent: Node, title: String, key: String, description = ""):
	var row = _row(parent, title)
	var toggle = CheckButton.new()
	toggle.button_pressed = Preferences.values[key]
	toggle.custom_minimum_size = Vector2(48, 40)
	toggle.accessibility_name = title
	toggle.tooltip_text = description
	toggle.toggled.connect(func(on): _change(key, on))
	row.add_child(toggle)
	fields[key] = toggle

func _slider(parent: Node, title: String, key: String, low: float, high: float, step = 0.01):
	var group = _box(parent, true, 2)
	var heading = _row(group, title)
	heading.custom_minimum_size.y = 24
	var amount = _label(heading, _setting_value(key, Preferences.values[key]), 11, MUTED)
	var slider = HSlider.new()
	slider.min_value = low
	slider.max_value = high
	slider.step = step
	slider.value = Preferences.values[key]
	slider.custom_minimum_size.y = 26
	slider.scrollable = false
	slider.accessibility_name = title
	slider.value_changed.connect(func(value): _change(key, value); amount.text = _setting_value(key, value))
	group.add_child(slider)
	fields[key] = slider

func _line(parent: Node, title: String, key: String, maximum: int):
	var group = _box(parent, true, 6)
	_label(group, title, 10, MUTED)
	var edit = LineEdit.new()
	edit.text = Preferences.values[key]
	edit.max_length = maximum
	edit.custom_minimum_size.y = 44
	edit.accessibility_name = title
	edit.text_changed.connect(func(value): _change(key, value))
	group.add_child(edit)
	fields[key] = edit

func _build_hud():
	super._build_hud()
	var spec = preload("res://scripts/presentation_spec.gd").data.minimap
	minimap_button.size = Vector2.ONE * spec.diameter
	minimap.position = Vector2.ONE * spec.inset
	minimap.size = Vector2.ONE * (spec.diameter - spec.inset * 2)
	minimap_button.get_child(0).radius = spec.diameter * .5
	minimap_button.get_child(0)._refresh()
	minimap_button.get_theme_stylebox("focus").set_corner_radius_all(int(spec.diameter * .5))
	minimap_button.get_child(2).position = Vector2.ONE * (spec.diameter - 42)
	minimap_button.tooltip_text = "City map · M"
	hud_toolbar.hide()
	hud_signals.hide()
	for aid in aid_labels:
		aid_labels[aid].mouse_filter = Control.MOUSE_FILTER_STOP
		aid_labels[aid].gui_input.connect(func(event):
			if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed: requested.emit("aid_" + aid))

func _build_map():
	super._build_map()
	map_header.get_child(0).add_theme_font_size_override("font_size", 24)
	map_header.get_child(map_header.get_child_count() - 1).custom_minimum_size = Vector2(200, 56)
	map_footer.get_child(0).text = "Drag to explore · Scroll or pinch to zoom\nWhite: you · Gold: other drivers"
	map_footer.get_child(0).add_theme_font_size_override("font_size", 14)
	for child in map_footer.get_children():
		if child is Button: child.custom_minimum_size.y = 56

func _safe_layout():
	if not is_instance_valid(root): return
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]: safe.add_theme_constant_override(side, 0)
	version_label.position = Vector2(24, root.size.y - 26)
	loading_screen.set_insets(Vector4(36, 30, 36, 36))
	if is_instance_valid(hud_toolbar):
		hud_toolbar.hide()
		hud_signals.hide()
		minimap_button.position = Vector2(root.size.x - minimap_button.size.x - 16, 12)
		_fit_instruments(Vector4(0, 0, 0, 24))
		controls.blocked_regions = [minimap_button.get_global_rect(), instruments.get_global_rect()]
		map_sheet.position = Vector2(36, 24)
		map_sheet.size = root.size - Vector2(72, 48)
		map_header.position = Vector2.ZERO
		map_header.size = Vector2(map_sheet.size.x, 56)
		expanded_map.position = Vector2(0, 72)
		expanded_map.size = map_sheet.size - Vector2(0, 144)
		map_footer.position = Vector2(0, map_sheet.size.y - 56)
		map_footer.size = Vector2(map_sheet.size.x, 56)
	if is_instance_valid(desktop_canvas): _layout_desktop()
	if is_instance_valid(inspection): _position_inspection()

func _update_hud_exclusions():
	if is_instance_valid(minimap_button): controls.blocked_regions = [minimap_button.get_global_rect(), instruments.get_global_rect()]

func _layout_desktop():
	var w = root.size.x
	var h = root.size.y
	desktop_canvas.size = root.size
	if page == "home" and not paused:
		var card_height = minf(menu_content.get_combined_minimum_size().y + 44, maxf(250, h - 176))
		desktop_card.position = Vector2(clampf(w * 0.05, 24, 96), 100 + maxf(0, (h - 176 - card_height) * .5))
		desktop_card.size = Vector2(minf(440, w - 48), card_height)
		var title = menu_content.get_node_or_null("DesktopTitle")
		if title: title.add_theme_font_size_override("font_size", roundi(clampf(w * .045, 52, 68)))
		if is_instance_valid(location_card):
			location_card.visible = w >= 1000
			location_card.position = Vector2(w - clampf(w * 0.04, 24, 76) - 295, h - 176)
	elif page == "garage":
		desktop_card.position = Vector2(24, 24)
		desktop_card.size = Vector2(minf(500, w - 48), h - 48)
	else:
		desktop_card.size = Vector2(minf(1140 if page in ["home", "settings"] else 560, w - 32), minf(680, h - 32))
		desktop_card.position = (root.size - desktop_card.size) * 0.5
	var logo = desktop_canvas.get_node_or_null("Wordmark")
	if logo: logo.position = Vector2(clampf(w * .05, 24, 96), 30)
	var place = desktop_canvas.get_node_or_null("Place")
	if place: place.position = Vector2(w - clampf(w * .04, 24, 76) - 160, 32)

func _build_menu():
	if transition and transition.is_valid(): transition.kill()
	if is_instance_valid(plate_editor): plate_editor._commit()
	for child in safe.get_children():
		safe.remove_child(child)
		child.queue_free()
	fields.clear()
	vehicle_buttons.clear()
	navigation_buttons.clear()
	plate_editor = null
	plate_frame = null
	detail_scroll = null
	vehicle_feedback = null
	online_button = null
	network_label = null
	location_card = null
	desktop_canvas = Control.new()
	safe.add_child(desktop_canvas)
	menu_content = VBoxContainer.new()
	desktop_card = Glass.new()
	desktop_card.radius = 34 if page == "home" and not paused else 30
	desktop_card.density = 0.30
	if paused or page == "settings": desktop_card.density = 0.50
	desktop_canvas.add_child(desktop_card)
	var scroll = ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.follow_focus = true
	desktop_card.add_child(scroll)
	detail_scroll = scroll
	menu_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	menu_content.add_theme_constant_override("separation", 12)
	scroll.add_child(menu_content)
	if page == "home" and not paused:
		_desktop_home(menu_content)
	elif page in ["home", "settings"]:
		_desktop_pause(menu_content)
	elif page == "garage":
		_desktop_garage(menu_content)
	elif page == "controls":
		_desktop_controls(menu_content)
	elif page == "multiplayer":
		_label(menu_content, "MULTIPLAYER DRIVE", 10, MUTED)
		_label(menu_content, "Drive together", 36)
		_line(menu_content, "DRIVER NICKNAME", "nickname", 16)
		_line(menu_content, "SERVER URL", "server_url", 200)
		network_label = _label(menu_content, _network_copy(), 12, MUTED)
		online_button = _button(menu_content, "JOIN DRIVE", func(): requested.emit("online"), "people", "", true)
		_button(menu_content, "Leave room", func(): requested.emit("disconnect"), "external")
		_button(menu_content, "BACK", back, "back")
	else:
		_label(menu_content, "Made for the open road.", 32)
		var notices = RichTextLabel.new()
		notices.text = FileAccess.get_file_as_string("res://assets/data/third-party-notices.txt")
		notices.fit_content = true
		notices.custom_minimum_size.x = 400
		notices.add_theme_font_size_override("normal_font_size", 12)
		menu_content.add_child(notices)
		_button(menu_content, "BACK", back, "back")
	_layout_desktop()
	call_deferred("_focus_first_action")

func _focus_first_action():
	if not menu.visible: return
	for button in menu_content.find_children("*", "BaseButton", true, false):
		if button.is_visible_in_tree() and not button.disabled:
			button.grab_focus()
			return

func _desktop_home(content: VBoxContainer):
	var wordmark = TextureRect.new()
	wordmark.name = "Wordmark"
	wordmark.texture = load("res://assets/ui/wordmark.svg")
	wordmark.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	wordmark.size = Vector2(220, 53)
	desktop_canvas.add_child(wordmark)
	var place = _label(desktop_canvas, "●  Baku, Azerbaijan", 11, MUTED)
	place.name = "Place"
	_label(content, "●  THE CITY IS YOURS", 9, MUTED)
	var title = _label(content, "DriveAt\nBaku.", 68)
	title.name = "DesktopTitle"
	title.add_theme_constant_override("line_spacing", -12)
	_label(content, "Nowhere to be. Everything to discover.", 12, MUTED)
	_button(content, "Start driving", func(): requested.emit("drive"), "arrow", "Single player · Free roam", true)
	_button(content, "Drive together", func(): multiplayer_expanded = not multiplayer_expanded; _build_menu(), "arrow", "Multiplayer")
	if multiplayer_expanded:
		_label(content, "MULTIPLAYER DRIVE", 11, MUTED)
		_line(content, "DRIVER NICKNAME", "nickname", 16)
		_line(content, "SERVER URL", "server_url", 200)
		network_label = _label(content, _network_copy(), 12, MUTED)
		online_button = _button(content, "JOIN DRIVE", func(): requested.emit("online"), "people", "", true)
		_button(content, "Leave room", func(): requested.emit("disconnect"), "external")
	_button(content, "Your garage", func(): navigate("garage"), "garage", "Four ways to make it yours")
	_button(content, "Quit game", func(): requested.emit("quit"), "close")
	var settings = _box(content, false, 8)
	_button(settings, "Night mode" if Preferences.values.night else "Day mode", _toggle_day, "moon" if Preferences.values.night else "sun")
	_button(settings, "Controls", func(): navigate("controls"), "keyboard")
	_option(content, "Atmosphere", "weather", ["sunny", "overcast", "wet", "rain", "snow"], ["Sunny", "Overcast", "Wet roads · no rain", "Rain", "Snow"])
	_coffee(content)
	var credits = Button.new()
	credits.text = "Credits & licenses"
	credits.flat = true
	credits.pressed.connect(func(): navigate("credits"))
	content.add_child(credits)
	location_card = Glass.new()
	location_card.size = Vector2(295, 100)
	desktop_canvas.add_child(location_card)
	var location = _box(location_card, true, 6)
	_label(location, "YOUR NEXT CHAPTER", 8, MUTED)
	_label(location, "Along the Caspian", 17)
	_label(location, "6.003 KM · " + ("NIGHT" if Preferences.values.night else "DAY"), 9, MUTED)

func _desktop_pause(content: VBoxContainer):
	_label(content, "DriveAtBaku / PAUSED" if paused else "DriveAtBaku / SETTINGS", 9, MUTED)
	_label(content, "TAKE A BREATH." if paused else "MAKE IT YOURS.", 42)
	_label(content, "Your city. Your pace. Your settings.", 12, MUTED)
	var columns = _box(content, root.size.x < 1000, 26)
	var session_column = _box(columns, true, 9)
	session_column.custom_minimum_size.x = 190
	session_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	session_column.size_flags_stretch_ratio = .72
	_label(session_column, "YOUR DRIVE", 10, MUTED)
	_button(session_column, "RESUME DRIVING" if paused else "BACK TO MENU", func(): requested.emit("drive") if paused else navigate("home"), "play", "", true)
	_hint(session_column, "Press Esc to return to the road" if paused else "Preferences save automatically")
	_button(session_column, "Your garage", func(): desktop_origin = "pause"; navigate("garage"), "garage")
	_button(session_column, "Controls", func(): desktop_origin = "pause"; navigate("controls"), "keyboard")
	_button(session_column, "Recover car", func(): requested.emit("recover"); requested.emit("drive"), "recover")
	if network_status != "OFFLINE": _button(session_column, "Leave room", func(): requested.emit("disconnect"), "external")
	_button(session_column, "Main menu", func(): requested.emit("main_menu"), "back")
	_button(session_column, "Quit game", func(): requested.emit("quit"), "close")
	_coffee(session_column)
	var graphics = _box(columns, true, 4)
	graphics.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	graphics.size_flags_stretch_ratio = 1.15
	_label(graphics, "01  GRAPHICS & DISPLAY", 10, MUTED)
	_option(graphics, "Graphics quality", "quality", ["performance", "balanced", "high", "ultra"], ["Performance", "Balanced", "High", "Ultra"])
	_option(graphics, "Rendering Resolution", "resolution", [0, 2160, 1440, 1080, 900, 720], ["Native", "3840×2160", "2560×1440", "1920×1080", "1600×900", "1280×720"])
	_option(graphics, "Native render scale", "render_scale", [1.0, 1.25, 1.5], ["Native", "125%", "150%"])
	_option(graphics, "Aspect ratio", "aspect_ratio", ["auto", "16:9", "16:10", "21:9", "4:3"], ["Auto · Fill screen", "16:9", "16:10", "21:9", "4:3"])
	_check(graphics, "Fullscreen · F11", "fullscreen")
	_check(graphics, "Vertical sync", "vsync")
	_option(graphics, "Frame limit", "frame_limit", [0, 30, 60, 90, 120, 144, 165, 240], ["Unlimited", "30 FPS", "60 FPS", "90 FPS", "120 FPS", "144 FPS", "165 FPS", "240 FPS"])
	_slider(graphics, "Render distance", "render_distance", 400, 6000, 100)
	_slider(graphics, "Props distance", "props_distance", 100, 3000, 50)
	_check(graphics, "Ambient occlusion", "ambient_occlusion")
	var atmosphere = _box(columns, true, 4)
	atmosphere.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	atmosphere.size_flags_stretch_ratio = 1.1
	_label(atmosphere, "02  ATMOSPHERE & AUDIO", 10, MUTED)
	_check(atmosphere, "Night mode", "night")
	_option(atmosphere, "Weather", "weather", ["sunny", "overcast", "wet", "rain", "snow"], ["Sunny", "Overcast", "Wet roads · no rain", "Rain", "Snow"])
	_slider(atmosphere, "Rain / snow amount", "precipitation", 0, 2, .05)
	_slider(atmosphere, "Engine volume", "volume", 0, 0.65)
	_check(atmosphere, "Mute all sounds", "audio_muted")
	_check(atmosphere, "Reduce motion", "reduce_motion")
	_check(atmosphere, "Increase glass contrast", "reduce_transparency")
	for aid in ["abs", "tcs", "esc"]: _check(atmosphere, aid.to_upper(), aid)

func _desktop_controls(content: VBoxContainer):
	_label(content, "DRIVER BRIEFING / 01", 10, MUTED)
	_label(content, "CONTROLS", 40)
	for item in [["W / S", "Throttle / brake and reverse"], ["A / D", "Steer"], ["SPACE", "Handbrake"], ["T", "Automatic / manual gearbox"], ["Q / E", "Shift down / up"], ["1 / 2 / 3", "ABS / traction / stability aids"], ["H", "Horn"], ["M", "Full player map"], ["L", "Low beams / high beams / off"], [", / . / /", "Left / right / hazard lights"], ["C", "Follow / hood camera"], ["MOUSE", "Look around"], ["MIDDLE MOUSE", "Hold to look back"], ["R / SHIFT + R", "Recover here / return to start"], ["ESC", "Pause"], ["F11", "Fullscreen"]]:
		var row = _row(content, item[1])
		row.custom_minimum_size.y = 32
		_label(row, item[0], 10, MUTED)
	_button(content, "BACK", back, "back")

func _desktop_garage(content: VBoxContainer):
	_label(content, "DriveAtBaku / GARAGE", 10, MUTED)
	_label(content, "YOUR GARAGE", 39)
	_hint(content, "Choose your ride, pick a finish, and own the city.")
	var grid = GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	content.add_child(grid)
	var selection = ButtonGroup.new()
	selection.allow_unpress = false
	for id in VEHICLES:
		var button = _button(grid, {"ferrari": "FERRARI 458 ITALIA", "elantra": "ELANTRA / AVANTE MD", "amg": "MERCEDES-AMG", "prado": "TOYOTA PRADO"}[id], func(): vehicle_selected.emit(id), "arrow", {"ferrari": "Rear-wheel drive · V8", "elantra": "2012 city sedan", "amg": "Performance", "prado": "SUV"}[id])
		button.custom_minimum_size = Vector2(205, 96)
		button.toggle_mode = true
		button.button_group = selection
		button.get_child(0).radius = 18
		vehicle_buttons[id] = button
	_label(content, "PAINT COLOR", 9, MUTED)
	var paints = _box(content, false, 10)
	for hex in ["#a80719", "#b9c3ca", "#f4f1e9", "#101b28", "#123a79", "#f1bd18"]:
		var swatch = Button.new()
		var style = StyleBoxFlat.new()
		style.bg_color = Color(hex)
		style.set_corner_radius_all(14)
		swatch.custom_minimum_size = Vector2(28, 28)
		swatch.add_theme_stylebox_override("normal", style)
		swatch.pressed.connect(func(): _change("paint", hex))
		paints.add_child(swatch)
	var custom = ColorPickerButton.new()
	custom.color = Color(Preferences.values.paint)
	custom.edit_alpha = false
	custom.custom_minimum_size = Vector2(28, 28)
	custom.color_changed.connect(func(color): _change("paint", "#" + color.to_html(false)))
	paints.add_child(custom)
	fields.paint = custom
	plate_frame = Control.new()
	content.add_child(plate_frame)
	plate_editor = preload("res://scripts/plate_editor.gd").new()
	plate_editor.interface = self
	plate_editor.desktop = true
	plate_frame.add_child(plate_editor)
	plate_editor.size.x = 420
	plate_frame.custom_minimum_size = Vector2(0, 400)
	vehicle_feedback = _label(content, "Ready to drive", 11, MUTED)
	_button(content, "BACK", back, "back", "", true)
	_refresh_vehicle_selection()

func _refresh_vehicle_selection():
	for id in vehicle_buttons:
		vehicle_buttons[id].disabled = not busy_vehicle.is_empty()
		var selected = id == Preferences.values.vehicle
		vehicle_buttons[id].set_pressed_no_signal(selected)
		vehicle_buttons[id].get_child(0).density = .46 if selected else .22
		vehicle_buttons[id].set_meta("glass_density", .46 if selected else .22)
		vehicle_buttons[id].get_child(0)._refresh()
	if is_instance_valid(plate_editor): plate_editor._refresh()

func _process(dt):
	super._process(dt)
	if is_instance_valid(plate_frame) and is_instance_valid(plate_editor):
		var factor = minf(1.0, plate_frame.size.x / maxf(1, plate_editor.get_combined_minimum_size().x))
		plate_editor.scale = Vector2.ONE * factor
		plate_editor.size.x = plate_frame.size.x / maxf(factor, .1)
		plate_frame.custom_minimum_size.y = plate_editor.get_combined_minimum_size().y * factor

func back():
	if page in ["garage", "controls"] and paused:
		navigate("home")
		return
	super.back()

func show_driving():
	super.show_driving()
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func show_menu(as_pause = false, preserve_page = false):
	super.show_menu(as_pause, preserve_page)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func show_map():
	super.show_map()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func close_map():
	super.close_map()
	if driving: Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
