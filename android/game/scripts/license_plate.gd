extends Node

var library: Node3D
var glyph_libraries: Dictionary = {}
var templates: Dictionary = {}

func _ready():
	library = load("res://assets/vehicles/plate_library.glb").instantiate()
	library.hide()
	add_child(library)
	for mesh in library.find_children("*", "MeshInstance3D", true, false):
		for surface in mesh.mesh.get_surface_count():
			var source = mesh.get_active_material(surface)
			if source != null and source.resource_name == "AZ retroreflective white sheeting":
				var reflective = ShaderMaterial.new()
				reflective.shader = load("res://shaders/plate_white.gdshader")
				reflective.set_shader_parameter("tint", source.albedo_color)
				mesh.set_surface_override_material(surface, reflective)

func create(settings: Dictionary) -> Node3D:
	var key = JSON.stringify(preload("res://scripts/license_plate_settings.gd").normalize(settings))
	if templates.has(key): return templates[key].duplicate()
	var format = "compact" if settings.get("format") == "compact" else "long"
	var older = settings.get("identity", "older") not in ["new", "classic"] and settings.get("hyphens", true)
	var plate = library.find_child("plate_%s_%s" % [format, "older" if older else "new"], true, false).duplicate()
	var stamps = []
	var region = str(settings.get("region", "10"))
	var letters = str(settings.get("letters", "AA"))
	var serial = str(settings.get("serial", "001"))
	if format == "long":
		_line(stamps, region, [-0.1475, -0.0955], 0, 0)
		_line(stamps, letters, [-0.0205, 0.0315], 0, 0)
		_line(stamps, serial, [0.1065, 0.1585, 0.2105], 0, 0)
		if older: _line(stamps, "--", [-0.0585, 0.0695], -0.001, 3)
	else:
		_line(stamps, region, [-0.0215, 0.0155], 0.033, 1)
		_line(stamps, letters, [-0.091, -0.047], -0.034, 2)
		_line(stamps, serial, [0.014, 0.051, 0.088], -0.034, 1)
		if older:
			_line(stamps, "-", [0.047], 0.032, 3)
			_line(stamps, "-", [-0.0165], -0.035, 3)
	# As on the web, batch enamel and shoulders into two draws per plate.
	for category in [0, 1]:
		var tool = SurfaceTool.new()
		tool.begin(Mesh.PRIMITIVE_TRIANGLES)
		var material: Material
		for stamp in stamps:
			var meshes = stamp.glyph.find_children("*", "MeshInstance3D", true, false)
			var mesh = meshes[category]
			material = mesh.get_active_material(0)
			tool.append_from(mesh.mesh, 0, Transform3D(Basis.IDENTITY, stamp.position) * mesh.transform)
		tool.set_material(material)
		var instance = MeshInstance3D.new()
		instance.mesh = tool.commit()
		plate.add_child(instance)
	for mesh in plate.find_children("*", "MeshInstance3D", true, false): mesh.layers = 2
	# Front/rear plates and recent edits share immutable geometry, including LODs.
	templates[key] = plate
	while templates.size() > 8:
		var oldest = templates.keys()[0]
		templates[oldest].free()
		templates.erase(oldest)
	return plate.duplicate()

func _exit_tree():
	for template in templates.values(): template.free()
	templates.clear()

func _line(stamps: Array, text: String, positions: Array, y: float, size: int):
	for i in mini(text.length(), positions.size()):
		var character = "dash" if text[i] == "-" else text[i]
		if not glyph_libraries.has(character):
			var glyphs = load("res://assets/vehicles/plate_glyph_%s.glb" % character).instantiate()
			glyphs.hide()
			add_child(glyphs)
			glyph_libraries[character] = glyphs
		var glyph = glyph_libraries[character].find_child("glyph_%d_%s" % [size, character], true, false)
		if glyph: stamps.append({"glyph": glyph, "position": Vector3(positions[i], y, 0)})
