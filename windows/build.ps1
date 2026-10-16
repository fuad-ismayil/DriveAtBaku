param(
    [string]$GodotBinary = $env:GODOT_BIN,
    [string]$NativeCompiler = $env:DAB_CXX,
    [string]$CMakeBinary = $env:DAB_CMAKE,
    [string]$NinjaBinary = $env:DAB_NINJA,
    [switch]$RebuildAssets,
    [switch]$SkipVerification
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = Join-Path $PSScriptRoot 'build\DriveAtBaku'
if (-not $GodotBinary) {
    $installed = Get-ChildItem -LiteralPath $env:ProgramFiles -Directory -Filter 'Godot*' | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -File -Filter '*console.exe'
    } | Select-Object -First 1
    if ($installed) { $GodotBinary = $installed.FullName }
}
if (-not $GodotBinary -or -not (Test-Path -LiteralPath $GodotBinary)) { throw 'Set -GodotBinary to the Godot 4.6.1 console executable.' }
Push-Location $repository
try {
    & (Join-Path $repository 'android\build.ps1') -Target Desktop -Release -DesktopOutput (Join-Path $destination 'DriveAtBaku.exe') -GodotBinary $GodotBinary -NativeCompiler $NativeCompiler -CMakeBinary $CMakeBinary -NinjaBinary $NinjaBinary -RebuildAssets:$RebuildAssets
    if (-not $SkipVerification) {
        foreach ($scene in @('controls', 'parity', 'interface', 'desktop_graphics', 'desktop_parity', 'quit')) {
            $output = & $GodotBinary --headless --path android/game "res://tests/$scene.tscn" 2>&1
            $exitCode = $LASTEXITCODE
            $output | Write-Output
            if ($exitCode -ne 0 -or ($output -match 'SCRIPT ERROR:|Parse Error:|ERROR:')) { throw "Windows verification failed: $scene" }
        }
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $destination 'README.md')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Launch-Compatibility.cmd') -Destination $destination
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Launch-Direct3D12.cmd') -Destination $destination
    $required = @('DriveAtBaku.exe', 'DriveAtBaku.pck', 'driveatbaku.windows.x86_64.dll')
    foreach ($file in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $destination $file))) { throw "Export is incomplete: $file" }
    }
    if (-not $SkipVerification) {
        $smokeLog = Join-Path $repository 'artifacts\windows\packaged-smoke.log'
        New-Item -ItemType Directory -Force (Split-Path $smokeLog) | Out-Null
        $process = Start-Process -FilePath (Join-Path $destination 'DriveAtBaku.exe') -WorkingDirectory $destination -ArgumentList @('--headless', '--log-file', ('"' + $smokeLog + '"'), '--', '--smoke-test') -WindowStyle Hidden -PassThru -Wait
        if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $smokeLog)) { throw "Packaged game failed to start (exit $($process.ExitCode))." }
        $smoke = Get-Content -LiteralPath $smokeLog -Raw
        if ($smoke -notmatch 'NATIVE_SMOKE_PASS' -or $smoke -match 'SCRIPT ERROR:|ERROR:') { throw 'Packaged game failed its four-vehicle driving check.' }
        Write-Output 'Packaged Windows game: all four vehicles passed.'
    }
    $releaseVersion = (Get-Content -LiteralPath (Join-Path $repository 'public/release.json') -Raw | ConvertFrom-Json).version
    $archive = Join-Path $PSScriptRoot "build\DriveAtBaku-Windows-v$releaseVersion.zip"
    Compress-Archive -Path $destination -DestinationPath $archive -Force
    Get-FileHash -LiteralPath $archive -Algorithm SHA256 | Format-List
    Write-Output "Windows game: $(Join-Path $destination 'DriveAtBaku.exe')"
    Write-Output "Portable ZIP: $archive"
} finally {
    Pop-Location
}
