# Mobile interface roadmap

The loading screen and main menu are the next implementation milestone after
the remaining 0.4 plate illumination, idle loop boundary and bidirectional audio
fixes pass on the S9 and updated web client. Publish the matching web client so
public-room testing uses these fixes too. The preview retains the functional
menu and Leave Room action; this maintenance pass does not begin the redesign.

1. **Loading and navigation foundation.** Build the mobile startup/menu scenes
   and explicit loading, menu, single-player, connecting, multiplayer and pause
   states. Report real asset/scene preparation progress, show connection errors
   clearly, and animate transitions without blocking the game thread. Keep
   single-player startup independent of the relay.
2. **Main menu and supporting screens.** Adapt the web visual identity to a
   landscape phone: single-player, multiplayer, garage, settings and credits.
   Use safe-area-aware layouts, readable text and comfortable touch targets.
   Preserve existing saved vehicle, plate, graphics and driving preferences.
3. **In-game interface and controls.** Replace the preview toolbar/HUD with a
   restrained driving layout, clearer speed/gear/status displays and polished
   buttons/analog controls. Retain the verified input sampling, independent
   fingers, proportional pedals and steering response. Keep room departure
   accessible from the multiplayer status/pause area.
4. **Liquid Glass finishing pass.** Add translucent surfaces, restrained edge
   highlights, subtle refraction, motion and touch feedback. Measure the S9
   cost before enabling full-screen blur or repeated background captures; use
   simpler glass on the performance preset. Test small/large phones, Android
   Back, focus changes, reconnect and repeated navigation on the device.

Begin with the first two steps in the next UI development pass. Complete a
usable loading-to-menu-to-driving flow before expanding the cosmetic work.
Acceptance includes real loading feedback, no stuck overlays, no held inputs
after navigation, and clean single-player/multiplayer transitions. Calendar
estimates should follow the first mobile layout/performance prototype.
