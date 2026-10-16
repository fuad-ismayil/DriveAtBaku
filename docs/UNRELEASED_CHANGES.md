# v1.0.0 change review

Reviewed on 16 October 2026 against the latest prior commit, 62f3a26
(Polish Android UI, maps and vehicle switching; apply approved A1 branding).
This includes all tracked changes and new source files through the v1.0.0
release. The user approved publication of the native packages and updated Web
site. The [earlier review](history/ANDROID_0_7_2_REVIEW.md) preserves 0.7.2 history.

| Area | Result |
| --- | --- |
| Native Windows | Portable x64 release; Forward+ High/Ultra graphics, corrected foliage/clouds/night decorations, full monitor sizing, aspect/fullscreen/frame controls, isolated desktop preferences |
| Desktop UI | Web-style Windows menus and garage, no mobile toolbar, compact bottom-center text readout, visible pause cursor, keyboard focus and native Quit actions |
| Maps | Shared 176px desktop circles, corrected Web centering, camera-relative rotation, independent local/peer arrows, north-up pan/zoom/locate/fit full map; Android retains its mobile dimensions |
| Multiplayer | Shared plain white labels with no panel/team color; matching height, size, billboarding and distance fade; protocol and non-colliding peers preserved |
| Version/release | Shared v1.0.0 labels and package metadata; one release with Windows ZIP, Android APK and checksums; Web-only native download links |
| Mobile restriction | Download-only default HTML; early guard before display/loading/game imports; Android desktop-mode and iPad Mac identities, touch capability, no screen-width escape; iOS copy does not advertise an iOS app |
| Review fixes | Garage highlight retained on mouse interaction, registration camera uses fitted aspect bounds, version sync avoids needless file writes, old browser checks updated for new controls/presets |
| Repository hygiene | Generated native exports, APK/AAB/PCK files and signing stores ignored; Godot UID/source files retained; source line endings specified; release and platform documentation refreshed |
| CI | Existing unit/build/relay checks retained; pure device-policy/version tests added; production mobile matrix added for Chromium, Firefox and WebKit |

## Validation and scope

The release checks cover numeric driving/rendering invariants, local relay
traffic, asset/branding declarations, version metadata, native controls and
interface flows, rendered desktop cursor/map/quit behavior, and real exported
Windows four-car smoke tests. The mobile production matrix checks 27 phone/
tablet identities across three engines and repeated phone/landscape/tablet/4K
sizes: 81 cases plus JavaScript-disabled fallbacks. Network assertions reject
any attempted game request. These are simulated device identities in real
browser engines; they do not replace physical device coverage.

The current release review retains the previously measured Android/S9 results
at their original scope. No new phone installation or sustained performance
claim is inferred from desktop tests. The Android APK remains signed with the
existing development key. Seven texture RID warnings at native renderer
shutdown remain recorded; successful process exit does not prove the renderer
has no long-running memory issue.

See [Windows verification](../windows/VERIFICATION.md),
[mobile policy](MOBILE_DOWNLOAD_GATE.md), [release guide](RELEASE.md),
[asset credits](ASSET_CREDITS.md) and the current automated logs under ignored
artifacts/release-review/. No raw test logs, source-map conversion outputs,
SDKs, binaries, credentials or signing stores belong in the source commit.
