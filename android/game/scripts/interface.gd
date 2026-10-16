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
var garage_category = "Vehicles"
var plate_view = "car"
var busy_vehicle = ""
var vehicle_buttons: Dictionary = {}
var vehicle_feedback: Label
var detail_scroll: ScrollContainer
var scroll_positions: Dictionary = {}
var compact_layout = false
var hud_toolbar: BoxContainer
var hud_signals: BoxContainer
var instruments = Control.new()
var speed_unit = Label.new()
var transmission_label = Label.new()
var aid_labels: Dictionary = {}
var minimap_button: Button
var minimap = preload("res://scripts/map_view.gd").new()
var expanded_map = preload("res://scripts/map_view.gd").new()
var map_overlay = Control.new()
var map_sheet = Control.new()
var map_header: BoxContainer
var map_footer: BoxContainer
var gear_label = Label.new()
var gearbox_button: Button
var plate_editor
var inspection: Control
var keyboard_height = 0
var navigation_buttons: Array[Button] = []
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
	_build_map()
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
	theme.default_font_size = 26
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
	var thumb = Image.new()
	thumb.load_svg_from_string('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><circle cx="18" cy="18" r="15" fill="#f2f7f6" stroke="#718f8a" stroke-width="2"/></svg>')
	for state_name in ["grabber", "grabber_highlight", "grabber_disabled"]:
		theme.set_icon(state_name, "HSlider", ImageTexture.create_from_image(thumb))
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
		if keyboard_height > 0: inset.w = maxf(inset.w, minf(keyboard_height * ratio.y + 16, root.size.y - 280))
	for pair in [["margin_left", inset.x], ["margin_top", inset.y], ["margin_right", inset.z], ["margin_bottom", inset.w]]:
		safe.add_theme_constant_override(pair[0], int(pair[1]))
	loading_screen.set_insets(inset)
	# Menu padding is decorative; controls only need the physical obstruction.
	controls.safe_insets = Vector4(maxf(0, inset.x - 36), maxf(0, inset.y - 24), maxf(0, inset.z - 36), maxf(0, inset.w - 24))
	controls._layout()
	if is_instance_valid(hud_toolbar):
		var hud_corner = Vector2(maxf(16, inset.x - 16), maxf(12, inset.y - 10))
		hud_toolbar.position = hud_corner
		hud_signals.position = hud_corner + Vector2(0, 64)
		minimap_button.position = Vector2(root.size.x - maxf(16, inset.z - 16) - minimap_button.size.x, hud_corner.y)
		map_sheet.position = Vector2(inset.x, inset.y)
		map_sheet.size = root.size - Vector2(inset.x + inset.z, inset.y + inset.w)
		map_header.position = Vector2(12, 0)
		map_header.size.x = map_sheet.size.x - 24
		expanded_map.position = Vector2(12, 100)
		expanded_map.size = map_sheet.size - Vector2(24, 204)
		map_footer.position = Vector2(12, map_sheet.size.y - 92)
		map_footer.size.x = map_sheet.size.x - 24
		_fit_instruments(inset)
		call_deferred("_update_hud_exclusions")
	if is_instance_valid(inspection): _position_inspection()
	var next_compact = root.size.x < 1250
	if compact_layout != next_compact:
		compact_layout = next_compact
		if menu.visible: _build_menu()

func _process(_dt):
	if not OS.has_feature("android"): return
	var height = DisplayServer.virtual_keyboard_get_height()
	if height == keyboard_height: return
	keyboard_height = height
	_safe_layout()
	var focus = get_viewport().gui_get_focus_owner()
	if is_instance_valid(detail_scroll) and is_instance_valid(focus): detail_scroll.call_deferred("ensure_control_visible", focus)

