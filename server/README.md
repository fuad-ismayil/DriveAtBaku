# DriveAtBaku Multiplayer Server

Lightweight real-time relay server for DriveAtBaku using native Node.js and the `ws` WebSocket library.

## Quick Start (Local Server)

```bash
cd server
npm install
npm start
```

Default port is `8787`. You can verify that the server is alive by opening:
`http://localhost:8787/health`
Response: `{"ok":true,"players":0,"uptime":...}`

To test connecting locally in the browser:
Open `http://localhost:5173/?server=ws://localhost:8787` (when running `npm run dev` on the client).

---

## Exposing to the Internet via Cloudflare Tunnel

Since the game site is deployed over HTTPS (`https://driveatbaku.netlify.app` / `https://driveatbaku.vercel.app`), the browser requires secure WebSockets (`wss://`). Browsers will block unencrypted `ws://` on an HTTPS page.

Cloudflare Tunnel provides free HTTPS/WSS tunneling without port forwarding or a public static IP.

### Option A: Quick Tunnel (Ephemeral URL, no Cloudflare account needed)

Run in a separate terminal:
```bash
cloudflared tunnel --url http://localhost:8787
```

`cloudflared` will print a URL like:
```text
https://random-words-1234.trycloudflare.com
```

Change `https://` to `wss://`:
```text
wss://random-words-1234.trycloudflare.com
```

Share this URL or open the game once with:
```text
https://driveatbaku.netlify.app/?server=wss://random-words-1234.trycloudflare.com
```
The game will automatically save this server address in `localStorage` for future visits.

### Option B: Named Tunnel (Stable Custom Domain)

With your own domain on Cloudflare:
```bash
# 1. Login to Cloudflare
cloudflared tunnel login

# 2. Create named tunnel
cloudflared tunnel create driveatbaku

# 3. Create config.yml
# tunnel: <tunnel-uuid-or-name>
# credentials-file: /path/to/<uuid>.json
# ingress:
#   - hostname: dab-mp.yourdomain.com
#     service: http://localhost:8787
#   - service: http_status:404

# 4. Route DNS to your tunnel
cloudflared tunnel route dns driveatbaku dab-mp.yourdomain.com

# 5. Run tunnel
cloudflared tunnel run driveatbaku
```

Set `dab-mp.yourdomain.com` in `public/multiplayer-config.json`:
```json
{
  "serverUrl": "wss://dab-mp.yourdomain.com"
}
```
All users opening the game will connect to your stable server automatically without query parameters!

---

## Load Testing

To test server stability and snapshot throughput under load:

```bash
cd server
npm run loadtest
```
or customize:
```bash
CLIENTS=20 DURATION=15 npm run loadtest
```

---

## Protocol Overview

- **Port**: Single port (8787) handles both HTTP (`/health`) and WebSocket upgrades.
- **Tick rate**: 20 Hz snapshot broadcasts to all players (configurable `SERVER_TICK_HZ = 20`).
- **Heartbeat**: Ping/pong every 15s to keep Cloudflare tunnels alive (avoiding the 100s idle timeout).
- **Security & Limits**: Max 32 players, rate limiting, origin verification, and message size limits.
