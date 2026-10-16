extends Node

const DEFAULTS = {
	"version": 1, "nickname": "Player", "vehicle": "ferrari", "automatic": true,
	"control_mode": "buttons", "sensitivity": 1.0, "weight": 0.4,
	"quick_response": 0.7, "self_center": 0.7, "self_center_enabled": true,
	"control_scale": 1.0, "left_handed": false, "volume": 0.65,
	"resolution": 720, "quality": "performance", "render_distance": 1800.0,
	"night": false, "weather": "sunny", "server_url": "wss://server.driveatbaku.games/",
	"abs": true, "tcs": true, "esc": false, "paint": "#a80719",
	"plate_region": "10", "plate_letters": "AA", "plate_serial": "001",
	"plate_enabled": true, "plate_hyphens": true, "plate_format": "long", "plates_by_vehicle": {}
}
var values: Dictionary = DEFAULTS.duplicate(true)

func _ready():
	var config = ConfigFile.new()
	if config.load("user://preferences.cfg") == OK:
		for key in DEFAULTS:
			var value = config.get_value("settings", key, DEFAULTS[key])
			if typeof(value) == typeof(DEFAULTS[key]) or (value is int and DEFAULTS[key] is float):
				values[key] = value.duplicate(true) if value is Dictionary or value is Array else value
	for key in ["sensitivity", "weight", "quick_response", "self_center", "control_scale", "volume"]:
		values[key] = clampf(float(values[key]), 0.0, 2.0)
	values.control_scale = clampf(values.control_scale, 0.75, 1.35)
	values.render_distance = clampf(float(values.render_distance), 400.0, 6000.0)
	values.resolution = clampi(int(values.resolution), 360, 1080)
	if values.control_mode not in ["buttons", "sliders"]:
		values.control_mode = "buttons"
	if values.vehicle not in ["ferrari", "elantra", "amg", "prado"]:
		values.vehicle = "ferrari"
	values.nickname = str(values.nickname).strip_edges().substr(0, 16)
	if values.nickname.is_empty():
		values.nickname = "Player"

func update(key: String, value):
	if key == "vehicle" and value != values.vehicle:
		_store_plate()
		var plate = values.plates_by_vehicle.get(value, {})
		for field in ["enabled", "region", "letters", "serial", "hyphens", "format"]:
			values["plate_" + field] = plate.get(field, DEFAULTS["plate_" + field])
	values[key] = value
	if key.begins_with("plate_"): _store_plate()
	save()

func _store_plate():
	var plates = values.plates_by_vehicle.duplicate(true)
	plates[values.vehicle] = plate_settings()
	values.plates_by_vehicle = plates

func save():
	var config = ConfigFile.new()
	for key in values:
		config.set_value("settings", key, values[key])
	var result = config.save("user://preferences.cfg")
	if result != OK:
		push_warning("Could not save preferences: %s" % error_string(result))

func plate_settings() -> Dictionary:
	return preload("res://scripts/license_plate_settings.gd").normalize({"enabled": values.plate_enabled, "region": values.plate_region, "letters": values.plate_letters, "serial": values.plate_serial, "hyphens": values.plate_hyphens, "format": values.plate_format})
