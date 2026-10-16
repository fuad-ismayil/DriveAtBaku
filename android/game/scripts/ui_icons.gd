extends RefCounted

# Vector paths use the same fine, rounded 24-unit grid as the web interface.
const PATHS = {
	"plus": "M5 12H19M12 5V19",
	"minus": "M5 12H19",
	"road": "M5 21L9 3M19 21L15 3M12 4V8M12 11V14M12 17V21",
	"arrow": "M5 12H19M13 6L19 12L13 18",
	"back": "M19 12H5M11 6L5 12L11 18",
	"external": "M7 17L17 7M7 7H17V17",
	"garage": "M3 21V9L12 3L21 9V21M7 21V11H17V21M7 15H17M7 18H17",
	"people": "M15 21V18C15 15 3 15 3 18V21M9 12A4 4 0 1 0 9 4A4 4 0 1 0 9 12M17 5C22 5 22 12 17 12M18 16C21 16 22 17 22 20",
	"settings": "M4 7H20M4 17H20M9 4V10M15 14V20",
	"sun": "M12 8A4 4 0 1 0 12 16A4 4 0 1 0 12 8M12 2V4M12 20V22M2 12H4M20 12H22M5 5L6 6M18 18L19 19M5 19L6 18M18 6L19 5",
	"moon": "M20 15A8 8 0 0 1 9 4A8.5 8.5 0 1 0 20 15",
	"coffee": "M5 8H17V14A5 5 0 0 1 12 19H10A5 5 0 0 1 5 14ZM17 9H19A2.5 2.5 0 0 1 19 14H17M4 22H18M8 2V4M12 2V4",
	"pause": "M9 6V18M15 6V18",
	"play": "M8 5L19 12L8 19Z",
	"recover": "M4 10A8 8 0 1 1 5 18M4 4V10H10",
	"camera": "M3 7H7L9 4H15L17 7H21V20H3ZM12 10A3 3 0 1 0 12 16A3 3 0 1 0 12 10",
	"lights": "M12 5C3 5 3 19 12 19ZM16 6L22 4M16 10H22M16 14H22M16 18L22 20",
	"gear": "M6 3V21M18 3V12H6M12 3V21",
	"throttle": "M11 3H16L18 20H9ZM12 7H15M12 11H15.5M11.5 15H16M11.5 18H16.5",
	"brake": "M11 3H14V8M5 9H19L21 20H3ZM7 12H17M6 16H18",
	"handbrake": "M4 5A10 10 0 0 0 4 19M20 5A10 10 0 0 1 20 19M12 5A7 7 0 1 0 12 19A7 7 0 1 0 12 5M10 16V8H13A2.5 2.5 0 0 1 13 13H10",
	"horn": "M9 15V12Q9 8 13 8H14L19 4V18L14 14H12M9 15C3 12 1 19 6 21C12 23 15 17 9 15ZM21 7L23 6M21 11H23M21 15L23 16",
	"close": "M6 6L18 18M18 6L6 18",
	"info": "M12 3A9 9 0 1 0 12 21A9 9 0 1 0 12 3M12 11V17M12 7V7.1",
	"compass": "M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2M16 8L14 14L8 16L10 10Z",
	"check": "M5 12L10 17L20 7",
	"left": "M19 12H5M11 6L5 12L11 18",
	"hazard": "M12 3L22 21H2ZM12 9V14M12 17V17.1"
}
static var cache: Dictionary = {}

static func get_icon(id: String) -> Texture2D:
	if cache.has(id): return cache[id]
	var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path d="%s" fill="none" stroke="#f8f9fa" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' % PATHS.get(id, PATHS.arrow)
	var image = Image.new()
	image.load_svg_from_string(svg, 2.0)
	cache[id] = ImageTexture.create_from_image(image)
	return cache[id]
