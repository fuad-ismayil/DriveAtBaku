extends Control

signal retry_requested

const Glass = preload("res://scripts/glass_panel.gd")
const Icons = preload("res://scripts/ui_icons.gd")
var artwork = TextureRect.new()
var next_art = TextureRect.new()
var safe = MarginContainer.new()
var title: Label
var caption: Label
var message: Label
var percentage: Label
var progress_bar = ProgressBar.new()
var retry = Button.new()
var motion = Button.new()
var detail: Label
var elapsed = 0.0
var chapter = 0
var motion_paused = false
var failed = false
var completion: Tween
var art_transition: Tween
var story_transition: Tween
var target_progress = 0.0

func _ready():
	mouse_filter = Control.MOUSE_FILTER_STOP
	for texture in [artwork, next_art]:
		add_child(texture)
		texture.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		texture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		texture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		texture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	artwork.texture = load("res://assets/ui/city.webp")
	next_art.texture = load("res://assets/ui/night.webp")
	next_art.modulate.a = 0
	var shade = TextureRect.new()
	var gradient = Gradient.new()
	gradient.colors = PackedColorArray([Color(0.015, 0.025, 0.03, 0.22), Color(0.01, 0.016, 0.02, 0.82)])
	var texture = GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill_from = Vector2(0.8, 0)
	texture.fill_to = Vector2(0.15, 1)
	shade.texture = texture
	add_child(shade)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var capture = BackBufferCopy.new()
	capture.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
	add_child(capture)
	add_child(safe)
	safe.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var content = VBoxContainer.new()
	content.add_theme_constant_override("separation", 24)
	safe.add_child(content)
	var header = HBoxContainer.new()
	content.add_child(header)
	_label(header, "DriveAtBaku", 26)
	var spacer = Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(spacer)
	_label(header, "BAKU, AZERBAIJAN  /  THE CASPIAN COAST", 16)
	var hero = VBoxContainer.new()
	hero.add_theme_constant_override("separation", 12)
	hero.size_flags_vertical = Control.SIZE_EXPAND_FILL
	content.add_child(hero)
	var breathing_room = Control.new()
	breathing_room.size_flags_vertical = Control.SIZE_EXPAND_FILL
	hero.add_child(breathing_room)
	caption = _label(hero, "01 / THE CITY IS YOURS", 17, Color(0.73, 0.91, 0.87))
	title = _label(hero, "Every turn.\nA new story.", 66)
	_label(hero, "The city opens up. The road is yours.", 23, Color(0.85, 0.88, 0.88))
	var bottom_space = Control.new()
	bottom_space.custom_minimum_size.y = 10
	hero.add_child(bottom_space)
	var glass = Glass.new()
	glass.density = 0.36
	content.add_child(glass)
	var info = VBoxContainer.new()
	info.add_theme_constant_override("separation", 12)
	glass.add_child(info)
	var row = HBoxContainer.new()
	info.add_child(row)
	message = _label(row, "Preparing your drive…", 23)
	message.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	message.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	percentage = _label(row, "PREPARING", 20)
	progress_bar.custom_minimum_size.y = 5
	progress_bar.show_percentage = false
	var track = StyleBoxFlat.new()
	track.bg_color = Color(1, 1, 1, 0.16)
	track.set_corner_radius_all(3)
	var fill = track.duplicate()
	fill.bg_color = Color(0.78, 0.94, 0.91)
	progress_bar.add_theme_stylebox_override("background", track)
	progress_bar.add_theme_stylebox_override("fill", fill)
	info.add_child(progress_bar)
	detail = _label(info, "A little anticipation. A whole city ahead.", 17, Color(0.78, 0.83, 0.84))
	var footer = HBoxContainer.new()
	info.add_child(footer)
	_label(footer, "DRIVER'S NOTE   Smooth steering. Clean exits. Enjoy the city.", 16).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	motion.text = "Pause visuals"
	motion.icon = Icons.get_icon("pause")
	motion.expand_icon = true
	motion.add_theme_constant_override("icon_max_width", 22)
	motion.custom_minimum_size = Vector2(200, 64)
	motion.pressed.connect(func(): motion_paused = not motion_paused; motion.text = "Resume visuals" if motion_paused else "Pause visuals")
	footer.add_child(motion)
	retry.text = "Try again"
	retry.custom_minimum_size = Vector2(180, 64)
	retry.pressed.connect(func(): retry_requested.emit())
	footer.add_child(retry)
	retry.hide()

func _label(parent: Node, text: String, font_size: int, color = Color.WHITE) -> Label:
	var label = Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	parent.add_child(label)
	return label

func set_insets(insets: Vector4):
	for pair in [["margin_left", insets.x], ["margin_top", insets.y], ["margin_right", insets.z], ["margin_bottom", insets.w]]:
		safe.add_theme_constant_override(pair[0], int(pair[1]))

func show_message(text: String, progress: float, error: bool):
	if completion: completion.kill()
	modulate.a = 1
	show()
	failed = error
	message.text = text
	retry.visible = error
	motion.visible = not error
	if error:
		percentage.text = "INTERRUPTED"
		detail.text = "Your preferences are safe. Try preparing the city again."
	elif progress >= 0:
		target_progress = clampf(progress, 0, 1) * 100
		if Preferences.values.reduce_motion: progress_bar.value = target_progress
		percentage.text = "%02d%%" % roundi(target_progress)
		detail.text = "Loading from your device · No connection needed"
	else:
		percentage.text = "PREPARING"
		detail.text = "Preparing local assets…"

func finish():
	if not visible: return
	if completion: completion.kill()
	if Preferences.values.reduce_motion:
		hide()
		return
	progress_bar.value = 100
	target_progress = 100
	percentage.text = "READY"
	completion = create_tween()
	completion.tween_property(self, "modulate:a", 0.0, 0.32).set_trans(Tween.TRANS_SINE)
	completion.tween_callback(hide)

func _process(dt):
	if visible: progress_bar.value = lerpf(progress_bar.value, target_progress, 1 - exp(-12 * dt))
	if not visible or failed or motion_paused or Preferences.values.reduce_motion: return
	elapsed += dt
	if elapsed > 8:
		elapsed = 0
		chapter = 1 - chapter
		if story_transition: story_transition.kill()
		story_transition = create_tween()
		story_transition.tween_property(title, "modulate:a", 0.0, 0.2)
		story_transition.tween_callback(func():
			caption.text = "02 / AFTER HOURS" if chapter else "01 / THE CITY IS YOURS"
			title.text = "The city glows.\nThe road calls." if chapter else "Every turn.\nA new story.")
		story_transition.tween_property(title, "modulate:a", 1.0, 0.4)
		if art_transition: art_transition.kill()
		art_transition = create_tween()
		art_transition.tween_property(next_art, "modulate:a", float(chapter), 1.4).set_trans(Tween.TRANS_SINE)
