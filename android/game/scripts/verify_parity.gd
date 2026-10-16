extends Node

var failures: Array[String] = []
func check(value: bool, message: String):
	if not value:
		failures.append(message)
		push_error(message)

func _ready():
	var reference = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/presentation-reference.json"))
	var profiles = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/vehicles.json"))
	var banks = JSON.parse_string(FileAccess.get_file_as_string("res://assets/data/engine_banks.json"))
	var mix = preload("res://scripts/engine_mix.gd")
	for item in reference.audio:
		var target = mix.targets(item.state, profiles[item.id])
		for key in ["rpm", "idle", "running", "load"]: check(absf(target[key] - item.target[key]) < 1e-9, "Audio target mismatch: " + key)
		for role in ["on", "off"]:
			var weights = mix.weights(banks[item.id][role], target.rpm)
			for i in weights.size(): check(absf(weights[i] - item[role][i]) < 1e-9, "Audio crossfade mismatch")
	var activity = preload("res://scripts/room_activity.gd").new(64, 599)
	for sample in reference.rooms:
		while activity.time < sample.time: activity.update(10)
		check(activity.events == int(sample.events), "Independent window event mismatch")
		for i in activity.states.size(): check(absf(activity.states[i] - sample.states[i]) < 0.0001, "Room state mismatch")
	var camera = preload("res://scripts/camera_return.gd")
	for speed in [0, 1, 4, 7.9, -4]: check(camera.blend(speed, 1, false) == 0, "Camera moved while parking")
	check(camera.blend(15, 1, false) > 0 and camera.blend(15, 1, false) < camera.blend(32, 1, false), "Camera must return progressively with speed")
	check(camera.blend(90, 1, true) == 0, "Camera must respect active drag")
	var frame_blend = camera.blend(32, 1.0 / 60, false)
	check(absf(pow(1 - frame_blend, 60) - (1 - camera.blend(32, 1, false))) < 1e-9, "Camera return must be frame-rate independent")
	var bus_count = AudioServer.bus_count
	var saved = Preferences.values.duplicate(true)
	# Missing config keys can yield immutable constant defaults on migration.
	Preferences.values.plates_by_vehicle = Preferences.DEFAULTS.plates_by_vehicle
	Preferences._store_plate()
	check(Preferences.values.plates_by_vehicle.has(Preferences.values.vehicle), "Plate settings migration must copy immutable defaults")
	Preferences.values = saved
	var audio = preload("res://scripts/engine_audio.gd").new()
	add_child(audio)
	for id in profiles:
		audio.setup(id, profiles[id])
		check(audio.shift_player.stream.format == AudioStreamWAV.FORMAT_16_BITS, "Shift transient must remain PCM")
		await get_tree().create_timer(0.06).timeout
		for layer in audio.layers:
			var stream = layer.player.stream
			check(stream.format == AudioStreamWAV.FORMAT_16_BITS, "Engine loop must remain PCM")
			var frame_bytes = 2 * (2 if stream.stereo else 1)
			check(stream.loop_end > 0 and stream.loop_end == stream.data.size() / frame_bytes - 1, "Loop must preserve every source frame plus a wrap guard")
			check(stream.data.slice(0, frame_bytes) == stream.data.slice(stream.loop_end * frame_bytes), "Loop guard must equal its first PCM frame")
		check(AudioServer.bus_count == bus_count + 3, "Audio buses leaked during vehicle change")
		for step in 60:
			audio.update({"rpm": profiles[id].idleRpm, "throttle": 0, "engine_load": 0, "shift_timer": 0, "acceleration": 0, "wheels": []}, true, 1.0 / 60)
		check(audio.layers[0].gain > 1, "Idle layer missing")
		audio.update({"rpm": 4000, "throttle": 1, "engine_load": 1, "shift_timer": .1, "acceleration": 0, "wheels": []}, true, 1.0 / 60)
		check(audio.mix_load < 0.08, "Shift must unload audio without altering physics")
		var shift_state = {"rpm": 3000, "gear": 2, "velocity": Vector3(0, 0, -10), "wheels": []}
		audio.update(shift_state, true, 1.0 / 60)
		shift_state.gear = 3
		audio.update(shift_state, true, 1.0 / 60)
		check(audio.shift_player.playing, "Moving gear changes must play the quiet shift transient")
		audio.shift_player.stop()
		var braking_state = mix.from_wire({"rpm": 3000, "in": {"br": 0.8}, "w": [{"c": 1, "sl": 10.2}]}, {"rpm": 3000}, 0)
		check(braking_state.brake == 0.8 and braking_state.wheels[0].grounded and braking_state.wheels[0].slip == 10.2, "Remote braking/slip state lost")
		for step in 60: audio.update(braking_state, true, 1.0 / 60)
		check(audio.skid_gain > 0.1, "Remote grounded slip must reproduce the local tire sample")
		braking_state.wheels[0].grounded = false
		for step in 60: audio.update(braking_state, true, 1.0 / 60)
		check(audio.skid_gain < 0.00001, "Remote airborne slip must remain silent")
		shift_state.gear = 4
		audio.update(shift_state, false, 1.0 / 60)
		check(not audio.shift_player.playing, "Muted gear changes must not start a transient")
		audio.set_suspended(true)
		check(AudioServer.is_bus_mute(AudioServer.get_bus_index(audio.buses[0])), "Android focus loss must mute immediately")
		for layer in audio.layers: check(layer.player.stream_paused, "Background audio must pause its loops")
		audio.set_suspended(false)
	audio.queue_free()
	await get_tree().process_frame
	await get_tree().create_timer(0.12).timeout
	check(AudioServer.bus_count == bus_count, "Audio buses leaked on shutdown")
	# A constant signal exposes a single bad wrap sample without relying on a
	# peak/RMS average that could miss a click in otherwise healthy engine audio.
	for stereo in [false, true]:
		var frame_bytes = 4 if stereo else 2
		var stream = AudioStreamWAV.new()
		stream.format = AudioStreamWAV.FORMAT_16_BITS
		stream.stereo = stereo
		stream.mix_rate = int(AudioServer.get_mix_rate())
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_end = 257
		var pcm = PackedByteArray()
		pcm.resize(258 * frame_bytes)
		for i in pcm.size() / 2: pcm.encode_s16(i * 2, 8192)
		stream.data = pcm
		var playback = stream.instantiate_playback()
		playback.start()
		var rendered = playback.mix_audio(1, 8192)
		for i in range(256, rendered.size()): check(absf(rendered[i].x - 8192.0 / 32767) < 0.00001 and absf(rendered[i].y - 8192.0 / 32767) < 0.00001, "PCM loop emitted a wrap impulse")
	if failures.is_empty(): print("NATIVE_PRESENTATION_PASS 144 audio targets, RPM crossfades, PCM loops, bus lifecycle, independent room timers and parking camera")
	get_tree().quit(0 if failures.is_empty() else 1)
