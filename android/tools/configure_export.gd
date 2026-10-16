@tool
extends SceneTree

func _initialize():
	call_deferred("_configure")

func _configure():
	await process_frame
	while EditorInterface.get_resource_filesystem().is_scanning():
		await process_frame
	var args = OS.get_cmdline_user_args()
	if args.size() < 2:
		push_error("Provide Android SDK and Java SDK paths.")
		quit(1)
		return
	var settings = EditorInterface.get_editor_settings()
	settings.set_setting("export/android/android_sdk_path", args[0])
	settings.set_setting("export/android/java_sdk_path", args[1])
	print("Android export paths configured.")
	await process_frame
	quit()