func _label(parent: Node, text: String, font_size = 22, color = Color.WHITE) -> Label:
	var label = Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
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
	button.accessibility_name = text if not text.is_empty() else icon.capitalize()
	button.custom_minimum_size = Vector2(0, 88)
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for state_name in ["normal", "hover", "pressed", "disabled"]: button.add_theme_stylebox_override(state_name, StyleBoxEmpty.new())
	parent.add_child(button)
	var lens = Glass.new()
	lens.radius = 44 if primary else 24
	lens.density = 0.52 if primary else 0.72
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
		var title_label = _label(words, text, 28 if primary else 26)
		title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		title_label.add_theme_font_override("font", medium_font)
		if not subtitle.is_empty(): _label(words, subtitle, 20, MUTED).autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_icon(row, icon, 28)
	button.custom_minimum_size.x = 88 if text.is_empty() else 200
	_ignore_children(button)
	button.pressed.connect(callback)
	button.button_down.connect(func(): _press(button, lens, true))
	button.button_up.connect(func(): _press(button, lens, false))
	button.mouse_exited.connect(func(): _press(button, lens, false))
	return button

func _press(button: Button, lens: Control, down: bool):
	lens.density = 0.42 if down else button.get_meta("glass_density", 0.52 if button.button_pressed else 0.72)
	lens._refresh()
	if Preferences.values.reduce_motion:
		button.scale = Vector2.ONE
		return
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
	var toolbar = _box(hud, false, 0)
	hud_toolbar = toolbar
	toolbar.resized.connect(_update_hud_exclusions)
	for item in [["Pause", "pause", "pause"], ["Camera", "camera", "camera"], ["Gearbox", "transmission", "gear"], ["Lights", "lights", "lights"], ["Recover", "recover", "recover"]]:
		var button = _hud_button(toolbar, item[0], func(): requested.emit(item[1]), item[2])
		if item[1] == "transmission": gearbox_button = button
	leave_button = _hud_button(toolbar, "Leave room", func(): requested.emit("disconnect"), "external")
	leave_button.hide()
	var signals = _box(hud, false, 0)
	hud_signals = signals
	signals.resized.connect(_update_hud_exclusions)
	for item in [["Left", "signal_left", "left"], ["Hazards", "signal_hazard", "hazard"], ["Right", "signal_right", "arrow"]]:
		_hud_button(signals, item[0] + " indicator" if item[0] != "Hazards" else "Hazard lights", func(): requested.emit(item[1]), item[2])
	hud.add_child(instruments)
	instruments.size = Vector2(264, 62)
	instruments.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# Only text occupies the bottom center. Keep the car silhouette completely
	# clear; contrast comes from a fine text outline rather than a panel or lens.
	for label in [speed, speed_unit, gear_label, transmission_label, telemetry, status]:
		instruments.add_child(label)
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		label.add_theme_color_override("font_outline_color", Color(0.015, 0.025, 0.035, 0.8))
		label.add_theme_constant_override("outline_size", 3)
	speed.position = Vector2(16, -2)
	speed.size = Vector2(90, 40)
	speed.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	speed.add_theme_font_size_override("font_size", 32)
	speed.add_theme_font_override("font", medium_font)
	speed_unit.text = "km/h"
	speed_unit.position = Vector2(112, 17)
	speed_unit.add_theme_font_size_override("font_size", 14)
	gear_label.position = Vector2(164, 3)
	gear_label.size = Vector2(32, 32)
	gear_label.add_theme_font_size_override("font_size", 24)
	gear_label.add_theme_color_override("font_color", Color("c8f3ee"))
	transmission_label.position = Vector2(202, 13)
	transmission_label.add_theme_font_size_override("font_size", 12)
	telemetry.position = Vector2(0, 40)
	telemetry.size.x = 264
	telemetry.add_theme_font_size_override("font_size", 15)
	telemetry.add_theme_color_override("font_color", Color(0.88, 0.93, 0.94))
	var details = _box(instruments, false, 10)
	details.mouse_filter = Control.MOUSE_FILTER_IGNORE
	details.position = Vector2(0, 40)
	details.size = Vector2(264, 18)
	details.alignment = BoxContainer.ALIGNMENT_CENTER
	telemetry.reparent(details)
	for aid in ["abs", "tcs", "esc"]:
		var label = _label(details, aid.to_upper(), 14)
		label.add_theme_color_override("font_outline_color", Color(0.015, 0.025, 0.035, 0.8))
		label.add_theme_constant_override("outline_size", 3)
		aid_labels[aid] = label
	status.position = Vector2(0, -20)
	status.size.x = 264
	status.add_theme_font_size_override("font_size", 12)
	status.add_theme_color_override("font_color", Color("f4c56a"))
	minimap_button = Button.new()
	hud.add_child(minimap_button)
	minimap_button.size = Vector2(152, 152)
	for state_name in ["normal", "hover", "pressed", "disabled"]: minimap_button.add_theme_stylebox_override(state_name, StyleBoxEmpty.new())
	var focus = StyleBoxFlat.new()
	focus.bg_color = Color.TRANSPARENT
	focus.border_color = Color("b5f1e8")
	focus.set_border_width_all(2)
	focus.set_corner_radius_all(76)
	minimap_button.add_theme_stylebox_override("focus", focus)
	minimap_button.tooltip_text = "Open city map"
	minimap_button.accessibility_name = "Open city map"
	minimap_button.pressed.connect(func(): requested.emit("map"))
	var rim = Glass.new()
	rim.radius = 76
	rim.density = 0.22
	minimap_button.add_child(rim)
	_full(rim)
	minimap_button.add_child(minimap)
	minimap.position = Vector2(4, 4)
	minimap.size = Vector2(144, 144)
	var expand = TextureRect.new()
	expand.texture = Icons.get_icon("external")
	expand.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	expand.position = Vector2(118, 113)
	expand.size = Vector2(16, 16)
	minimap_button.add_child(expand)
	_ignore_children(minimap_button)

