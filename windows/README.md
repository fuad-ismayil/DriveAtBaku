# DriveAtBaku for Windows

Native Godot 4.6.1 driving through Baku, with all four cars, offline play,
weather, night lighting and compatible multiplayer.

![Windows v1.0.0 driving with Forward+ graphics, circular minimap and compact instruments](https://raw.githubusercontent.com/fuad-ismayil/DriveAtBaku/main/docs/images/windows-gameplay-v1.0.0.webp)

*Windows Godot verification capture of the v1.0.0 source, 16 October 2026.
See the [gallery](https://github.com/fuad-ismayil/DriveAtBaku/blob/main/docs/SCREENSHOTS.md) for the native menu and Web comparison.*

## Play

Extract the entire ZIP, then open **DriveAtBaku.exe**. Keep the executable,
`DriveAtBaku.pck` and `driveatbaku.windows.x86_64.dll` together. Select a car
in Your garage and choose Start driving. Single player works offline.

The Windows build starts with High graphics at the window's native resolution.
The pause menu offers Performance, Balanced, High and Ultra,
rendering heights through 2160p, draw distance, fullscreen, vertical sync and
a frame limit. A rendering height is a maximum; smaller windows are never
supersampled. Native always follows the current window size.

High uses cascaded world shadows, ambient occlusion, temporal antialiasing,
screen-space reflections, a sharper local reflection capture and subtle glow.
Ultra adds screen-space indirect lighting, denser shadow/reflection detail and
volumetric haze. Rain and snow also get local haze on High. These are raster
rendering effects; screen-space reflections only include visible geometry and
use the local probe/sky for other directions.

Windows 10/11 x64 with a Vulkan or Direct3D 12 capable GPU is the intended
platform. Performance depends on your hardware and resolution. Lower the
quality or rendering height if needed. **Launch-Direct3D12.cmd** offers the
alternative graphics driver. **Launch-Compatibility.cmd** uses OpenGL for
older graphics hardware; advanced lighting effects are disabled automatically.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrow keys | Accelerate, brake and steer |
| Space | Handbrake |
| Mouse | Look around (captured while driving) |
| Middle mouse | Hold to look behind |
| C / R | Change camera / recover car |
| Esc / M | Pause / open map |
| T / Q / E / X | Gearbox mode / shift down / shift up / clutch |
| H / L | Horn / headlights |
| , / . / / | Left indicator / right indicator / hazards |
| 1 / 2 / 3 | ABS / traction / stability aids |
| Shift+R | Return to the start |
| F11 / Alt+Enter | Toggle fullscreen |

Windows uses the desktop interface and fills the current monitor by default.
The pause menu offers Auto, 16:9, 16:10, 21:9 and 4:3 aspect ratios. Selected
ratios fit inside the window without stretching or cropping. Windows settings
are saved separately from the Android preview. Click the circular minimap or
press M to pan, zoom, locate your car or fit the city. The desktop minimap is
176px across and follows the camera while arrows retain each car’s heading.
The pause cursor is released for menu use; resume captures it again. Quit game
is available from the main and pause menus. Downloads are offered on the Web.

## Build from this repository

Install Node.js and the repository dependencies, Godot 4.6.1 and its matching
Windows export templates, LLVM-MinGW, CMake 3.22+ and Ninja. The existing
Android SDK's bundled CMake/Ninja can also be used; building Windows does not
require Android SDK or Java when these tools are available separately.

From the repository root:

```powershell
.\windows\build.ps1
```

The script prepares shared native resources, builds the Windows driving
library, exports a release build, verifies controls/physics/menus/graphics
and creates `windows/build/DriveAtBaku-Windows-v1.0.0.zip`.
Use `-RebuildAssets` after changing original city or car assets.
Tool overrides: `-GodotBinary`, `-NativeCompiler`, `-CMakeBinary`, `-NinjaBinary`;
environment equivalents: `GODOT_BIN`, `DAB_CXX`, `DAB_CMAKE`, `DAB_NINJA`.
The repository's `android/setup_tools.ps1 -DownloadTemplates` supplies the
pinned LLVM-MinGW toolchain and matching Godot templates.

The shared editor project is `android/game/project.godot`. Windows defaults
to Forward+ while Android retains the Mobile renderer and phone defaults.
To capture desktop graphics and exercise the complete native game:

```powershell
& $env:GODOT_BIN --path android/game res://tests/desktop_graphics.tscn
```

Screenshots and the verification report are saved in `artifacts/windows/qa`.
Headless runs validate behavior but cannot verify rendered appearance.
Credits and asset licenses remain available from the in-game menu.
