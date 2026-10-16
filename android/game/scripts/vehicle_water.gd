extends RefCounted

var materials: Array[ShaderMaterial] = []
var wetness = 0.0
var rain = 0.0
var time = 0.0
var travel = Vector3.ZERO
const TO_WEB = Transform3D(Basis(Vector3(1, 0, 0), Vector3(0, 0, 1), Vector3(0, -1, 0)), Vector3.ZERO)

func create(source: StandardMaterial3D, glass: bool) -> ShaderMaterial:
	var shader = Shader.new()
	var transparent = source.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED
	shader.code = FileAccess.get_file_as_string("res://shaders/vehicle_water.shader.txt").replace("/*MODE*/", "blend_mix,depth_prepass_alpha,cull_disabled" if transparent else "cull_back").replace("/*ALPHA*/", "ALPHA=color.a;" if transparent else "")
	var material = ShaderMaterial.new()
	material.shader = shader
	material.resource_name = source.resource_name
	material.set_shader_parameter("tint", source.albedo_color)
	material.set_shader_parameter("has_texture", source.albedo_texture != null)
	if source.albedo_texture: material.set_shader_parameter("color_texture", source.albedo_texture)
	material.set_shader_parameter("has_normal", source.normal_enabled and source.normal_texture != null)
	if source.normal_texture: material.set_shader_parameter("normal_texture", source.normal_texture)
	material.set_shader_parameter("normal_scale", source.normal_scale)
	material.set_shader_parameter("roughness_value", source.roughness)
	material.set_shader_parameter("metallic_value", source.metallic)
	material.set_shader_parameter("base_emission", source.emission)
	material.set_shader_parameter("base_emission_energy", source.emission_energy_multiplier if source.emission_enabled else 0.0)
	material.set_shader_parameter("is_glass", glass)
	material.set_shader_parameter("base_coat", source.clearcoat if source.clearcoat_enabled else 0.0)
	material.set_shader_parameter("base_coat_roughness", source.clearcoat_roughness)
	materials.append(material)
	return material

func update(vehicle: Node3D, velocity: Vector3, dt: float):
	if materials.is_empty(): return
	time += maxf(0, dt)
	var weather = Preferences.values.weather
	var falling = 1.0 if weather == "rain" else 0.0
	if falling > 0: wetness = lerpf(wetness, 1, 1 - exp(-0.2 * dt))
	else: wetness = maxf(0, wetness - dt * ((0.018 if weather == "sunny" else 0.008) + minf(velocity.length(), 70) * 0.00022))
	rain = lerpf(rain, falling, 1 - exp(-1.2 * dt))
	var inverse = TO_WEB * vehicle.global_transform.affine_inverse()
	var gravity = inverse.basis * Vector3.DOWN
	var wind = inverse.basis * (Vector3(2.2, 0, -0.55) - velocity)
	var flow = gravity * (0.022 + wetness * 0.055) + wind * 0.0024
	travel += flow * dt * wetness
	for material in materials:
		material.set_shader_parameter("world_to_vehicle", inverse)
		material.set_shader_parameter("carWaterWetness", wetness)
		material.set_shader_parameter("carWaterRain", rain)
		material.set_shader_parameter("carWaterTime", time)
		material.set_shader_parameter("carWaterDetail", 0.0 if Preferences.values.quality == "performance" else 0.65)
		material.set_shader_parameter("carWaterTravel", travel)
		material.set_shader_parameter("carWaterFlow", flow)
		material.set_shader_parameter("carWaterGravity", gravity)