func _fit_instruments(inset: Vector4):
	instruments.position = Vector2((root.size.x - instruments.size.x) * 0.5, root.size.y - maxf(12, inset.w - 12) - instruments.size.y)

func _update_hud_exclusions():
	if not is_instance_valid(minimap_button): return
	controls.blocked_regions = [minimap_button.get_global_rect(), hud_toolbar.get_global_rect(), hud_signals.get_global_rect(), instruments.get_global_rect()]

func _hud_button(parent: Node, title: String, callback: Callable, icon: String) -> Button:
	var button = _button(parent, "", callback, icon)
	button.tooltip_text = title
	button.accessibility_name = title
	button.custom_minimum_size = Vector2(64, 64)
	button.set_meta("glass_density", 0.26)
	var padding: MarginContainer = button.get_child(1)
	for side in ["margin_left", "margin_right"]: padding.add_theme_constant_override(side, 12)
	# Closely spaced edge controls, with a quiet liquid-glass surface.
	var lens: Control = button.get_child(0)
	lens.offset_left = 4
	lens.offset_top = 4
	lens.offset_right = -4
	lens.offset_bottom = -4
	lens.radius = 16
	lens.density = 0.26
	lens._refresh()
	for artwork in button.find_children("*", "TextureRect", true, false): artwork.custom_minimum_size = Vector2.ONE * 20
	return button

func _build_map():
	root.add_child(map_overlay)
	_full(map_overlay)
	var shade = ColorRect.new()
	shade.color = Color(0.01, 0.025, 0.035, 0.93)
	map_overlay.add_child(shade)
	_full(shade)
	map_overlay.add_child(map_sheet)
	map_sheet.mouse_filter = Control.MOUSE_FILTER_IGNORE
	map_header = _box(map_sheet, false, 16)
	var title = _label(map_header, "Baku · City map", 30)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_space(map_header)
	var close = _button(map_header, "Close map", func(): requested.emit("map_close"), "close")
	close.custom_minimum_size.x = 248
	close.size_flags_horizontal = Control.SIZE_SHRINK_END
	expanded_map.expanded = true
	map_sheet.add_child(expanded_map)
	map_footer = _box(map_sheet, false, 12)
	var hint = _label(map_footer, "Drag to explore · Pinch to zoom\nWhite: you  ·  Gold: other drivers", 19, MUTED)
	hint.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_space(map_footer)
	var zoom_out = _button(map_footer, "", func(): expanded_map.zoom_by(0.8), "minus")
	zoom_out.accessibility_name = "Zoom out"
	zoom_out.tooltip_text = "Zoom out"
	var zoom_in = _button(map_footer, "", func(): expanded_map.zoom_by(1.25), "plus")
	zoom_in.accessibility_name = "Zoom in"
	zoom_in.tooltip_text = "Zoom in"
	var locate = _button(map_footer, "Your car", expanded_map.locate_player, "compass")
	var fit = _button(map_footer, "Fit city", expanded_map.reset_view, "external")
	for button in [zoom_out, zoom_in, locate, fit]: button.size_flags_horizontal = Control.SIZE_SHRINK_END
	map_overlay.hide()

