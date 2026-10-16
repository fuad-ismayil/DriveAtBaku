extends RefCounted

static var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/ui-spec.json"))
