extends Node3D

var failures: Array = []

func check(condition: bool, message: String):
	if not condition:
		failures.append(message)
		push_error(message)

func _ready():
	var view = preload("res://scripts/vehicle_view.gd").new()
	add_child(view)
	check(await view.load_vehicle("prado"), "Prado must load")
	view.paint("#a80719")
	var world = WorldEnvironment.new()
	world.environment = Environment.new()
	world.environment.background_mode = Environment.BG_COLOR
	world.environment.background_color = Color(0.15, 0.18, 0.21)
	world.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	world.environment.ambient_light_color = Color.WHITE
	world.environment.ambient_light_energy = 0.8
	add_child(world)
	var light = DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-30, -20, 0)
	add_child(light)
	var camera = Camera3D.new()
	add_child(camera)
	camera.current = true
	camera.position = Vector3(0, 1.05, -3.0)
	camera.look_at(Vector3(0, 0.95, -2.34))
	camera.fov = 40
	var badge = view.model.find_child("Object_52", true, false)
	var material = badge.get_active_material(0)
	check(material.shader.code.contains("render_mode cull_disabled;"), "Prado's authored two-sided front badge must remain two-sided")
	var water = preload("res://scripts/vehicle_water.gd").new()
	for transparent in [false, true]:
		for mode in [BaseMaterial3D.CULL_BACK, BaseMaterial3D.CULL_FRONT, BaseMaterial3D.CULL_DISABLED]:
			var source = StandardMaterial3D.new()
			source.cull_mode = mode
			source.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if transparent else BaseMaterial3D.TRANSPARENCY_DISABLED
			var converted = water.create(source, transparent)
			var expected = ["cull_back", "cull_front", "cull_disabled"][mode]
			check(converted.shader.code.contains(expected + ";"), "Water shader must preserve source culling: " + expected)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://../../artifacts/android/badge"))
	if DisplayServer.get_name() != "headless": await capture("prado-front-badge")
	print("NATIVE_BADGE ", JSON.stringify({"passed": failures.is_empty(), "failures": failures}))
	get_tree().quit(0 if failures.is_empty() else 1)

func capture(name: String):
	for i in 12: await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("res://../../artifacts/android/badge/%s.png" % name)
