extends Node

signal welcomed(packet: Dictionary)
signal player_joined(player: Dictionary)
signal player_left(id: String)
signal snapshot_received(packet: Dictionary)
signal status_changed(message: String)

var socket = WebSocketPeer.new()
var own_id = ""
var active = false
var joined = false
var url = ""
var nickname = ""
var last_state = WebSocketPeer.STATE_CLOSED
var reconnect_at = 0.0
var reconnect_attempts = 0
var next_ping = 0.0
var server_epoch = 0.0
var clock_local = 0.0
var rtt = 0.0
var rtt_samples: Array = []
var status = "OFFLINE"
var sequence = 0
var send_accumulator = 0.0
var last_horn = false
var closing_sockets: Array[WebSocketPeer] = []

func milliseconds() -> float:
	return Time.get_ticks_usec() / 1000.0

func server_time() -> float:
	return server_epoch + milliseconds() - clock_local if server_epoch > 0 else Time.get_unix_time_from_system() * 1000

func connect_to_relay(address: String, nick: String):
	disconnect_from_relay()
	url = address.strip_edges().trim_suffix("/")
	if url.begins_with("https://"): url = "wss://" + url.substr(8)
	elif url.begins_with("http://"): url = "ws://" + url.substr(7)
	elif not url.begins_with("ws://") and not url.begins_with("wss://"): url = "wss://" + url
	nickname = nick.strip_edges().substr(0, 16)
	if nickname.is_empty(): nickname = "Player"
	active = true
	_open()

func _status(message: String):
	status = message
	status_changed.emit(message)

func _open():
	socket = WebSocketPeer.new()
	socket.inbound_buffer_size = 1048576
	socket.outbound_buffer_size = 262144
	joined = false
	own_id = ""
	last_state = WebSocketPeer.STATE_CLOSED
	var result = socket.connect_to_url(url)
	if result != OK:
		_retry()
		return
	_status("CONNECTING" if reconnect_attempts == 0 else "RECONNECTING")

func _retry():
	if not active: return
	joined = false
	reconnect_attempts += 1
	reconnect_at = milliseconds() + minf(15000, 1000 * pow(2, min(reconnect_attempts - 1, 4)))
	_status("RECONNECTING")

func disconnect_from_relay():
	active = false
	joined = false
	own_id = ""
	reconnect_at = 0
	reconnect_attempts = 0
	sequence = 0
	send_accumulator = 0
	last_horn = false
	rtt = 0
	rtt_samples.clear()
	server_epoch = 0
	if socket.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		socket.close(1000, "Leaving game")
		closing_sockets.append(socket)
	socket = WebSocketPeer.new()
	_status("OFFLINE")

func _process(_dt):
	# A close handshake still needs polling after the session is inactive.
	for closing in closing_sockets.duplicate():
		closing.poll()
		if closing.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			closing_sockets.erase(closing)
	if not active: return
	if reconnect_at > 0:
		if milliseconds() >= reconnect_at:
			reconnect_at = 0
			_open()
		return
	socket.poll()
	var state = socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if last_state != state:
			send({"t": "join", "nick": nickname, "v": 1})
			next_ping = 0
		if milliseconds() >= next_ping:
			send({"t": "ping", "ts": milliseconds()})
			next_ping = milliseconds() + 20000
		var budget = 64
		while socket.get_available_packet_count() > 0 and budget > 0:
			var text = socket.get_packet().get_string_from_utf8()
			var packet = JSON.parse_string(text)
			if packet is Dictionary: _message(packet)
			budget -= 1
	elif state == WebSocketPeer.STATE_CLOSED:
		var code = socket.get_close_code()
		if code in [4001, 4002, 4003]:
			active = false
			_status({4001: "PROTOCOL MISMATCH", 4002: "SERVER FULL", 4003: "CONNECTION REJECTED"}[code])
		else: _retry()
	last_state = state

func send(packet: Dictionary):
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN and socket.get_current_outbound_buffered_amount() < 65536:
		socket.send_text(JSON.stringify(packet))