func show_map():
	hud.hide()
	controls.active = false
	controls.clear()
	controls.queue_redraw()
	expanded_map.reset_view()
	map_overlay.show()
	_safe_layout()
	map_header.get_child(map_header.get_child_count() - 1).grab_focus()

func close_map():
	map_overlay.hide()
	if driving: hud.show()
	expanded_map.reset_view()
	controls.clear()
	controls.active = driving
	controls.queue_redraw()

func update_map(state: Dictionary, drivers: Array):
	minimap.update_location(state, drivers)
	expanded_map.update_location(state, drivers)

func _build_menu():
	if transition and transition.is_valid(): transition.kill()
	if is_instance_valid(plate_editor): plate_editor._commit()
	if is_instance_valid(detail_scroll): scroll_positions[_page_key()] = detail_scroll.scroll_vertical
	detail_scroll = null
	plate_editor = null
	for tween in press_tweens.values():
		if tween.is_valid(): tween.kill()
	press_tweens.clear()
	for child in safe.get_children():
		safe.remove_child(child)
		child.queue_free()
	fields.clear()
	vehicle_buttons.clear()
	navigation_buttons.clear()
	vehicle_feedback = null
	online_button = null
	network_label = null
	vehicle_label = null
	menu_content = _box(safe, true, 12)
	var header = _box(menu_content, false, 14)
	if page != "home":
		var back_button = _button(header, "", back, "back")
		back_button.accessibility_name = "Back"
		back_button.tooltip_text = "Back"
		back_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	else:
		var logo = TextureRect.new()
		logo.texture = preload("res://branding/mark.png")
		logo.custom_minimum_size = Vector2(48, 48)
		logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
		header.add_child(logo)
	var brand = _box(header, true, 0)
	brand.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_label(brand, "DriveAtBaku", 24)
	_label(brand, "AN OPEN ROAD EXPERIENCE", 12, MUTED)
	_space(header)
	_label(header, "BAKU, AZERBAIJAN" if compact_layout else "BAKU, AZERBAIJAN   /   40.4093° N · 49.8671° E", 16, MUTED).vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var body = _box(menu_content, false, 18)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	if page == "home":
		_build_home(body)
	else:
		_build_detail(body)
	var footer = _box(menu_content, false, 16)
	_label(footer, "THE CITY IS YOURS.", 14, MUTED)
	_space(footer)
	_label(footer, "SAVED ON THIS DEVICE", 16, MUTED)
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
	rail.custom_minimum_size.x = 304
	rail.density = 0.72
	body.add_child(rail)
	var nav_scroll = ScrollContainer.new()
	nav_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	rail.add_child(nav_scroll)
	var nav = _box(nav_scroll, true, 10)
	nav.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_label(nav, "MAKE IT YOURS", 16, MUTED)
	_label(nav, {"garage": "Your garage", "settings": "Settings", "multiplayer": "Drive together", "credits": "The makers"}[page], 26)
	if page == "settings":
		for title in ["Driving", "Graphics & audio", "Atmosphere", "Accessibility"]:
			_nav_button(nav, title, title == category, func(): _remember_scroll(); category = title; _build_menu())
	elif page == "garage":
		for title in ["Vehicles", "Registration", "Driving aids"]:
			_nav_button(nav, title, title == garage_category, func(): _remember_scroll(); garage_category = title; _build_menu())
		vehicle_label = _label(nav, VEHICLES[Preferences.values.vehicle], 20, MUTED)
		vehicle_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	elif page != "settings":
		_space(nav)
		_label(nav, "YOUR CITY.\nYOUR PACE.", 18, MUTED)
		_coffee(nav)
	var sheet = Glass.new()
	sheet.density = 0.78
	sheet.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(sheet)
	var scroll = ScrollContainer.new()
	detail_scroll = scroll
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.follow_focus = true
	sheet.add_child(scroll)
	var content = _box(scroll, true, 12)
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
			notices.custom_minimum_size.x = 400
			notices.add_theme_font_size_override("normal_font_size", 20)
			content.add_child(notices)
	scroll.set_deferred("scroll_vertical", scroll_positions.get(_page_key(), 0))

