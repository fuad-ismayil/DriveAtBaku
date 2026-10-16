extends Node

var game
var report = {"checks": 0, "phases": [], "failures": []}
var capture = AudioEffectCapture.new()
var output = "user://horn-qa"

func check(value: bool, message: String):
	report.checks += 1
	if not value:
		report.failures.append(message)
		push_error(message)

func wait_until(predicate: Callable, seconds = 40.0) -> bool:
	var deadline = Time.get_ticks_msec() + seconds * 1000
	while not predicate.call():
		if Time.get_ticks_msec() > deadline: return false
		await get_tree().process_frame
	return true

func horn_touch(pressed: bool):
	var touch = InputEventScreenTouch.new()
	touch.index = 31
	touch.position = game.interface.controls.regions.horn.get_center()
	touch.pressed = pressed
	game.interface.controls._input(touch)

func rms(frames: PackedVector2Array) -> float:
	var energy = 0.0
	for frame in frames: energy += frame.length_squared()
	return sqrt(energy / maxf(1, frames.size() * 2))

func save_audio(frames: PackedVector2Array, name: String):
	var wav = AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = int(AudioServer.get_mix_rate())
	wav.stereo = true
	var bytes = PackedByteArray()
	bytes.resize(frames.size() * 4)
	for i in frames.size():
		bytes.encode_s16(i * 4, roundi(clampf(frames[i].x, -1, 0.9999) * 32768))
		bytes.encode_s16(i * 4 + 2, roundi(clampf(frames[i].y, -1, 0.9999) * 32768))
	wav.data = bytes
	wav.save_to_wav(output.path_join(name + ".wav"))

func _ready():
	var saved = Preferences.values.duplicate(true)
	Preferences.values.touch_controls = true
	DirAccess.make_dir_recursive_absolute(output)
	Preferences.values.server_url = "ws://127.0.0.1:18787"
	Preferences.values.nickname = "AndroidHornQA"
	Preferences.values.vehicle = "ferrari"
	Preferences.values.volume = 0.65
	Preferences.values.night = false
	Preferences.values.weather = "sunny"
	game = load("res://main.tscn").instantiate()
	add_child(game)
	if not await wait_until(func(): return game.ready_to_drive, 150):
		check(false, "Native game did not finish loading")
	else:
		game.sound.spatial_gain = 0.0
		game._action("online")
		var joined = await wait_until(func(): return game.session.joined and game.remotes.size() == 1 and is_instance_valid(game.remotes.values()[0].audio))
		check(joined, "Native game must join the actual web peer")
		if joined: await run_phases()
	Preferences.values = saved
	Preferences.save()
	FileAccess.open(output.path_join("report.json"), FileAccess.WRITE).store_string(JSON.stringify(report, "  "))
	print("HORN_MULTIPLAYER_RESULT ", JSON.stringify(report))
	game.queue_free()
	await get_tree().process_frame
	get_tree().quit(0 if report.failures.is_empty() else 1)

func run_phases():
	var remote = game.remotes.values()[0]
	# Isolate the received horn at its real listener bus; do not alter its gain,
	# routing, spatialization or packet path. Local audio is already muted above.
	AudioServer.set_bus_mute(AudioServer.get_bus_index(remote.audio.buses[1]), true)
	AudioServer.set_bus_mute(AudioServer.get_bus_index(remote.audio.buses[2]), true)
	# Capture the final Master mix after the remote listener's volume and pan.
	var listener_bus = 0
	capture.buffer_length = 1.0
	AudioServer.add_bus_effect(listener_bus, capture)
	var phases = [
		["quiet", false, false], ["native-hold", true, false],
		["native-release", false, false], ["web-hold", false, true],
		["web-release", false, false], ["both-hold", true, true],
		["native-pause", false, true], ["web-pause", false, false],
		["resume", false, false], ["leave-held", true, false]
	]
	for i in phases.size():
		var phase = phases[i]
		if phase[0] == "native-pause": game._action("pause")
		elif phase[0] == "resume": game._action("drive")
		else: horn_touch(phase[1])
		check(await wait_until(func(): return bool(game.state.horn) == phase[1], 5), phase[0] + " touch input must reach simulation")
		game.indicator.revision = i + 1
		game.session.send_vehicle(game.state, game.player.position, "ferrari", 0, game.indicator, 0, true)
		print("HORN_PHASE ", JSON.stringify({"index": i + 1, "name": phase[0], "native": phase[1], "web": phase[2]}))
		var stale = {"seen": false, "rms": -1.0}
		var ack = await wait_until(func():
			if remote.buffer.is_empty(): return false
			var latest = remote.buffer[-1]
			if i == 3 and game.session.server_time() - latest.time > 2000 and bool(latest.state.get("in", {}).get("hn", 0)) and remote.audio.horn_gain < 0.001:
				var frames = capture.get_buffer(capture.get_frames_available())
				if frames.size() > 0:
					stale.rms = rms(frames.slice(maxi(0, frames.size() - int(AudioServer.get_mix_rate() * 0.1))))
					stale.seen = stale.rms < 0.00001
			return latest.state.get("li", {}).get("sigRev", -1) == i + 1 and bool(latest.state.get("in", {}).get("hn", 0)) == phase[2])
		check(ack, phase[0] + " browser acknowledgement / horn state missing")
		if i == 3: check(stale.seen, "Native listener must silence a stalled peer's held horn")
		await get_tree().create_timer(0.45).timeout
		capture.clear_buffer()
		await get_tree().create_timer(0.35).timeout
		var frames = capture.get_buffer(capture.get_frames_available())
		var level = rms(frames)
		check(frames.size() > 0, phase[0] + " must capture actual listener samples")
		check(level > 0.00001 if phase[2] else level < 0.00001, phase[0] + " wrong native horn output: " + str(level))
		check(remote.audio.horn_gain > 0.99 if phase[2] else remote.audio.horn_gain < 0.001, phase[0] + " wrong native horn envelope")
		if phase[2]: check(remote.audio.master_gain > 0.001, phase[0] + " remote listener volume must remain audible")
		save_audio(frames, phase[0])
		report.phases.append({"name": phase[0], "web_horn": phase[2], "native_horn": phase[1], "listener_rms": level, "stale": stale})
	AudioServer.remove_bus_effect(listener_bus, AudioServer.get_bus_effect_count(listener_bus) - 1)
	game._action("disconnect")
	check(game.remotes.is_empty() and not game.session.active, "Leave while honking must remove remote voices")
	await get_tree().create_timer(0.5).timeout
