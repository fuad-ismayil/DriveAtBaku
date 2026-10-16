extends Node

const Mix = preload("res://scripts/engine_mix.gd")
var bank: Dictionary = {}
var profile: Dictionary = {}
var layers: Array = []
var tire: AudioStreamPlayer
var tone: AudioEffectLowPassFilter
var tire_tone: AudioEffectLowPassFilter
var buses: Array[String] = []
var engine_bus = ""
var mix_load = 0.08
var audio_rpm = 0.0
var master_gain = 0.0
var bank_gain = 0.0
var skid_gain = 0.0
var running = false
var suspended = false
var spatial_gain = 1.0
var spatial_pan = 0.0
var panner: AudioEffectPanner
var shift_player: AudioStreamPlayer
var last_gear = -1

func _bus(suffix: String, destination: String) -> int:
	var name = "NativeVehicle_%d_%s" % [get_instance_id(), suffix]
	AudioServer.add_bus()
	var index = AudioServer.bus_count - 1
	AudioServer.set_bus_name(index, name)
	AudioServer.set_bus_send(index, destination)
	buses.append(name)
	return index

func setup(id: String, settings: Dictionary):
	shutdown()
	for item in layers: item.player.queue_free()
	layers.clear()
	if is_instance_valid(tire): tire.queue_free()
	if is_instance_valid(shift_player): shift_player.queue_free()
	_remove_buses()
	var master_index = _bus("Master", "Master")
	var compressor = AudioEffectCompressor.new()
	compressor.threshold = -13
	compressor.ratio = 2.5
	compressor.attack_us = 10000
	compressor.release_ms = 220
	AudioServer.add_bus_effect(master_index, compressor)
	panner = AudioEffectPanner.new()
	AudioServer.add_bus_effect(master_index, panner)
	var engine_index = _bus("Engine", buses[0])
	engine_bus = buses[-1]
	tone = AudioEffectLowPassFilter.new()
	tone.cutoff_hz = 1500
	tone.resonance = 0.52
	AudioServer.add_bus_effect(engine_index, tone)
	var tire_index = _bus("Tires", buses[0])
	tire_tone = AudioEffectLowPassFilter.new()
	tire_tone.cutoff_hz = 4200
	tire_tone.resonance = 0.5
	AudioServer.add_bus_effect(tire_index, tire_tone)
	var banks = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/engine_banks.json"))
	bank = banks[id]
	profile = settings
	audio_rpm = float(settings.idleRpm)
	mix_load = 0.08
	master_gain = 0
	bank_gain = 0
	skid_gain = 0
	last_gear = -1
	for role in ["idle", "on", "off", "character"]:
		if not bank.has(role): continue
		var entries = [bank[role]] if role in ["idle", "character"] else bank[role]
		for index in entries.size():
			var source = entries[index]
			var player = AudioStreamPlayer.new()
			player.stream = _loop(source.file)
			player.bus = engine_bus
			player.volume_db = -80
			add_child(player)
			# Preserve the web's staggered phases for overlapping recordings.
			var offset_index = 0 if role == "idle" else (12 if role == "character" else index + (7 if role == "off" else 1))
			player.play(fmod(offset_index * 0.173, player.stream.get_length()))
			layers.append({"player": player, "role": role, "source": source, "gain": 0.0, "pitch": 1.0})
	tire = AudioStreamPlayer.new()
	tire.stream = _loop("tires-squeal-loop.wav")
	tire.bus = buses[-1]
	tire.volume_db = -80
	add_child(tire)
	tire.play()
	shift_player = AudioStreamPlayer.new()
	shift_player.stream = load("res://assets/audio/gear-shift.wav")
	shift_player.bus = buses[0]
	shift_player.volume_db = linear_to_db(0.014 * float(profile.get("soundVol", 1)))
	add_child(shift_player)
	running = true
	set_suspended(suspended)

func _loop(file: String) -> AudioStream:
	var stream = load("res://assets/audio/%s" % file).duplicate()
	if stream is AudioStreamWAV:
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_begin = 0
		# Godot 4.6's WAV mixer decodes the end frame inclusively in a mix
		# block, then wraps using an exclusive endpoint. Without a guard it
		# reads beyond PCM data and inserts a zero impulse once per loop.
		var frame_bytes = (2 if stream.format == AudioStreamWAV.FORMAT_16_BITS else 1) * (2 if stream.stereo else 1)
		var pcm: PackedByteArray = stream.data
		stream.loop_end = pcm.size() / frame_bytes
		pcm.append_array(pcm.slice(0, frame_bytes))
		stream.data = pcm
	return stream

