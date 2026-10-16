extends Node

func _ready():
	var view = preload("res://scripts/vehicle_view.gd").new()
	add_child(view)
	for id in view.IDS:
		assert(await view.load_vehicle(id))
		var found = []
		for material in view.materials.values(): found.append(material.resource_name)
		print("PRESENTATION_MATERIALS %s signals=%d materials=%s" % [id, view.signal_materials.size(), found])
		for item in view.signal_materials:
			print("SIGNAL_ROLE %s %s" % [item.material.resource_name, item.role])
	view.queue_free()
	await get_tree().process_frame
	get_tree().quit()
