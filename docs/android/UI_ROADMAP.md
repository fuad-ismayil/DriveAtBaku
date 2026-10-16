# Mobile interface follow-up

The 0.5 native interface implements the loading → menu → driving → pause flow,
garage, saved driving/graphics/atmosphere settings, multiplayer feedback,
credits and coffee support. See [the implementation and verification guide](MOBILE_INTERFACE.md).

Follow-up work:

- Measure sustained frame times, thermal behavior and screen-copy cost on a
  wider device range. The glass uses one shared scene capture and no full-screen
  blur pyramid; this is a bounded design choice, not a performance guarantee.
- Validate cutouts, system font fallback, keyboard insets and Android Back on
  more devices. Layout checks cover multiple aspect ratios; these do not replace
  physical testing across Android versions.
- Expand full-map and driving HUD presentation while retaining the verified
  independent touch sampling and steering/pedal response.
- Continue native world rendering parity separately: shadows, foliage,
  reflections and post-processing remain outside this interface pass.