func update(state: Dictionary, enabled: bool, dt: float):
	if not running or bank.is_empty() or state.is_empty(): return
	AudioServer.set_bus_mute(AudioServer.get_bus_index(buses[0]), suspended)
	enabled = enabled and not suspended
	var target = Mix.targets(state, profile)
	audio_rpm = lerpf(audio_rpm, target.rpm, 1 - exp(-25 * dt))
	mix_load = lerpf(mix_load, target.load, 1 - exp(-(18 if target.shifting else 9) * dt))
	master_gain = lerpf(master_gain, float(Preferences.values.volume) * spatial_gain if enabled else 0.0, 1 - exp(-dt / (0.08 if enabled else 0.04)))
	panner.pan = lerpf(panner.pan, spatial_pan, 1 - exp(-dt / 0.06))
	bank_gain = lerpf(bank_gain, float(profile.get("soundVol", 1)) * 0.95 * float(bank.get("gain", 1)) if enabled else 0.0, 1 - exp(-dt / 0.12))
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index(buses[0]), linear_to_db(maxf(master_gain, 0.00001)))
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index(engine_bus), linear_to_db(maxf(bank_gain, 0.00001)))
	var cutoff = maxf(bank.cutoffFloor, minf(6800, (420 + audio_rpm * 0.4 + mix_load * 1100) * bank.brightness))
	tone.cutoff_hz = lerpf(tone.cutoff_hz, cutoff, 1 - exp(-dt / 0.065))
	var on_weights = Mix.weights(bank.on, audio_rpm)
	var off_weights = Mix.weights(bank.off, audio_rpm)
	var on_index = 0
	var off_index = 0
	for layer in layers:
		var gain = target.idle
		var time_constant = 0.07
		var pitch = clampf(audio_rpm / float(layer.source.rpm), 0.75, 1.45)
		if layer.role == "on":
			gain = target.running * float(on_weights[on_index]) * sqrt(mix_load) * 0.98
			on_index += 1
		elif layer.role == "off":
			gain = target.running * float(off_weights[off_index]) * sqrt(1 - mix_load) * 0.78
			off_index += 1
		elif layer.role == "character":
			gain = target.running * (0.38 + 0.62 * mix_load) * clampf((5500 - audio_rpm) / 1700, 0, 1)
			time_constant = 0.09
			pitch = clampf(audio_rpm / float(layer.source.rpm), 0.45, 1.65)
		if layer.role in ["on", "off"]:
			pitch = clampf(audio_rpm / float(layer.source.rpm), 0.62, 1.7)
			time_constant = 0.075
		gain *= float(layer.source.get("level", 1.0))
		layer.gain = lerpf(layer.gain, gain if enabled else 0.0, 1 - exp(-dt / time_constant))
		layer.pitch = lerpf(layer.pitch, pitch, 1 - exp(-dt / (0.055 if layer.role == "character" else 0.045)))
		layer.player.volume_db = linear_to_db(maxf(layer.gain, 0.00001))
		layer.player.pitch_scale = layer.pitch
	var sliding = 0.0
	for wheel in state.wheels:
		if wheel.grounded: sliding = maxf(sliding, maxf(0, wheel.slip - 2.2) / 8)
	skid_gain = lerpf(skid_gain, minf(0.136, sliding * 0.119) if enabled else 0.0, 1 - exp(-dt / 0.06))
	tire.volume_db = linear_to_db(maxf(skid_gain, 0.00001))
	tire.pitch_scale = lerpf(tire.pitch_scale, 0.9 + 0.18 * minf(sliding, 1), 1 - exp(-dt / 0.08))
	tire_tone.cutoff_hz = lerpf(tire_tone.cutoff_hz, 3000 + 1800 * minf(sliding, 1), 1 - exp(-dt / 0.08))
	var gear = int(state.get("gear", -1))
	var velocity: Vector3 = state.get("velocity", Vector3.ZERO)
	if enabled and last_gear >= 0 and gear != last_gear and gear > 1 and Vector2(velocity.x, velocity.z).length() * 3.6 > 7:
		shift_player.play()
	last_gear = gear

func shutdown():
	running = false
	for item in layers:
		if is_instance_valid(item.player):
			item.player.stop()
			item.player.stream = null
	if is_instance_valid(tire):
		tire.stop()
		tire.stream = null
	if is_instance_valid(shift_player): shift_player.stop()

func set_suspended(value: bool):
	suspended = value
	if value:
		master_gain = 0
		bank_gain = 0
		if not buses.is_empty(): AudioServer.set_bus_mute(AudioServer.get_bus_index(buses[0]), true)
	for item in layers:
		if is_instance_valid(item.player): item.player.stream_paused = value
	if is_instance_valid(tire): tire.stream_paused = value
	if is_instance_valid(shift_player): shift_player.stream_paused = value

func _remove_buses():
	for name in buses:
		var index = AudioServer.get_bus_index(name)
		if index > 0: AudioServer.remove_bus(index)
	buses.clear()

func _exit_tree():
	shutdown()
	_remove_buses()
