extends VBoxContainer

const Settings = preload("res://scripts/license_plate_settings.gd")
var interface
var edits: Dictionary = {}
var options: VBoxContainer
var disabled_note: Label
var preview: Control
var fit_note: Label
var pending: Dictionary = {}
var debounce: Timer

class PlatePreview extends Control:
	var settings: Dictionary = {}
	var edits: Dictionary = {}
	var plate_rect = Rect2()
	var chip_rect = Rect2()
	var az_text_rect = Rect2()
	var scale_factor = 1.0
	var dimensions = Vector2(520, 110)
	const DIN = preload("res://assets/ui/plate-din.ttf")
	const DIN_BOLD = preload("res://assets/ui/plate-din-bold.ttf")
	func _ready():
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		resized.connect(update_layout)
	func update_layout():
		if settings.is_empty(): return
		var compact = settings.format == "compact"
		dimensions = Vector2(300, 150) if compact else Vector2(520, 110)
		scale_factor = minf((size.x - 16) / dimensions.x, (size.y - 16) / dimensions.y)
		if compact: scale_factor = minf(scale_factor, 1.4)
		var plate_size = dimensions * scale_factor
		plate_rect = Rect2((size - plate_size) * 0.5, plate_size)
		var rectangles = {
			"region": Rect2(100, 8, 88, 64) if compact else Rect2(76, 7, 112, 96),
			"letters": Rect2(20, 78, 104, 64) if compact else Rect2(214, 7, 104, 96),
			"serial": Rect2(151, 78, 137, 64) if compact else Rect2(344, 7, 164, 96)
		}
		for key in edits:
			var edit: LineEdit = edits[key]
			var rect: Rect2 = rectangles[key]
			edit.position = plate_rect.position + rect.position * scale_factor
			var available = rect.size * scale_factor
			var font = DIN_BOLD if key == "letters" else DIN
			var sample = "MM" if key == "letters" else ("888" if key == "serial" else "88")
			var font_size = mini(roundi(90 * scale_factor), floori((available.y - 8) * 100 / font.get_height(100)))
			font_size = mini(font_size, floori((available.x - 12) * 100 / font.get_string_size(sample, HORIZONTAL_ALIGNMENT_LEFT, -1, 100).x))
			edit.add_theme_font_size_override("font_size", maxi(20, font_size))
			edit.size = available
		queue_redraw()
	func _draw():
		if settings.is_empty(): return
		var compact = settings.format == "compact"
		draw_set_transform(plate_rect.position, 0, Vector2.ONE * scale_factor)
		var style = StyleBoxFlat.new()
		style.bg_color = Color("eeefe8")
		style.border_color = Color("171b1c")
		style.set_border_width_all(3)
		style.set_corner_radius_all(9)
		draw_style_box(style, Rect2(Vector2.ZERO, dimensions))
		var flag_x = 14.0
		var flag_y = 16.0 if compact else 24.0
		for i in 3: draw_rect(Rect2(flag_x, flag_y + i * 7, 32, 7), [Color("00a6d2"), Color("ed2939"), Color("00ae65")][i])
		draw_circle(Vector2(flag_x + 15, flag_y + 10.5), 4, Color.WHITE)
		draw_circle(Vector2(flag_x + 17, flag_y + 10), 3.3, Color("ed2939"))
		draw_circle(Vector2(flag_x + 23, flag_y + 10.5), 1.5, Color.WHITE)
		# The older long plate frames AZ itself; it is not an empty chip below AZ.
		var identity = Rect2(12, 40 if compact else 51, 36, 28)
		var font_size = 22
		var az_size = DIN.get_string_size("AZ", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
		var az_position = identity.position + (identity.size - az_size) * 0.5
		chip_rect = Rect2(plate_rect.position + identity.position * scale_factor, identity.size * scale_factor)
		az_text_rect = Rect2(plate_rect.position + az_position * scale_factor, az_size * scale_factor)
		if settings.hyphens and not compact:
			var chip = StyleBoxFlat.new()
			chip.bg_color = Color("e4e6e0")
			chip.border_color = Color("a9aca9")
			chip.set_border_width_all(1)
			chip.set_corner_radius_all(4)
			draw_style_box(chip, identity)
		draw_string(DIN, az_position + Vector2(0, DIN.get_ascent(font_size)), "AZ", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, Color("15191b"))
		if compact:
			if settings.hyphens:
				draw_rect(Rect2(251, 18, 26, 14), Color("a9aca9"), false, 2)
				_characters(DIN, "-", [202], 60, 54)
				_characters(DIN, "-", [137], 127, 54)
		else:
			if settings.hyphens: _characters(DIN, "--", [201.5, 329.5], 77, 66)
	func _characters(font: Font, text: String, centers: Array, baseline: float, font_size: int):
		for i in mini(text.length(), centers.size()):
			var width = font.get_string_size(text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
			draw_string(font, Vector2(centers[i] - width * 0.5, baseline), text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, Color("111415"))

func _ready():
	add_theme_constant_override("separation", 8)
	var heading = interface._box(self, false, 16)
	var title = interface._label(heading, "Registration", 30)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	interface._check(heading, "Show plates", "plate_enabled")
	interface.fields.plate_enabled.custom_minimum_size.x = 340
	interface._hint(self, "Tap the numbers or letters on the plate to edit · Saved for this car.")
	disabled_note = interface._hint(self, "Plates are hidden. Your design is saved for when you turn them on again.")
	options = VBoxContainer.new()
	options.add_theme_constant_override("separation", 12)
	add_child(options)
	var columns = interface._box(options, interface.root.size.x < 1400, 20)
	var design = interface._box(columns, true, 12)
	design.custom_minimum_size.x = 504
	design.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var customization = interface._box(columns, true, 8)
	customization.custom_minimum_size.x = 360
	customization.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	preview = PlatePreview.new()
	preview.custom_minimum_size = Vector2(504, 240)
	preview.size_flags_vertical = Control.SIZE_EXPAND_FILL
	preview.edits = edits
	preview.accessibility_name = "Registration preview"
	design.add_child(preview)
	for item in [["region", "Region", 2], ["letters", "Letters", 2], ["serial", "Number", 3]]:
		var edit = LineEdit.new()
		edit.name = "Plate" + item[1]
		edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
		edit.add_theme_font_override("font", PlatePreview.DIN_BOLD if item[0] == "letters" else PlatePreview.DIN)
		edit.add_theme_constant_override("minimum_character_width", 1)
		for color_name in ["font_color", "font_selected_color", "font_uneditable_color"]: edit.add_theme_color_override(color_name, Color("111415"))
		edit.add_theme_color_override("caret_color", Color("314d62"))
		edit.add_theme_color_override("selection_color", Color(0.48, 0.65, 0.73, 0.55))
		for state in ["normal", "read_only", "focus"]:
			var style = StyleBoxFlat.new()
			style.bg_color = Color(0.2, 0.35, 0.42, 0.08) if state == "focus" else Color.TRANSPARENT
			style.border_color = Color("314d62") if state == "focus" else Color(0.1, 0.16, 0.18, 0.25)
			style.set_corner_radius_all(4)
			if state == "focus": style.set_border_width_all(2)
			else: style.border_width_bottom = 1
			style.content_margin_left = 6
			style.content_margin_right = 6
			edit.add_theme_stylebox_override(state, style)
		edit.accessibility_name = "Plate " + item[1].to_lower()
		edit.tooltip_text = "Edit " + item[1].to_lower() + " · or paste a full registration"
		edit.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_DEFAULT if item[0] == "letters" else LineEdit.KEYBOARD_TYPE_NUMBER
		edit.virtual_keyboard_show_on_focus = true
		edit.select_all_on_focus = true
		edit.text_changed.connect(func(value): _edit(item[0], value))
		edit.focus_exited.connect(func(): _commit(); _sync_fields())
		edit.text_submitted.connect(func(_value): edit.release_focus(); interface.hide_keyboard())
		preview.add_child(edit)
		edits[item[0]] = edit
		interface.fields["plate_" + item[0]] = edit
	interface._label(customization, "Plate format", 20, interface.MUTED)
	var format = OptionButton.new()
	format.custom_minimum_size.y = 88
	format.add_item("Long · 520 × 110 mm")
	format.add_item("Two rows · 300 × 150 mm")
	format.selected = 1 if Preferences.values.plate_format == "compact" else 0
	format.accessibility_name = "Plate format"
	format.get_popup().add_theme_constant_override("v_separation", 56)
	format.item_selected.connect(func(index): interface._change("plate_format", "compact" if index == 1 else "long"))
	customization.add_child(format)
	interface.fields.plate_format = format
	interface._check(customization, "RFID & separators", "plate_hyphens")
	fit_note = interface._hint(customization, "")
	var views = interface._box(customization, false, 12)
	interface._button(views, "Front plate", func(): _commit(); interface.inspect_plate("front"), "camera")
	interface._button(views, "Rear plate", func(): _commit(); interface.inspect_plate("rear"), "camera")
	debounce = Timer.new()
	debounce.one_shot = true
	debounce.wait_time = 0.16
	debounce.timeout.connect(_commit)
	add_child(debounce)
	interface.setting_changed.connect(_changed)
	_sync_fields()
	_refresh()

func _changed(key: String):
	if key.begins_with("plate_"): _refresh()

func _sync_fields():
	var settings = Preferences.plate_settings()
	for key in edits:
		if not edits[key].has_focus(): edits[key].text = settings[key]

func _edit(key: String, raw: String):
	# Accept a whole registration pasted into any field, as in the web editor.
	var expression = RegEx.new()
	expression.compile("^([0-9]{2})[ -]*([A-Z]{2})[ -]*([0-9]{3})$")
	var matched = expression.search(raw.strip_edges().to_upper())
	if matched and int(matched.get_string(1)) > 0 and int(matched.get_string(3)) > 0:
		var letters = matched.get_string(2)
		if letters[0] in "ABCDEFGHJKLMNOPRSTUVXYZ" and letters[1] in "ABCDEFGHJKLMNOPRSTUVXYZ":
			pending = {"region": matched.get_string(1), "letters": letters, "serial": matched.get_string(3)}
			_commit()
			for field in edits: edits[field].text = Preferences.plate_settings()[field]
			return
	var count = 3 if key == "serial" else 2
	var value = ""
	var cursor = edits[key].caret_column
	var before_cursor = 0
	var index = 0
	for c in raw.to_upper():
		if c in ("ABCDEFGHJKLMNOPRSTUVXYZ" if key == "letters" else "0123456789") and value.length() < count:
			value += c
			if index < cursor: before_cursor += 1
		index += 1
	if value != raw:
		edits[key].text = value
		edits[key].caret_column = before_cursor
	if not value.is_empty() and (key == "letters" or int(value) > 0):
		pending[key] = value + str(Preferences.plate_settings().letters).substr(value.length()) if key == "letters" else value
	else: pending.erase(key)
	_refresh()
	debounce.start()

func _commit():
	if pending.is_empty(): return
	var settings = Preferences.plate_settings()
	settings.merge(pending, true)
	pending.clear()
	settings = Settings.normalize(settings)
	Preferences.update_plate(settings)
	interface.setting_changed.emit("plate_registration")
	_refresh()

func _refresh():
	var settings = Preferences.plate_settings()
	settings.merge(pending, true)
	settings = Settings.normalize(settings)
	options.visible = settings.enabled
	disabled_note.visible = not settings.enabled
	preview.settings = settings
	interface.fields.plate_format.select(1 if settings.format == "compact" else 0)
	preview.update_layout()
	preview.accessibility_description = "%s %s %s" % [settings.region, settings.letters, settings.serial]
	fit_note.text = "Two rows · compact fit" if settings.format == "compact" else "One row · standard long plate"
