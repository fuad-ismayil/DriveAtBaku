# Multiplayer relay

A Node.js HTTP/WebSocket relay using `ws`. Static Netlify/Vercel deployments serve the client; run this service separately for multiplayer. See [the architecture guide](../docs/MULTIPLAYER.md) for replication and limits.

## Run locally

From the repository root:

```sh
npm ci --prefix server
npm start --prefix server
```

The default port is **8787**. Open `http://localhost:8787/health` for JSON containing `ok`, player count and uptime. With the client development server running, open `http://localhost:5173/?server=ws://localhost:8787` and choose Multiplayer.

| Variable | Purpose |
| --- | --- |
| `PORT` | Listening port; default 8787 |
| `ALLOWED_ORIGINS` | Additional comma-separated origins or hostnames |

The game domains, localhost/127.0.0.1 and `*.trycloudflare.com` are allowed by the existing origin policy. Clients without an Origin header are accepted. `ALLOWED_ORIGINS` extends this policy; it does not replace the built-in allowances or provide authentication.

The relay allows 32 players, broadcasts at 30 Hz, limits messages to 4096 bytes, rate-limits clients and sends heartbeat pings every 15 seconds. These limits are defined in `server.js`.

## Public connections

An HTTPS game page needs **secure WebSockets (`wss://`)**. Terminate TLS at a reverse proxy or tunnel forwarding to the local relay. The default client configuration is `public/multiplayer-config.json`; query parameters and saved settings take precedence.

For a temporary Cloudflare tunnel, install `cloudflared` separately and run:

```sh
cloudflared tunnel --url http://localhost:8787
```

Use the generated HTTPS hostname with the `wss://` scheme. Quick-tunnel addresses change on restart. For a stable domain, create a named tunnel:

```sh
cloudflared tunnel login
cloudflared tunnel create driveatbaku
cloudflared tunnel route dns driveatbaku relay.example.com
```

Configure your local Cloudflare tunnel file using the returned tunnel ID and credentials path:

```yaml
tunnel: <tunnel-id>
credentials-file: /path/to/credentials.json
ingress:
  - hostname: relay.example.com
    service: http://localhost:8787
  - service: http_status:404
```

Then run `cloudflared tunnel run driveatbaku`. Add the game host to `ALLOWED_ORIGINS` when using a different client domain. Tunnel credentials and machine-specific configuration stay outside Git.

## Verify a deployed relay after updating

Restart the deployed Node process after publishing `server/server.js` and its
shared imports from `src/`. An already-running Node process continues executing
the old code even if the files change. Keep the existing TLS/origin configuration.

From the repository root, inspect only a temporary diagnostic client's own state:

```sh
node android/tools/probe_relay.mjs wss://server.driveatbaku.games/
```

`indicatorsPreserved`, `engineStatePreserved` and `platesPreserved` must be
`true`, and the returned `li` must include `sig`,
`sigRev` and `sigAt`. Current welcome messages advertise
`vehicle-indicators-v1`, `license-plates-v1` and `vehicle-audio-v1`; protocol version remains 1.
The diagnostic disconnects after its own state is echoed and does not send chat.

The latest recorded 0.4 probe on 16 October 2026 preserves audio state,
indicators and plates on the public relay. Earlier probes on the same day
found missing indicator fields, then missing `au`; those are historical
deployment results. `au` carries optional protocol-1 engine state (`ld` load,
`sh` remaining shift seconds, `ac` acceleration). This relay validates and
forwards those fields plus optional wheel contact normals (`n`).

The public website still served the older client during that audit. Publish
the matching web client for complete Android/web audio reconstruction; the
relay does not need reinstalling when the current probe already passes. For
an older deployment, the portable bundle and diagnostic are documented in
[the Android relay guide](../docs/android/RELAY_UPDATE.md).

## Load test

Start a local relay first, then use a second terminal:

```sh
npm run loadtest --prefix server
```

The defaults are 10 clients for 10 seconds against `ws://localhost:8787`, sending synthetic states at 20 Hz. In PowerShell:

```powershell
$env:SERVER_URL = 'ws://localhost:8787'
$env:CLIENTS = '20'
$env:DURATION = '15'
npm run loadtest --prefix server
```

In POSIX shells, use `SERVER_URL=ws://localhost:8787 CLIENTS=20 DURATION=15 npm run loadtest --prefix server`. Successful runs report nonzero sent states/received snapshots and zero errors; connection errors or missing traffic cause a nonzero exit status.
