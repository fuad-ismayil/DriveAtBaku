extends RefCounted

static func digits(value, count: int, fallback: String) -> String:
	var result = ""
	for c in str(value):
		if c in "0123456789" and result.length() < count: result += c
	return result.pad_zeros(count) if not result.is_empty() and int(result) > 0 else fallback

static func normalize(value: Dictionary) -> Dictionary:
	var letters = ""
	for c in str(value.get("letters", "")).to_upper():
		if c in "ABCDEFGHJKLMNOPRSTUVXYZ" and letters.length() < 2: letters += c
	var plain = value.get("identity", "older") in ["new", "classic"] or value.get("hyphens", true) == false
	return {"enabled": value.get("enabled", true) if value.get("enabled", true) is bool else true,
		"region": digits(value.get("region", ""), 2, "10"), "letters": letters if letters.length() == 2 else "AA",
		"serial": digits(value.get("serial", ""), 3, "001"), "hyphens": not plain,
		"identity": "new" if plain else "older", "format": "compact" if value.get("format") == "compact" else "long"}
