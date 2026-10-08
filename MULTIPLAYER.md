# DriveAtBaku — Real-Time Multiplayer Mode

This document describes the architecture, server setup, tunnel integration, and design decisions behind the real-time multiplayer mode for DriveAtBaku.

---

## 1. How It Works

### Architecture: Client-Authoritative with Server-Relay Snapshots
- **Single-player physics untouched**: Each client runs its local vehicle physics identically to single-player (120 Hz fixed timestep with Pacejka tire dynamics, suspension simulation, and BVH barrier collision).
- **Remote "Ghost" Cars**: Remote players are represented as visual-only models with no dynamic physics body pushing the local vehicle. This prevents physics rubber-banding and desync over variable tunnel latency.
- **Batched Snapshot Protocol**:
  - Each connected client transmits its vehicle state at 20 Hz (`NET_SEND_HZ = 20`) when moving, or 2 Hz keep-alive when stationary or hidden.
  - State packets include chassis position/rotation, linear and angular velocities, speedometer readout, inputs, headlight/brake light flags, and per-wheel contact/skid/smoke metrics (< 400 bytes per packet).
  - The relay server batches these states at 20 Hz (`SERVER_TICK_HZ = 20`) and broadcasts a single snapshot to each client containing only other players' states (never echoing a player's own state).
- **Interpolation & Extrapolation**:
  - Remote cars are rendered with a fixed interpolation buffer delay of 100 ms (`INTERP_DELAY_MS = 100`).
  - Position is smoothly lerped and quaternion is slerped between bracketing snapshot states.
  - Wheels smoothly lerp steering angles and advance rotational spin based on ground speed.
  - If a packet arrives with a delta > 20 m (such as when a player resets or recovers car), the car snaps immediately rather than sliding.
  - If network lag stalls incoming snapshots, remote cars linearly extrapolate using velocity up to 250 ms before freezing in place.
- **Visual Effects Replication**:
  - Rather than re-deriving tire slip and smoke on remote machines without physics, the owning driver's computed wheel contact point, skid flag, and smoke intensity are directly applied to an isolated tire effects particle and mark buffer instance per remote car.
  - Disposing a remote car cleanly unmounts its meshes and disposes all allocated GPU buffers.

---

## 2. Server & Cloudflare Tunnel Setup

Because the server runs on a home machine without static IP or port forwarding, and the game is served over HTTPS on Netlify / Vercel, connections must use secure WebSockets (`wss://`).

### Step 1: Start the Local Node.js Server
```bash
cd server
npm install
npm start
```
By default, the server listens on `http://localhost:8787`.
Verify health:
```bash
curl http://localhost:8787/health
# Output: {"ok":true,"players":0,"uptime":...}
```

### Step 2: Expose via Cloudflare Tunnel

#### Quick Tunnel (Temporary / Fast Testing)
```bash
cloudflared tunnel --url http://localhost:8787
```
`cloudflared` prints an HTTPS URL such as:
`https://random-words-1234.trycloudflare.com`

Replace `https://` with `wss://`:
`wss://random-words-1234.trycloudflare.com`

#### Named Tunnel (Stable Custom Domain)
```bash
cloudflared tunnel login
cloudflared tunnel create driveatbaku
```
Configure `~/.cloudflared/config.yml`:
```yaml
tunnel: driveatbaku
credentials-file: /path/to/credentials.json
ingress:
  - hostname: dab-mp.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
```
Route and run:
```bash
cloudflared tunnel route dns driveatbaku dab-mp.yourdomain.com
cloudflared tunnel run driveatbaku
```

---

## 3. Connecting to the Server

The client resolves the multiplayer server URL in this order:
1. **URL parameter**: `?server=wss://...` (or `ws://localhost:8787` for local dev). Visiting this once automatically saves it in `localStorage`.
2. **Local Storage**: `localStorage.getItem("dab_server_url")`.
3. **Static Configuration File**: `public/multiplayer-config.json` containing `{ "serverUrl": "wss://dab-mp.yourdomain.com" }`.
4. **Manual entry**: The "Advanced Settings" fold in the Multiplayer menu allows manual entry if none is configured.

---

## 4. Known Limitations & Design Trade-offs

1. **No Car-to-Car Collisions by Default (`REMOTE_CARS_COLLIDE = false`)**:
   - Remote cars are ghosts you can drive through. Over internet tunnels with 50–200 ms latency, reciprocal dynamic rigid-body collisions would cause jitter and rubber-banding.
2. **Static World Only**:
   - The circuit map and buildings are identical for all players. Dynamic props or AI traffic are not synchronized.
3. **Quick Tunnel URL Changes**:
   - Ephemeral quick tunnels (`cloudflared tunnel --url ...`) generate a new domain each restart. Players must update the server URL or access the game with the new `?server=wss://...` link. Using a named tunnel provides a permanent stable URL.