func _page_key() -> String:
	return page + "/" + (category if page == "settings" else garage_category)

func _remember_scroll(release_reference = true):
	if is_instance_valid(plate_editor): plate_editor._commit()
	if is_instance_valid(detail_scroll): scroll_positions[_page_key()] = detail_scroll.scroll_vertical
	# Clear the reference before changing a category so its offset is not saved
	# under the destination category by _build_menu.
	if release_reference: detail_scroll = null

func _nav_button(parent: Node, title: String, selected: bool, callback: Callable):
	var button = _button(parent, title, callback, "check" if selected else "arrow", "", selected)
	button.toggle_mode = true
	button.set_pressed_no_signal(selected)
	button.accessibility_name = title + (", selected" if selected else "")
	navigation_buttons.append(button)
	button.disabled = not busy_vehicle.is_empty()
	button.get_child(0).radius = 20
	var padding = button.get_child(1)
	padding.add_theme_constant_override("margin_left", 14)
	padding.add_theme_constant_override("margin_right", 14)
	var row = padding.get_child(0)
	row.add_theme_constant_override("separation", 10)
	var label = row.get_child(0).get_child(0)
	label.add_theme_font_size_override("font_size", 24)
	label.autowrap_mode = TextServer.AUTOWRAP_OFF
	label.clip_text = true
	row.get_child(1).custom_minimum_size = Vector2(24, 24)

func _garage(content: VBoxContainer):
	if garage_category == "Registration":
		plate_editor = preload("res://scripts/plate_editor.gd").new()
		plate_editor.interface = self
		content.add_child(plate_editor)
		return
	if garage_category == "Driving aids":
		_label(content, "Driving aids", 30)
		_hint(content, "Adjust the assistance you want on the road.")
		_check(content, "Anti-lock brakes · ABS", "abs", "Helps prevent wheel lock during braking.")
		_check(content, "Traction control · TCS", "tcs", "Limits wheelspin under acceleration.")
		_check(content, "Stability control · ESC", "esc", "Helps steady the car during a slide.")
		return
	_label(content, "Choose your next drive.", 30)
	_hint(content, "Each car remembers its own registration.")
	var grid = GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 14)
	content.add_child(grid)
	for id in VEHICLES:
		var selected = Preferences.values.vehicle == id
		var button = _button(grid, VEHICLES[id], func(): vehicle_selected.emit(id), "check" if selected else "arrow", "Selected" if selected else "Select vehicle", selected)
		vehicle_buttons[id] = button
	vehicle_feedback = _label(content, "Ready to drive", 20, MUTED)
	_label(content, "THE FINISHING TOUCHES", 15, MUTED)
	var row = _row(content, "Paint")
	var paint = ColorPickerButton.new()
	paint.color = Color(Preferences.values.paint)
	paint.edit_alpha = false
	paint.custom_minimum_size = Vector2(200, 88)
	paint.accessibility_name = "Vehicle paint color"
	paint.color_changed.connect(func(color): _change("paint", "#" + color.to_html(false)))
	row.add_child(paint)
	fields.paint = paint
	set_vehicle_busy(busy_vehicle)

