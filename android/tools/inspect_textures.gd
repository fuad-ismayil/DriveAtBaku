extends SceneTree

func _initialize():
	var scene = load("res://assets/world/baku.glb").instantiate()
	var seen = {}
	var count = 0
	for mesh in scene.find_children("*", "MeshInstance3D", true, false):
		for surface in mesh.mesh.get_surface_count():
			var material = mesh.get_active_material(surface)
			if material is StandardMaterial3D and material.albedo_texture and not seen.has(material.albedo_texture):
				var texture = material.albedo_texture
				seen[texture] = true
				print("TEXTURE ", texture.get_class(), " ", texture.resource_path, " ", texture.get_size())
				count += 1
				if count >= 5:
					scene.free()
					quit()
					return
	scene.free()
	quit()
