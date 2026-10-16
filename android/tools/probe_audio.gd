extends SceneTree

func _initialize():
	var out = ProjectSettings.globalize_path("res://../../artifacts/android/audio-boundary")
	DirAccess.make_dir_recursive_absolute(out)
	for mode in ["old", "end_minus_one", "guard"]:
		var stream = AudioStreamWAV.new()
		stream.format = AudioStreamWAV.FORMAT_16_BITS
		stream.mix_rate = 44100
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_end = 257 - int(mode == "end_minus_one")
		var bytes = PackedByteArray()
		bytes.resize((257 + int(mode == "guard")) * 2)
		for i in bytes.size() / 2: bytes.encode_s16(i * 2, 8192)
		stream.data = bytes
		var playback = stream.instantiate_playback()
		playback.start()
		var frames = playback.mix_audio(1, 4096)
		var minimum = 1.0
		var maximum = -1.0
		for i in range(256, frames.size()):
			minimum = minf(minimum, frames[i].x)
			maximum = maxf(maximum, frames[i].x)
		print("BOUNDARY_CONSTANT " + JSON.stringify({"mode": mode, "min": minimum, "max": maximum}))
	for mode in ["old", "guard"]:
		var stream = load("res://assets/audio/car-rpm-0.wav").duplicate()
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_begin = 0
		stream.loop_end = stream.data.size() / (2 * (2 if stream.stereo else 1))
		if mode == "guard":
			var pcm: PackedByteArray = stream.data
			pcm.append_array(pcm.slice(0, 2 * (2 if stream.stereo else 1)))
			stream.data = pcm
		var playback = stream.instantiate_playback()
		playback.start()
		var frames = playback.mix_audio(900.0 / 950, 44100 * 8)
		var pcm = PackedByteArray()
		pcm.resize(frames.size() * 4)
		for i in frames.size():
			pcm.encode_s16(i * 4, roundi(clampf(frames[i].x, -1, 0.9999) * 32768))
			pcm.encode_s16(i * 4 + 2, roundi(clampf(frames[i].y, -1, 0.9999) * 32768))
		var recording = AudioStreamWAV.new()
		recording.format = AudioStreamWAV.FORMAT_16_BITS
		recording.stereo = true
		recording.mix_rate = 44100
		recording.data = pcm
		recording.save_to_wav(out.path_join(mode + ".wav"))
	quit()