func _message(packet: Dictionary):
	match packet.get("t", ""):
		"welcome":
			own_id = str(packet.id)
			server_epoch = float(packet.serverTime)
			clock_local = milliseconds()
			joined = true
			reconnect_attempts = 0
			_status("ONLINE")
			welcomed.emit(packet)
		"joined": player_joined.emit(packet.player)
		"left": player_left.emit(str(packet.id))
		"snapshot":
			var own = packet.get("states", {}).get(own_id, {})
			if not own.is_empty():
				var missing: Array[String] = []
				if own.get("li") is Dictionary and not own.li.has("sig"): missing.append("SIGNALS")
				if not own.get("au") is Dictionary: missing.append("ENGINE SYNC")
				var message = "ONLINE" if missing.is_empty() else "ONLINE · " + " / ".join(missing) + " UNAVAILABLE"
				if status != message:
					_status(message)
					if not missing.is_empty(): push_warning("The relay is stripping vehicle state; deploy the current server/server.js.")
			snapshot_received.emit(packet)
		"pong":
			var sample = maxf(0, milliseconds() - float(packet.get("ts", milliseconds())))
			rtt_samples.append(sample)
			if rtt_samples.size() > 10: rtt_samples.pop_front()
			rtt = 0
			for value in rtt_samples: rtt += value / rtt_samples.size()
			server_epoch = float(packet.get("serverTime", server_time())) + sample / 2
			clock_local = milliseconds()
		"error": _status(str(packet.get("message", "NETWORK ERROR")))

func send_vehicle(state: Dictionary, visual_position: Vector3, vehicle_id: String, headlights: int, indicator: Dictionary, dt: float, immediate = false):
	if not joined or state.is_empty(): return
	var horn_pressed = bool(state.get("horn", false))
	send_accumulator += dt
	if not immediate and horn_pressed == last_horn and send_accumulator < 1.0 / 30: return
	send_accumulator = fmod(send_accumulator, 1.0 / 30)
	sequence = (sequence + 1) & 0xffffffff
	var wheel_states: Array = []
	for wheel in state.wheels:
		var skidding = wheel.grounded and wheel.get("load", 0) >= 150 and wheel.get("normal", Vector3.UP).y >= 0.45 and wheel.get("surface_mu", 1) >= 0.9 and wheel.slip >= 2.5
		wheel_states.append({"st": snappedf(wheel.steer, 0.01), "rot": snappedf(wheel.spin, 0.01), "sl": snappedf(wheel.slip, 0.01), "sk": int(skidding), "sm": clampf((wheel.slip - 4.5) / 12, 0, 1) if skidding else 0, "c": int(wheel.grounded), "cp": wheel.contact if wheel.grounded else null, "n": [wheel.normal.x, -wheel.normal.z, wheel.normal.y] if wheel.grounded else null})
	var packet = {
		"t": "state", "seq": sequence, "ts": Time.get_unix_time_from_system() * 1000,
		"cid": vehicle_id, "col": Preferences.values.paint, "plt": Preferences.plate_settings(),
		"rpm": roundi(state.rpm), "gr": state.gear,
		"au": {"ld": state.get("engine_load", state.throttle), "sh": state.get("shift_timer", 0), "ac": state.get("acceleration", 0)},
		"p": [snappedf(visual_position.x, 0.001), snappedf(-visual_position.z, 0.001), snappedf(visual_position.y, 0.001)],
		"q": state.wire_rotation, "v": state.wire_velocity, "av": state.wire_angular_velocity,
		"spd": Vector2(state.velocity.x, state.velocity.z).length() * 3.6,
		"in": {"th": state.throttle, "br": state.brake, "st": state.steer, "hb": int(state.handbrake), "hn": int(state.horn), "rev": int(state.gear == 0)},
		"li": {"head": headlights, "brake": int(state.brake_force > 0.1 or state.handbrake), "rev": int(state.gear == 0), "sig": indicator.mode, "sigRev": indicator.revision, "sigAt": indicator.epoch},
		"w": wheel_states
	}
	send(packet)
	last_horn = horn_pressed
