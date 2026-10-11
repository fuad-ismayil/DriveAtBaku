# Multiplayer architecture

The client simulates its own car at the same 120 Hz physics timestep used in single player. The Node.js relay forwards state; it does not simulate driving or resolve car-to-car collisions. Setup and deployment instructions live in [server/README.md](../server/README.md).

## Replication

`src/net/protocol.js` defines protocol version 1, a 30 Hz client send interval and a 120 ms interpolation buffer. The relay broadcasts snapshots at 30 Hz. Hidden clients reduce sends to a 500 ms interval.

Packets carry position, rotation, velocities, controls, lights and wheel/effect state. Vehicle selection, paint and plate settings are also replicated. Each snapshot excludes the recipient's own state. Remote cars interpolate received poses and use bounded extrapolation when updates arrive late; teleports reset interpolation history rather than sliding across the map.

`MultiplayerSession.js` owns session updates and remote players. `NetClient.js` handles transport and the handshake. `RemotePlayer.js` builds visual vehicles, smooths motion and manages remote audio/effects. Remote models reuse local asset loaders and dispose their own effects/resources when removed.

## Relay selection

The client resolves the address in this order:

1. The `?server=` URL parameter, saved in local storage.
2. The saved `dab_server_url` value.
3. `public/multiplayer-config.json` (currently the hosted relay).
4. Manual entry in the Multiplayer menu's advanced settings.

Use `ws://localhost:8787` for a local HTTP development page and `wss://` for HTTPS. Saved addresses can override later configuration-file changes; update the advanced setting or open a URL with the intended `?server=` value.

## Limits

- Remote cars are visual ghosts (`REMOTE_CARS_COLLIDE = false`). World collisions run locally for each driver.
- Driving state is client-authoritative. The relay sanitizes messages but is not a competitive anti-cheat or authoritative physics server.
- Weather and time-of-day settings are local preferences.
- AI traffic, shared dynamic props, vehicle damage and competitive race rules are not synchronized features.
- The relay caps simultaneous players at 32. Internet play depends on the separately operated server and network latency.

The browser cleanup suite can exercise two local clients with `CITY_MULTIPLAYER_TEST=1`; see [verification](VERIFICATION.md). The relay load test measures synthetic traffic and does not replace an actual two-player driving check.
