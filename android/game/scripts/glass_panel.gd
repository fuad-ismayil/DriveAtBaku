extends PanelContainer

var radius = 30.0
var density = 0.26

func _ready():
	var padding = StyleBoxEmpty.new()
	for side in [SIDE_LEFT, SIDE_RIGHT, SIDE_TOP, SIDE_BOTTOM]: padding.set_content_margin(side, 22)
	add_theme_stylebox_override("panel", padding)
	material = ShaderMaterial.new()
	material.shader = preload("res://shaders/liquid_glass.gdshader")
	resized.connect(_refresh)
	_refresh()

func _refresh():
	material.set_shader_parameter("lens_size", size)
	material.set_shader_parameter("radius", radius)
	material.set_shader_parameter("density", density)
	material.set_shader_parameter("detailed", Preferences.values.quality != "performance" and not Preferences.values.get("reduce_transparency", false))
	if Preferences.values.get("reduce_transparency", false): material.set_shader_parameter("density", 0.94)
	queue_redraw()

func _draw():
	draw_rect(Rect2(Vector2.ZERO, size), Color.WHITE)