func set_vehicle_busy(id: String, progress = -1.0):
	busy_vehicle = id
	for button in navigation_buttons: button.disabled = not id.is_empty()
	for field in fields.values():
		if field is BaseButton: field.disabled = not id.is_empty()
		elif field is LineEdit: field.editable = id.is_empty()
	for key in vehicle_buttons:
		vehicle_buttons[key].disabled = not id.is_empty() or key == Preferences.values.vehicle
		vehicle_buttons[key].modulate.a = 1.0 if id.is_empty() else 0.55
	if is_instance_valid(vehicle_feedback):
		vehicle_feedback.text = "Ready to drive" if id.is_empty() else "Preparing %s%s" % [VEHICLES.get(id, id), "…" if progress < 0 else " · %d%%" % roundi(progress * 100)]

func _refresh_vehicle_selection():
	for id in vehicle_buttons:
		var selected = id == Preferences.values.vehicle
		var button: Button = vehicle_buttons[id]
		var row = button.get_child(1).get_child(0)
		var words = row.get_child(0)
		words.get_child(0).add_theme_font_size_override("font_size", 28 if selected else 26)
		words.get_child(1).text = "Selected" if selected else "Select vehicle"
		row.get_child(1).texture = Icons.get_icon("check" if selected else "arrow")
		button.get_child(0).density = 0.52 if selected else 0.72
		button.get_child(0).radius = 44 if selected else 24
		button.get_child(0)._refresh()
		button.disabled = selected
		button.accessibility_description = "Selected" if selected else "Select vehicle"
	if is_instance_valid(vehicle_label): vehicle_label.text = VEHICLES[Preferences.values.vehicle]

func _settings(content: VBoxContainer):
	_label(content, category, 32)
	match category:
		"Driving":
			_hint(content, "Tune touch controls to suit the way you drive.")
			_option(content, "Touch controls", "control_mode", ["buttons", "sliders"], ["Buttons", "Analog sliders"])
			_check(content, "Automatic transmission", "automatic")
			_slider(content, "Steering sensitivity", "sensitivity", 0.4, 1.6)
			_slider(content, "Steering weight", "weight", 0, 1)
			_slider(content, "Quick-turn response", "quick_response", 0, 1)
			_check(content, "Self-centering", "self_center_enabled")
			_slider(content, "Self-centering speed", "self_center", 0, 1)
			var centering_slider = fields.self_center
			centering_slider.editable = Preferences.values.self_center_enabled
			fields.self_center_enabled.toggled.connect(func(on): centering_slider.editable = on)
			_slider(content, "Control size", "control_scale", 0.75, 1.35)
			_check(content, "Mirror control layout", "left_handed")
		"Graphics & audio":
			_hint(content, "Balance image detail, responsiveness and sound.")
			_option(content, "Graphics quality", "quality", ["performance", "balanced"], ["Performance", "Balanced"])
			_option(content, "Rendering height", "resolution", [540, 720, 900, 1080], ["540p", "720p", "900p", "1080p"])
			_slider(content, "Render distance", "render_distance", 400, 3000, 100)
			_slider(content, "Engine volume", "volume", 0, 1)
		"Atmosphere":
			_hint(content, "Set the mood for your next drive.")
			_check(content, "After hours · Night mode", "night")
			_option(content, "Weather", "weather", ["sunny", "overcast", "wet", "rain", "snow"], ["Sunny", "Overcast", "Wet roads", "Rain", "Snow"])
		"Accessibility":
			_hint(content, "Make menus more comfortable to read and navigate.")
			_check(content, "Reduce motion", "reduce_motion", "Use instant menu transitions.")
			_check(content, "Increase glass contrast", "reduce_transparency", "Use darker surfaces behind text and controls.")

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
	if key == "reduce_motion" and value:
		if transition and transition.is_valid(): transition.kill()
		menu_content.modulate.a = 1.0
		for tween in press_tweens.values():
			if tween.is_valid(): tween.kill()
		for button in root.find_children("*", "Button", true, false): button.scale = Vector2.ONE
	if key in ["reduce_transparency", "quality"]:
		for lens in root.find_children("*", "PanelContainer", true, false):
			if lens.has_method("_refresh"): lens._refresh()

func _row(parent: Node, title: String) -> HBoxContainer:
	var row = _box(parent, false, 20)
	row.custom_minimum_size.y = 88
	var label = _label(row, title, 26)
	label.custom_minimum_size.x = 220 if compact_layout else 240
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	return row

