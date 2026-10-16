# Mobile interface follow-up

The 0.5 native interface implements the loading → menu → driving → pause flow,
garage, saved driving/graphics/atmosphere settings, multiplayer feedback,
credits and coffee support. See [the implementation and verification guide](MOBILE_INTERFACE.md).

The [0.6 polish pass](UI_POLISH_AND_SWITCHING.md) adds denser settings, readable
switches/sliders, safe-area-aware driving controls, grouped per-car plate
editing and front/rear inspection. Prepared cars, shader variants, recent plate
geometry and immutable audio loops are reused within explicit memory bounds.

The 0.7 HUD uses smaller top-left artwork, bottom-center instruments and
simulation-synchronized manual controls. Its city minimap expands to a
draggable, zoomable map; both views track live multiplayer drivers.

0.7.1 removes the instrument background, reduces the readout to 62 units tall,
uses a small circular minimap and tightens the edge buttons. Projection checks
verify that the HUD clears the body bounds of all four vehicles.

Follow-up work:

- Continue first-use resource/upload and renderer pipeline profiling on Android.
  Cached switching measurements do not establish cold-load or sustained FPS
  guarantees. Validate cache memory/thermal behavior in long multiplayer drives.

- Measure sustained frame times, thermal behavior and screen-copy cost on a
  wider device range. The glass uses one shared scene capture and no full-screen
  blur pyramid; this is a bounded design choice, not a performance guarantee.
- Validate cutouts, system font fallback, keyboard insets and Android Back on
  more devices. Layout checks cover multiple aspect ratios; these do not replace
  physical testing across Android versions.
- Validate map gestures and marker readability with larger live rooms on more
  physical devices, including interrupted/reconnecting sessions.
- Continue native world rendering parity separately: shadows, foliage,
  reflections and post-processing remain outside this interface pass.
