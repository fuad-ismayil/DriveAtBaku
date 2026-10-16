param([switch]$DownloadTemplates)
$ErrorActionPreference = 'Stop'
$cache = Join-Path $env:LOCALAPPDATA 'DriveAtBakuTools'
New-Item -ItemType Directory -Force $cache | Out-Null
$compiler = Join-Path $cache 'llvm-mingw-20261006-ucrt-x86_64\bin\clang++.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $archive = Join-Path $cache 'llvm-mingw.zip'
    Invoke-WebRequest 'https://github.com/mstorsjo/llvm-mingw/releases/download/20261006/llvm-mingw-20261006-ucrt-x86_64.zip' -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $cache -Force
}
if ($DownloadTemplates) {
    $destination = Join-Path $env:APPDATA 'Godot\export_templates\4.6.1.stable'
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'android_debug.apk'))) {
        $archive = Join-Path $cache 'godot-4.6.1-templates.tpz'
        if (-not (Test-Path -LiteralPath $archive)) {
            Invoke-WebRequest 'https://github.com/godotengine/godot/releases/download/4.6.1-stable/Godot_v4.6.1-stable_export_templates.tpz' -OutFile $archive
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            New-Item -ItemType Directory -Force $destination | Out-Null
            foreach ($entry in $zip.Entries) {
                if ($entry.Name -in @('android_debug.apk', 'android_release.apk', 'version.txt', 'windows_debug_x86_64.exe', 'windows_release_x86_64.exe')) {
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $destination $entry.Name), $true)
                }
            }
        } finally { $zip.Dispose() }
    }
}
Write-Output "Native compiler ready: $compiler"
