param(
    [ValidateSet('Prepare', 'Verify', 'Desktop', 'Android', 'All')]
    [string]$Target = 'Android',
    [string]$GodotBinary = $env:GODOT_BIN,
    [string]$AndroidSdk = $env:ANDROID_HOME,
    [string]$JavaSdk = $env:JAVA_HOME,
    [string]$NativeCompiler = $env:DAB_CXX,
    [string]$Device = '',
    [ValidateSet('Vulkan', 'OpenGL')]
    [string]$Renderer = 'Vulkan',
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$originalPath = $env:PATH
$originalGodotBinary = $env:GODOT_BIN
Push-Location $repository
try {
    function Invoke-Checked([string]$Program, [string[]]$Arguments) {
        $scriptFault = $false
        & $Program @Arguments 2>&1 | ForEach-Object {
            if ("$_" -match 'SCRIPT ERROR:|Parse Error:|Shader compilation failed') { $scriptFault = $true }
            Write-Output $_
        }
        if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
        if ($scriptFault) { throw "$Program reported a script or shader error despite returning exit code zero." }
    }
    if (-not $GodotBinary) {
        $installed = Get-ChildItem -LiteralPath $env:ProgramFiles -Directory -Filter 'Godot*' | ForEach-Object {
            Get-ChildItem -LiteralPath $_.FullName -File -Filter '*console.exe'
        } | Select-Object -First 1
        if ($installed) { $GodotBinary = $installed.FullName }
    }
    if (-not $GodotBinary -or -not (Test-Path -LiteralPath $GodotBinary)) { throw 'Set -GodotBinary to the Godot 4.6.1 console executable.' }
    if (-not $AndroidSdk) {
        foreach ($candidate in @((Join-Path $env:USERPROFILE 'Android\Sdk'), (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))) {
            if (Test-Path -LiteralPath $candidate) { $AndroidSdk = $candidate; break }
        }
    }
    if (-not $AndroidSdk -or -not (Test-Path -LiteralPath $AndroidSdk)) { throw 'Set -AndroidSdk / ANDROID_HOME to the Android SDK directory.' }
    if (-not $JavaSdk) {
        $javaCommand = Get-Command java -ErrorAction SilentlyContinue
        if ($javaCommand) { $JavaSdk = Split-Path (Split-Path $javaCommand.Source) }
    }
    if (-not $NativeCompiler) { $NativeCompiler = Join-Path $env:LOCALAPPDATA 'DriveAtBakuTools\llvm-mingw-20261006-ucrt-x86_64\bin\clang++.exe' }
    if (-not (Test-Path -LiteralPath $NativeCompiler)) { throw 'Set -NativeCompiler / DAB_CXX to an LLVM-MinGW clang++.exe, or run setup_tools.ps1.' }
    $NativeCompiler = $NativeCompiler.Replace('\', '/')
    $env:PATH = "$(Split-Path $NativeCompiler);$env:PATH"
    $cmakeRoot = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk 'cmake') -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $cmakeRoot) { throw 'Install CMake in the Android SDK.' }
    $cmake = Join-Path $cmakeRoot.FullName 'bin\cmake.exe'
    $ninja = (Join-Path $cmakeRoot.FullName 'bin\ninja.exe').Replace('\', '/')
    New-Item -ItemType Directory -Force 'artifacts\android', 'android\build' | Out-Null
    if (-not (Test-Path 'artifacts/android/godot-cpp/CMakeLists.txt')) {
        Invoke-Checked git @('clone', '--branch', '4.5', 'https://github.com/godotengine/godot-cpp.git', 'artifacts/android/godot-cpp')
        Invoke-Checked git @('-C', 'artifacts/android/godot-cpp', 'checkout', '--detach', '27d9dd23c83871e0619fca5dc2cddfbfd69e926a')
    }
    Invoke-Checked node @('android/tools/prepare_physics.mjs')
    if ($Target -in @('Prepare', 'All') -or -not (Test-Path 'android/game/assets/world/baku.glb')) {
        Invoke-Checked node @('android/tools/prepare_assets.mjs')
        Invoke-Checked node @('android/tools/prepare_vehicles.mjs')
        Invoke-Checked node @('android/tools/prepare_city_effects.mjs')
    }
    if (-not (Test-Path 'android/game/assets/world/rooms.bin')) { Invoke-Checked node @('android/tools/prepare_city_effects.mjs') }
    Invoke-Checked node @('android/tools/prepare_audio.mjs')
    Invoke-Checked node @('android/tools/prepare_water_shader.mjs')
    Invoke-Checked node @('android/tools/prepare_sky_shader.mjs')
    Invoke-Checked node @('android/tools/prepare_presentation_reference.mjs')
    Invoke-Checked $cmake @('-S', 'android/native', '-B', 'android/native/build-desktop', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', "-DCMAKE_CXX_COMPILER=$NativeCompiler", "-DCMAKE_MAKE_PROGRAM=$ninja", '-DCMAKE_SYSTEM_NAME=Windows', '-DCMAKE_SYSTEM_PROCESSOR=AMD64')
    Invoke-Checked $cmake @('--build', 'android/native/build-desktop', '-j', '8')
    Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', '--editor', '--import', '--quit')
    Invoke-Checked node @('android/tools/configure_imports.mjs')
    Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', '--editor', '--import', '--quit')
    if ($Target -in @('Verify', 'All')) {
        foreach ($test in @('simulation', 'world')) {
            Invoke-Checked $NativeCompiler @('-std=c++17', '-O2', '-ffp-contract=off', '-static', "android/native/verify_$test.cpp", 'android/native/third_party/fdlibm/ieee754.cpp', '-o', "artifacts/android/verify_$test.exe")
        }
        Invoke-Checked '.\artifacts\android\verify_simulation.exe' @('artifacts/android/physics-reference.bin')
        if (-not (Test-Path 'artifacts/android/world-reference.bin')) { Invoke-Checked node @('android/tools/prepare_assets.mjs', '--collisions-only') }
        Invoke-Checked '.\artifacts\android\verify_world.exe' @('android/game/assets/world/collisions.bin', 'artifacts/android/world-reference.bin')
        Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', 'res://tests/controls.tscn')
        Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', 'res://tests/parity.tscn')
        Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', 'res://tests/features.tscn')
        Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', 'res://tests/audio_plate.tscn')
        Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', '--', '--smoke-test')
        $env:GODOT_BIN = $GodotBinary
        Invoke-Checked node @('android/tools/verify_network.mjs')
    }
    if ($Target -in @('Desktop', 'All')) {
        Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', '--export-debug', 'Windows Preview', (Join-Path $repository 'android/build/DriveAtBaku-native.exe'))
    }
    if ($Target -in @('Android', 'All')) {
        $ndk = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk 'ndk') -Directory | Sort-Object Name -Descending | Select-Object -First 1
        if (-not $ndk) { throw 'Install an Android NDK (r27 or newer).' }
        $toolchain = (Join-Path $ndk.FullName 'build/cmake/android.toolchain.cmake').Replace('\', '/')
        Invoke-Checked $cmake @('-S', 'android/native', '-B', 'android/native/build-android', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', "-DCMAKE_TOOLCHAIN_FILE=$toolchain", "-DCMAKE_MAKE_PROGRAM=$ninja", '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-24', '-DANDROID_STL=c++_static')
        Invoke-Checked $cmake @('--build', 'android/native/build-android', '-j', '8')
        Invoke-Checked $GodotBinary @('--headless', '--editor', '--path', 'android/game', '--script', '../tools/configure_export.gd', '--', $AndroidSdk.Replace('\', '/'), $JavaSdk.Replace('\', '/'))
        $apk = Join-Path $repository $(if ($Renderer -eq 'Vulkan') { 'android/build/DriveAtBaku-native-debug.apk' } else { 'android/build/DriveAtBaku-native-opengl.apk' })
        $preset = if ($Renderer -eq 'Vulkan') { 'Android S9' } else { 'Android OpenGL Fallback' }
        Invoke-Checked $GodotBinary @('--headless', '--path', 'android/game', '--export-debug', $preset, $apk)
        if ($Install) {
            $adb = Join-Path $AndroidSdk 'platform-tools/adb.exe'
            $selector = @()
            if ($Device) { $selector = @('-s', $Device) }
            Invoke-Checked $adb ($selector + @('install', '-r', $apk))
            Invoke-Checked $adb ($selector + @('shell', 'am', 'start', '-n', 'games.driveatbaku.nativegame/com.godot.game.GodotAppLauncher'))
        }
        Write-Output "APK ready: $apk"
    }
} finally {
    $env:PATH = $originalPath
    $env:GODOT_BIN = $originalGodotBinary
    Pop-Location
}
