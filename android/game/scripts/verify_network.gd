extends Node

var session = preload("res://scripts/multiplayer.gd").new()
var simulation
var start = 0.0
var received = false
var sent = 0
var phase = 0
var reconnect_time = 0
var first_id = ""
var signal_state = {"mode": "right", "revision": 1, "epoch": 0.0}

func _ready():
	add_child(session)
	simulation = ClassDB.instantiate("NativeDriving")
	simulation.reset(0, Vector3(681, 0, -479), 0.0, false)
	simulation.advance({"shift_up": true}, 1.0 / 120)
	var address = "ws://127.0.0.1:18787"
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--relay="): address = arg.substr(8)
	session.welcomed.connect(func(packet):
		signal_state.epoch = session.server_time()
		if phase == 0: first_id = session.own_id
		else:
			for player in packet.get("players", []):
				if str(player.id) == first_id:
					push_error("NATIVE_NETWORK_FAILED ghost after leave")
					get_tree().quit(1))
	session.snapshot_received.connect(_snapshot)
	session.connect_to_relay(address, "NativeQA")
	start = Time.get_ticks_msec()

func _process(dt):
	if Time.get_ticks_msec() - start > 15000:
		push_error("NATIVE_NETWORK_FAILED timeout: " + session.status)
		get_tree().quit(1)
		return
	if session.joined:
		var state = simulation.snapshot()
		session.send_vehicle(state, Vector3(681, 0, -479), "ferrari", 1, signal_state, dt)
		sent += 1
	if received and sent > 20:
		session.disconnect_from_relay()
		received = false
		sent = 0
		phase += 1
		reconnect_time = Time.get_ticks_msec() + 500
	if phase == 1 and not session.active and Time.get_ticks_msec() >= reconnect_time and session.closing_sockets.is_empty():
		session.connect_to_relay("ws://127.0.0.1:18787", "NativeQA")
	if phase == 2 and session.closing_sockets.is_empty():
		print("NATIVE_NETWORK_PASS protocol-v1, authoritative engine state, browser snapshots, clean leave, no ghost and rejoin")
		get_tree().quit()

func _snapshot(packet: Dictionary):
	for id in packet.get("states", {}):
		if id == session.own_id: continue
		var state = packet.states[id]
		if state.get("cid") == "elantra" and state.get("gr") == 3 and state.get("li", {}).get("sig") == "left":
			if state.get("p") is Array and state.p.size() == 3 and state.get("q") is Array and state.q.size() == 4:
				var audio = state.get("au", {})
				received = is_equal_approx(float(audio.get("ld", 0)), 0.72) and is_equal_approx(float(audio.get("sh", 0)), 0.1) and is_equal_approx(float(audio.get("ac", 0)), 6.0)