func _hint(parent: Node, text: String) -> Label:
	var hint = _label(parent, text, 22, MUTED)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return hint

func _option(parent: Node, title: String, key: String, options: Array, labels: Array):
	var row = _row(parent, title)
	var select = OptionButton.new()
	select.custom_minimum_size = Vector2(240, 88)
	select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	select.accessibility_name = title
	select.get_popup().add_theme_constant_override("v_separation", 56)
	select.get_popup().add_theme_font_size_override("font_size", 24)
	for label in labels: select.add_item(label)
	select.selected = maxi(0, options.find(Preferences.values[key]))
	select.item_selected.connect(func(i): _change(key, options[i]))
	row.add_child(select)
	fields[key] = select

func _check(parent: Node, title: String, key: String, description = ""):
	var button = _button(parent, title, func(): pass, "check", description)
	button.toggle_mode = true
	button.set_pressed_no_signal(Preferences.values[key])
	# State is explicit in text as well as the switch position and color.
	var row = button.get_child(1).get_child(0)
	var old_icon = row.get_child(row.get_child_count() - 1)
	row.remove_child(old_icon)
	old_icon.queue_free()
	var state_label = _label(row, "On" if button.button_pressed else "Off", 20, MUTED)
	var toggle = TextureRect.new()
	toggle.custom_minimum_size = Vector2(72, 40)
	toggle.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(toggle)
	var refresh = func(on):
		state_label.text = "On" if on else "Off"
		var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="40"><rect x="1" y="1" width="70" height="38" rx="19" fill="%s" stroke="#a8c5c7"/><circle cx="%d" cy="20" r="14" fill="#f2f7f6"/></svg>' % ["#337a70" if on else "#39454b", 52 if on else 20]
		var image = Image.new()
		image.load_svg_from_string(svg)
		toggle.texture = ImageTexture.create_from_image(image)
	refresh.call(button.button_pressed)
	button.toggled.connect(func(value): refresh.call(value); _change(key, value))
	_ignore_children(button)
	fields[key] = button

func _slider(parent: Node, title: String, key: String, low: float, high: float, step = 0.01):
	var row = _row(parent, title)
	var slider = HSlider.new()
	slider.min_value = low
	slider.max_value = high
	slider.step = step
	slider.value = Preferences.values[key]
	slider.custom_minimum_size = Vector2(180, 88)
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.accessibility_name = title
	slider.scrollable = false # Vertical page scrolling must not change a value.
	row.add_child(slider)
	var value_label = _label(row, _setting_value(key, slider.value), 24, MUTED)
	value_label.custom_minimum_size.x = 84
	value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	value_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	slider.value_changed.connect(func(value): _change(key, value); value_label.text = _setting_value(key, value))
	fields[key] = slider

func _setting_value(key: String, value: float) -> String:
	if key == "render_distance": return "%d m" % roundi(value)
	if key == "sensitivity": return "%.2f×" % value
	return "%d%%" % roundi(value * 100)

func _line(parent: Node, title: String, key: String, maximum: int):
	var group = _box(parent, true, 6)
	_label(group, title, 22, MUTED)
	var edit = LineEdit.new()
	edit.text = Preferences.values[key]
	edit.max_length = maximum
	edit.custom_minimum_size.y = 88
	edit.accessibility_name = title
	edit.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_URL if key == "server_url" else LineEdit.KEYBOARD_TYPE_DEFAULT
	edit.text_changed.connect(func(value): _change(key, value))
	edit.text_submitted.connect(func(_value): edit.release_focus(); hide_keyboard())
	group.add_child(edit)
	fields[key] = edit

func navigate(destination: String):
	_remember_scroll()
	page = destination
	_build_menu()

func back():
	if map_overlay.visible:
		requested.emit("map_close")
		return
	if not busy_vehicle.is_empty(): return
	if plate_view != "car":
		finish_plate_inspection()
		return
	if get_viewport().gui_get_focus_owner() is LineEdit:
		get_viewport().gui_get_focus_owner().release_focus()
		hide_keyboard()
		return
	if loading_screen.visible:
		if loading_screen.failed: requested.emit("quit")
		return
	if page != "home": navigate("home")
	elif paused: requested.emit("drive")
	else: requested.emit("quit")

