extends Control

# North-up city atlas, shared by the HUD and expanded map. All coordinates are
# web/world metres (X, Y); native Godot positions convert with (X, -Z).
const ATLAS = preload("res://assets/ui/map.webp")
var bounds: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/ui/map.json")).bounds
var expanded = false
var player = Vector2.ZERO
var heading = 0.0
var camera_heading = 0.0
var speed_mps = 0.0
var peers: Array = []
var zoom = 1.0
var pan = Vector2.ZERO
var pointers: Dictionary = {}
var mouse_drag = false
var font = ThemeDB.fallback_font

func _ready():
	clip_contents = true
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	mouse_filter = Control.MOUSE_FILTER_STOP if expanded else Control.MOUSE_FILTER_IGNORE
	resized.connect(queue_redraw)
	if not expanded:
		var mask = ShaderMaterial.new()
		mask.shader = preload("res://shaders/minimap_mask.gdshader")
		material = mask
		resized.connect(func(): mask.set_shader_parameter("map_size", size))
		mask.set_shader_parameter("map_size", size)
	gui_input.connect(_gesture)
	accessibility_name = "Baku city map, north up" if expanded else "Baku minimap, camera up"
	accessibility_description = "Drag to pan. Pinch or use the zoom buttons to zoom." if expanded else "Current location"

func update_location(state: Dictionary, drivers: Array, camera_angle = 0.0):
	player = Vector2(state.position.x, -state.position.z)
	heading = state.heading
	camera_heading = camera_angle
	speed_mps = Vector2(state.velocity.x, state.velocity.z).length()
	peers = drivers
	queue_redraw()

func map_scale() -> float:
	if not expanded: return lerpf(0.42, 0.29, clampf(speed_mps / 65, 0, 1)) * size.x / 240.0
	return minf((size.x - 48) / (bounds.maxX - bounds.minX), (size.y - 48) / (bounds.maxY - bounds.minY)) * zoom

func center_world() -> Vector2:
	return Vector2((bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5) if expanded else player

func project(point: Vector2) -> Vector2:
	var delta = point - center_world()
	return size * 0.5 + Vector2(delta.x, -delta.y).rotated(0.0 if expanded else camera_heading) * map_scale() + pan

func zoom_by(factor: float):
	var before = zoom
	zoom = clampf(zoom * factor, 1.0, 6.0)
	pan *= zoom / before
	_clamp_pan()
	queue_redraw()

func reset_view():
	zoom = 1
	pan = Vector2.ZERO
	pointers.clear()
	mouse_drag = false
	queue_redraw()

func locate_player():
	zoom = maxf(zoom, 3)
	pan = Vector2.ZERO
	pan = size * 0.5 - project(player)
	_clamp_pan()
	queue_redraw()

func _clamp_pan():
	var extent = Vector2(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * map_scale() * 0.5
	# Allow any point on the atlas to be centered, even when the fitted map is
	# narrower than a landscape phone. At least half the atlas stays reachable.
	var limit = extent
	pan = pan.clamp(-limit, limit)

func _gesture(event):
	if not expanded: return
	if event is InputEventScreenTouch:
		if event.pressed and not event.canceled: pointers[event.index] = event.position
		else: pointers.erase(event.index)
	elif event is InputEventScreenDrag and pointers.has(event.index):
		var previous: Vector2 = pointers[event.index]
		if pointers.size() == 2:
			var other: Vector2 = pointers.values()[0] if pointers.keys()[0] != event.index else pointers.values()[1]
			var old_distance = previous.distance_to(other)
			if old_distance > 12: zoom_by(event.position.distance_to(other) / old_distance)
		else:
			pan += event.position - previous
		pointers[event.index] = event.position
		_clamp_pan()
		queue_redraw()
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed: zoom_by(1.25)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed: zoom_by(0.8)
		elif event.button_index == MOUSE_BUTTON_LEFT: mouse_drag = event.pressed
	elif event is InputEventMouseMotion and mouse_drag and pointers.is_empty():
		pan += event.relative
		_clamp_pan()
		queue_redraw()
	accept_event()

func _marker(point: Vector2, angle: float, color: Color, local: bool):
	var at = project(point)
	if not Rect2(Vector2.ZERO, size).grow(-12).has_point(at): return
	if not expanded and at.distance_to(size * 0.5) > size.x * 0.5 - 10: return
	var shape = PackedVector2Array()
	var marker_scale = 1.0 if expanded else (0.65 if local else 0.5)
	for vertex in [Vector2(0, -13), Vector2(9, 10), Vector2(0, 5), Vector2(-9, 10)]: shape.append(at + (vertex * marker_scale).rotated((0.0 if expanded else camera_heading) - angle))
	if local:
		draw_circle(at, 24 if expanded else 14, Color(0.44, 0.93, 0.9, 0.16), true, -1, true)
	draw_colored_polygon(shape, color)
	shape.append(shape[0])
	draw_polyline(shape, Color(0.025, 0.08, 0.1), 2, true)
	if local and expanded: draw_string(font, at + Vector2(-17, -23), "YOU", HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color.WHITE)

func _draw():
	if not expanded and material:
		var rect = get_global_rect()
		var viewport_size = get_viewport_rect().size
		material.set_shader_parameter("map_rect", Vector4(rect.position.x / viewport_size.x, rect.position.y / viewport_size.y, rect.size.x / viewport_size.x, rect.size.y / viewport_size.y))
	draw_rect(Rect2(Vector2.ZERO, size), Color("0c202b"))
	var corner = project(Vector2(bounds.minX, bounds.maxY))
	var extent = Vector2(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * map_scale()
	if expanded:
		draw_texture_rect(ATLAS, Rect2(corner, extent), false)
	else:
		draw_set_transform(size * 0.5, camera_heading, Vector2.ONE * map_scale())
		draw_texture_rect(ATLAS, Rect2(Vector2(bounds.minX - player.x, player.y - bounds.maxY), Vector2(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)), false)
		draw_set_transform(Vector2.ZERO)
	for driver in peers: _marker(driver.position, driver.heading, Color("f4c56a"), false)
	_marker(player, heading, Color.WHITE, true)
	if not expanded:
		var center = size * 0.5
		draw_circle(center, size.x * 0.5 - 1, Color(0.73, 0.9, 0.93, 0.32), false, 1, true)
		var north = center + Vector2(0, -size.x * 0.5 + 14).rotated(camera_heading)
		draw_string(font, north + Vector2(-5, 4), "N", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("c9e2e7"))
		return
	draw_string(font, Vector2(16, 29), "N ↑", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color("c9e2e7"))
	var metres = 100 if not expanded or zoom > 2 else 500
	var bar_width = metres * map_scale()
	var bar = Vector2(18, size.y - 22)
	draw_line(bar, bar + Vector2(bar_width, 0), Color("c9e2e7"), 2, true)
	for end in [bar, bar + Vector2(bar_width, 0)]: draw_line(end - Vector2(0, 4), end + Vector2(0, 4), Color("c9e2e7"), 2)
	draw_string(font, bar - Vector2(0, 10), "%d m" % metres, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("c9e2e7"))
