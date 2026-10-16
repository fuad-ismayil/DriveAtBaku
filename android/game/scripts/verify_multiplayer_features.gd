extends Node

var game
var failures: Array[String] = []
var report = {"phases": [], "checks": 0}

func check(value: bool, message: String):
	report.checks += 1
	if not value:
		failures.append(message)
		push_error(message)

func wait_until(predicate: Callable, seconds = 35.0) -> bool:
	var deadline = Time.get_ticks_msec() + seconds * 1000
	while not predicate.call():
		if Time.get_ticks_msec() > deadline: return false
		await get_tree().process_frame
	return true

func _ready():
	Preferences.values.server_url = "ws://127.0.0.1:18787"
	Preferences.values.vehicle = "ferrari"
	Preferences.values.weather = "sunny"
	Preferences.values.night = false
	Preferences.values.volume = 0.32
	game = load("res://main.tscn").instantiate()
	add_child(game)
	if not await wait_until(func(): return game.ready_to_drive, 150):
		push_error("NATIVE_MULTIPLAYER_FEATURES_FAILED loading")
		get_tree().quit(1)
		return
	game.sound.spatial_gain = 0.0 # Record only the reconstructed remote voice.
	game.set_physics_process(false) # Deterministic audio fixtures, no vehicle-equation changes.
	var base_buses = AudioServer.bus_count
	game._action("online")
	check(await wait_until(func(): return game.session.joined and game.remotes.size() == 1), "Game must join browser peer")
	var first_id = game.session.own_id
	var recording = AudioEffectRecord.new()
	recording.format = AudioStreamWAV.FORMAT_16_BITS
	AudioServer.add_bus_effect(0, recording)
	recording.set_recording_active(true)
	for id in ["ferrari", "elantra", "amg", "prado"]:
		await game._select_vehicle(id)
		game.sound.spatial_gain = 0.0
		for phase in ["off", "left", "right", "hazard"]:
			print("DEVICE_MP_PHASE " + id + " " + phase)
			game.indicator.mode = phase
			game.indicator.revision += 1
			game.indicator.epoch = game.session.server_time()
			var fixture = {"off": [game.vehicles[id].idleRpm, 0.0, 0.0, 0.0, 1], "left": [5000, 0.9, 0.0, 5.0, 2], "right": [3000, 0.0, 0.0, -3.0, 2], "hazard": [3500, 0.4, 0.1, 0.0, 3]}[phase]
			game.state.rpm = fixture[0]
			game.state.engine_load = fixture[1]
			game.state.throttle = fixture[1]
			game.state.shift_timer = fixture[2]
			game.state.acceleration = fixture[3]
			game.state.gear = fixture[4]
			game.state.brake = 0.8 if phase == "right" else 0.0
			game.state.brake_force = game.state.brake
			for wheel in game.state.wheels:
				wheel.slip = 10.2 if phase == "right" else 0.0
				wheel.grounded = true
				wheel.load = 1000.0
			game.session.send_vehicle(game.state, game.player.position, id, 1, game.indicator, 0, true)
			var ready = await wait_until(func():
				if game.remotes.size() != 1: return false
				var remote = game.remotes.values()[0]
				return remote.vehicle == id and is_instance_valid(remote.audio) and not remote.buffer.is_empty() and remote.buffer[-1].state.get("li", {}).get("sig") == phase and remote.buffer[-1].state.get("li", {}).get("sigRev", -1) == game.indicator.revision)
			check(ready, id + " remote vehicle/phase did not arrive: " + phase)
			if not ready:
				for stalled in game.remotes.values(): print("DEVICE_MP_DIAGNOSTIC " + JSON.stringify({"vehicle": stalled.vehicle, "loading": stalled.loading, "latest": stalled.buffer[-1].state if not stalled.buffer.is_empty() else {}, "status": game.session.status, "driving": game.is_driving}))
				continue
			await get_tree().create_timer(1.1).timeout
			var remote = game.remotes.values()[0]
			# A cold web model/shader upload can stall its first snapshots. Wait
			# for a live audible peer before measuring, rather than treating a
			# stale-packet mute during asset loading as an audio transport result.
			check(await wait_until(func(): return remote.audio.master_gain > 0.001), id + " live audio never resumed: " + phase)
			var capture = AudioEffectCapture.new()
			capture.buffer_length = 1.0
			var bus_index = AudioServer.get_bus_index(remote.audio.buses[0])
			AudioServer.add_bus_effect(bus_index, capture)
			await get_tree().create_timer(0.6).timeout
			var frames = capture.get_buffer(capture.get_frames_available())
			var energy = 0.0
			for frame in frames: energy += frame.length_squared()
			var rms = sqrt(energy / maxf(1, frames.size() * 2))
			check(rms > 0.00001, id + " remote audio graph has no output: " + phase)
			AudioServer.remove_bus_effect(bus_index, AudioServer.get_bus_effect_count(bus_index) - 1)
			var wire = remote.buffer[-1].state
			var expected = preload("res://scripts/engine_mix.gd").targets(preload("res://scripts/engine_mix.gd").from_wire(wire, wire, 0), game.vehicles[id])
			check(absf(remote.audio.audio_rpm - expected.rpm) < 10, id + " RPM mismatch: " + phase)
			check(absf(remote.audio.mix_load - expected.load) < 0.01, id + " load/shift mismatch: " + phase)
			check(remote.audio.profile.id == id and remote.audio.layers.size() >= 6, id + " wrong sample bank")
			check(remote.audio.master_gain > 0, id + " remote voice is silent")
			if phase == "right": check(remote.audio.skid_gain > 0.1, id + " missing remote braking/tire audio")
			else: check(remote.audio.skid_gain < 0.001, id + " tire audio without physics slip")
			if phase == "right":
				for item in remote.view.signal_materials:
					if "brake" in item.definition.get("roles", []): check(is_equal_approx(float(item.material.get_shader_parameter("emission_level")), 3.6), id + " remote brake state lost")
			if phase == "hazard":
				var near_gain = remote.audio.spatial_gain
				var listener_position = game.camera.position
				game.camera.position += Vector3(140, 0, 0)
				game._update_remotes(1.0 / 30)
				check(remote.audio.spatial_gain == 0, id + " distant voice must attenuate")
				game.camera.position = listener_position
				game._update_remotes(1.0 / 30)
				check(near_gain > 0.1, id + " nearby spatial envelope incorrect")
			report.phases.append({"car": id, "phase": phase, "rpm": remote.audio.audio_rpm, "load": remote.audio.mix_load, "layers": remote.audio.layers.size(), "rms": rms, "skid": remote.audio.skid_gain, "master": remote.audio.master_gain, "suspended": remote.audio.suspended})
		check(game.interface.leave_button.visible, "Leave Room must be reachable in driving UI")
		if DisplayServer.get_name() != "headless":
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png("user://multiplayer_%s.png" % id)
	recording.set_recording_active(false)
	if DisplayServer.get_name() != "headless": recording.get_recording().save_to_wav("user://remote-engine-phases.wav")
	AudioServer.remove_bus_effect(0, AudioServer.get_bus_effect_count(0) - 1)
	game._action("disconnect")
	await get_tree().process_frame
	check(game.remotes.is_empty() and not game.session.active and not game.session.joined, "Leave must clear multiplayer state")
	check(not game.is_driving and game.interface.panel.visible and not game.interface.controls.active, "Leave must return safely to menu")
	check(AudioServer.bus_count == base_buses, "Remote audio buses leaked after leave")
	check(await wait_until(func(): return game.session.closing_sockets.is_empty()), "Close handshake incomplete")
	game._action("drive")
	check(game.is_driving and game.remotes.is_empty(), "Single-player must resume after leave")
	game._action("online")
	check(await wait_until(func(): return game.session.joined and game.remotes.size() == 1), "Rejoin failed")
	check(game.session.own_id != first_id, "Rejoin reused old session")
	game._action("disconnect")
	await get_tree().process_frame
	check(AudioServer.bus_count == base_buses, "Audio buses leaked on second leave")
	check(await wait_until(func(): return game.session.closing_sockets.is_empty()), "Second close handshake incomplete")
	game.ready_to_drive = false
	game.city_effects.set_process(false)
	game.sound.shutdown()
	report.failures = failures
	var file = FileAccess.open("user://multiplayer-features.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report))
	# Android log lines have a 4 KB limit; keep complete phase data in the file.
	print(("NATIVE_MULTIPLAYER_FEATURES_PASS " if failures.is_empty() else "NATIVE_MULTIPLAYER_FEATURES_FAILED ") + JSON.stringify({"checks": report.checks, "phases": report.phases.size(), "failures": failures}))
	game.queue_free()
	game = null
	await get_tree().process_frame
	await get_tree().create_timer(0.1).timeout
	get_tree().quit(0 if failures.is_empty() else 1)