func _unhandled_key_input(event):
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_ESCAPE and (menu.visible or map_overlay.visible):
		back()
		get_viewport().set_input_as_handled()

func show_loading(message: String, progress = -1.0, failed = false):
	close_map()
	scene_capture.copy_mode = BackBufferCopy.COPY_MODE_DISABLED
	loading_screen.show_message(message, progress, failed)
	menu.hide()
	hud.hide()
	driving = false
	controls.active = false
	controls.clear()
	controls.queue_redraw()

func show_menu(as_pause = false, preserve_page = false):
	close_map()
	var reuse_garage = preserve_page and menu.visible and page == "garage" and garage_category == "Vehicles"
	_remember_scroll(not reuse_garage)
	finish_plate_inspection(false)
	scene_capture.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
	driving = false
	paused = as_pause
	if not preserve_page: page = "home"
	controls.active = false
	controls.clear()
	controls.queue_redraw()
	hud.hide()
	if reuse_garage: _refresh_vehicle_selection()
	else: _build_menu()
	menu.show()
	loading_screen.finish()

func show_driving():
	close_map()
	finish_plate_inspection(false)
	scene_capture.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
	driving = true
	loading_screen.finish()
	menu.hide()
	hud.show()
	controls.clear()
	controls.active = true
	controls.queue_redraw()

func inspect_plate(view: String):
	var focus = get_viewport().gui_get_focus_owner()
	if is_instance_valid(focus): focus.release_focus()
	hide_keyboard()
	plate_view = view
	menu.hide()
	if is_instance_valid(inspection): inspection.queue_free()
	var margin = MarginContainer.new()
	inspection = margin
	root.add_child(margin)
	margin.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_position_inspection()
	var row = _box(margin, false, 12)
	_button(row, "Back to registration", finish_plate_inspection, "back")
	_space(row)
	_button(row, "Front plate", func(): plate_view = "front", "camera")
	_button(row, "Rear plate", func(): plate_view = "rear", "camera")
	controls.clear()

func _position_inspection():
	inspection.offset_left = safe.get_theme_constant("margin_left")
	inspection.offset_right = -safe.get_theme_constant("margin_right")
	inspection.offset_top = -safe.get_theme_constant("margin_bottom") - 104
	inspection.offset_bottom = -safe.get_theme_constant("margin_bottom")

func finish_plate_inspection(restore_menu = true):
	plate_view = "car"
	if is_instance_valid(inspection):
		inspection.queue_free()
		inspection = null
	if restore_menu: menu.show()

func hide_keyboard():
	if DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD): DisplayServer.virtual_keyboard_hide()

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
	var mode_changed = controls.automatic != state.automatic
	controls.set_automatic(state.automatic)
	if mode_changed: _safe_layout()
	speed.text = str(roundi(Vector2(state.velocity.x, state.velocity.z).length() * 3.6))
	transmission_label.text = "AUTO" if state.automatic else "MAN"
	gear_label.text = gear
	gear_label.accessibility_name = "Gear " + gear
	gearbox_button.tooltip_text = "Switch to manual" if state.automatic else "Switch to automatic"
	gearbox_button.accessibility_name = gearbox_button.tooltip_text
	# Vehicle names, OFFLINE and driver counts are already available in menus
	# and the map. Only surface a connection warning during normal gameplay.
	status.text = "Reconnecting…" if connection == "RECONNECTING" else ""
	for aid in ["abs", "tcs", "esc"]:
		var active_aid = state.get(aid + "_active", false)
		aid_labels[aid].visible = Preferences.values[aid]
		aid_labels[aid].add_theme_color_override("font_color", Color("b5f1e8") if active_aid else Color(0.8, 0.87, 0.88, 0.7))
		aid_labels[aid].accessibility_name = aid.to_upper() + (" active" if active_aid else " enabled")
	telemetry.text = "%d rpm" % roundi(state.rpm)
