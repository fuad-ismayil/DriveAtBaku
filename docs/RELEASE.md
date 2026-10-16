# v1.0.0 release

The native packages and updated Web client were approved for publication on
16 October 2026. One GitHub release contains both native platforms:

- [Windows x64 ZIP](https://github.com/fuad-ismayil/DriveAtBaku/releases/download/v1.0.0/DriveAtBaku-Windows-v1.0.0.zip)
- [Android ARM64 APK](https://github.com/fuad-ismayil/DriveAtBaku/releases/download/v1.0.0/DriveAtBaku-Android-v1.0.0.apk)
- [SHA-256 checksums](https://github.com/fuad-ismayil/DriveAtBaku/releases/download/v1.0.0/SHA256SUMS.txt)

Extract the complete Windows folder and run DriveAtBaku.exe. The OpenGL and
Direct3D 12 launchers offer alternative rendering drivers. Android's APK uses
the existing development signing identity for continuity with preview installs;
this is an Android preview build, rather than a Play Store release. Installing
an update preserves preferences when the package ID and signing key match.
There is no iOS/iPadOS application.

## Building and versioning

The package.json version is the source of truth. The prebuild step and both
native builders run scripts/sync_release.mjs, which synchronizes the Web
manifest, shared metadata, Godot project version, Android version name/code
and native label. Minor and patch components are limited to 0–99 for the
major*10000 + minor*100 + patch Android code scheme. For v1.0.0 the code is
10000; Windows file/product metadata is 1.0.0.0.

Run the Android builder, then the Windows builder. The Windows release must
use a template_release GDExtension; a template_debug DLL is not compatible
with the release executable. windows/build.ps1 selects the correct target,
runs verification and checks the packaged executable with all four cars.

The versioned local outputs are windows/build/DriveAtBaku-Windows-v1.0.0.zip
and android/build/DriveAtBaku-Android-v1.0.0.apk. npm run stage-release hashes
both files into artifacts/releases/v1.0.0 and creates SHA256SUMS.txt. It does
not upload or publish anything. Exported binaries, keys, credentials, logs and
raw captures remain ignored; source, build scripts, UIDs and release metadata
are committed.

## Publishing and Web deployment

Publish both versioned native files and the checksum file under the same
v1.0.0 GitHub release, pointing at the reviewed source commit. Web Download
links use the repository's releases/latest page. The site main menu displays
the shared version and current map/HUD changes.

Production deployment is the existing Vercel Git integration for main. It
serves www.driveatbaku.games (through Cloudflare) and driveatbaku.vercel.app.
The Netlify configuration remains available as an alternative static host;
no new hosting project is required. The Web output is dist/. Multiplayer's
separately hosted relay is unaffected by static-site deployment.

Before publication, run the unit/build checks, desktop browser suite, native
checks and mobile production matrix. After deployment, verify release.json,
main-menu content, native links and zero game requests on the live mobile
page. See [verification](VERIFICATION.md) and the
[mobile restriction](MOBILE_DOWNLOAD_GATE.md).
