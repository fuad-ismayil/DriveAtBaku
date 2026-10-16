extends "res://scripts/loading_interface.gd"

const STORIES = [
	["city", "01 / THE CITY", "Every turn.\nA new story.", "The city opens up. The road is yours. Settle in for a drive along the Caspian coast."],
	["night", "02 / AFTER HOURS", "Lights on.\nWorld off.", "A quieter city. A different kind of drive. Follow the boulevard into the blue hour."],
	["weather", "03 / THE ELEMENTS", "A little rain.\nA lot of atmosphere.", "Reflections on the asphalt. A change in the air. Discover Baku under a different sky."],
	["garage", "04 / YOUR DRIVE", "Find your car.\nMake your escape.", "Four distinct rides. Your choice of finish. A whole city waiting beyond the garage."]
]
var description: Label

func _ready():
	super._ready()
	var content = safe.get_child(0)
	var header = content.get_child(0)
	for child in [header.get_child(0), header.get_child(1)]:
		header.remove_child(child)
		child.queue_free()
	var wordmark = TextureRect.new()
	wordmark.texture = preload("res://assets/ui/wordmark.svg")
	wordmark.custom_minimum_size = Vector2(220, 53)
	wordmark.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	wordmark.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	header.add_child(wordmark)
	header.move_child(wordmark, 0)
	var hero = content.get_child(1)
	description = hero.get_child(3)
	description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	description.custom_minimum_size.x = 480
	description.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	for label in find_children("*", "Label", true, false):
		label.add_theme_font_size_override("font_size", 12)
	caption.add_theme_font_size_override("font_size", 11)
	description.add_theme_font_size_override("font_size", 16)
	message.add_theme_font_size_override("font_size", 16)
	var chapters = HBoxContainer.new()
	chapters.add_theme_constant_override("separation", 8)
	hero.add_child(chapters)
	for i in STORIES.size():
		var button = Button.new()
		button.text = STORIES[i][1]
		button.custom_minimum_size = Vector2(120, 40)
		button.pressed.connect(func(): _story(i))
		chapters.add_child(button)
	for button in [motion, retry]:
		button.custom_minimum_size = Vector2(140, 42)
		button.add_theme_constant_override("icon_max_width", 16)
	_story(0)
	resized.connect(_layout)
	_layout()

func _layout():
	set_insets(Vector4(clampf(size.x * 0.05, 24, 96), 30, clampf(size.x * 0.05, 24, 96), 30))
	title.add_theme_font_size_override("font_size", int(clampf(size.x * 0.045, 42, 72)))

func _story(index: int):
	chapter = index
	elapsed = 0
	artwork.texture = load("res://assets/ui/%s.webp" % STORIES[index][0])
	next_art.modulate.a = 0
	caption.text = STORIES[index][1]
	title.text = STORIES[index][2]
	description.text = STORIES[index][3]

func _process(dt):
	if visible: progress_bar.value = lerpf(progress_bar.value, target_progress, 1 - exp(-12 * dt))
	if not visible or failed or motion_paused or Preferences.values.reduce_motion: return
	elapsed += dt
	if elapsed > 7: _story((chapter + 1) % STORIES.size())
