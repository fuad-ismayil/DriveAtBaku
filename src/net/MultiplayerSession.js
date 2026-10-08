import { NetClient } from './NetClient.js';
import { RemotePlayer } from './RemotePlayer.js';
import { NET_SEND_INTERVAL_MS, SPAWN_POINTS, formatStatePayload } from './protocol.js';

export class MultiplayerSession {
  constructor(options) {
    this.scene = options.scene;
    this.localVehicle = options.localVehicle;
    this.baseAssetScene = options.baseAssetScene;
    this.camera = options.camera;
    this.onToast = options.onToast || console.log;

    this.client = new NetClient();
    this.remotes = new Map(); // id -> RemotePlayer
    this.ownId = null;
    this.ownColor = null;
    this.spawnIndex = 0;

    // Send loop state
    this.sendAccumulator = 0;
    this.seq = 0;
    this.lastLightHash = '';
    this.lastStateSentTime = 0;

    // UI elements
    this.hudRoot = null;
    this.hudDot = null;
    this.hudStatus = null;
    this.hudPing = null;
    this.hudCount = null;
    this.hudList = null;
    this.reconnectBanner = null;

    this._setupHUD();
    this._setupClientEvents();
  }

  static async start(options) {
    const session = new MultiplayerSession(options);
    session.client.connect(options.serverUrl, options.nick);
    return session;
  }

  _setupHUD() {
    // Inject HUD elements into existing document
    const container = document.createElement('div');
    container.id = 'mp-hud-overlay';
    container.className = 'mp-hud';
    container.innerHTML = `
      <div class="mp-status-bar">
        <span class="mp-dot connecting" id="mp-dot"></span>
        <span class="mp-status-text" id="mp-status">CONNECTING</span>
        <span class="mp-ping" id="mp-ping">-- ms</span>
        <button type="button" class="mp-players-toggle" id="mp-toggle" aria-expanded="false">
          <span id="mp-count">1 PLAYER</span> <i aria-hidden="true">▾</i>
        </button>
      </div>
      <div class="mp-player-list hidden" id="mp-list"></div>
      <div class="mp-banner hidden" id="mp-banner">Reconnecting to server…</div>
    `;

    document.body.appendChild(container);
    this.hudRoot = container;
    this.hudDot = container.querySelector('#mp-dot');
    this.hudStatus = container.querySelector('#mp-status');
    this.hudPing = container.querySelector('#mp-ping');
    this.hudCount = container.querySelector('#mp-count');
    this.hudList = container.querySelector('#mp-list');
    this.reconnectBanner = container.querySelector('#mp-banner');

    const toggle = container.querySelector('#mp-toggle');
    toggle.onclick = () => {
      const isHidden = this.hudList.classList.toggle('hidden');
      toggle.setAttribute('aria-expanded', String(!isHidden));
    };
  }

  _setupClientEvents() {
    this.client.onStatus = (status, detail) => {
      if (!this.hudDot) return;
      this.hudDot.className = `mp-dot ${status}`;
      if (status === 'connected') {
        this.hudStatus.textContent = 'CONNECTED';
        this.reconnectBanner.classList.add('hidden');
      } else if (status === 'reconnecting') {
        this.hudStatus.textContent = 'RECONNECTING';
        this.reconnectBanner.classList.remove('hidden');
        this.reconnectBanner.textContent = 'Reconnecting to server…';
      } else if (status === 'connecting') {
        this.hudStatus.textContent = 'CONNECTING';
        this.reconnectBanner.classList.remove('hidden');
        this.reconnectBanner.textContent = 'Connecting to server…';
      } else if (status === 'error') {
        this.hudStatus.textContent = 'OFFLINE';
        this.reconnectBanner.classList.remove('hidden');
        this.reconnectBanner.textContent = detail ? `Network error: ${detail}` : 'Connection error';
      } else {
        this.hudStatus.textContent = 'DISCONNECTED';
      }
    };

    this.client.onWelcome = data => {
      this.ownId = data.id;
      this.ownColor = data.color;
      this.spawnIndex = data.spawnIndex ?? 0;

      // Position local car at assigned grid spawn slot BEFORE driving
      const slot = SPAWN_POINTS[this.spawnIndex % SPAWN_POINTS.length];
      if (slot && this.localVehicle?.setWorldTransform) {
        this.localVehicle.setWorldTransform(slot.position, slot.heading);
      }

      // Tint local vehicle with assigned color
      if (this.localVehicle?.userData?.paintMaterials) {
        for (const mat of this.localVehicle.userData.paintMaterials) {
          mat.color.set(this.ownColor);
        }
      }

      // Populate existing remote players
      for (const p of data.players || []) {
        if (p.id !== this.ownId && !this.remotes.has(p.id)) {
          this._createRemote(p);
        }
      }

      this._updatePlayerListUI();
      this.onToast?.(`JOINED MULTIPLAYER (${data.players?.length + 1} DRIVERS)`);
    };

    this.client.onJoined = data => {
      const p = data.player;
      if (p && p.id !== this.ownId && !this.remotes.has(p.id)) {
        this._createRemote(p);
        this._updatePlayerListUI();
        this.onToast?.(`${p.nick.toUpperCase()} JOINED`);
      }
    };

    this.client.onLeft = data => {
      const id = data.id;
      if (this.remotes.has(id)) {
        const player = this.remotes.get(id);
        this.onToast?.(`${player.nick.toUpperCase()} LEFT`);
        player.dispose();
        this.remotes.delete(id);
        this._updatePlayerListUI();
      }
    };

    this.client.onSnapshot = data => {
      const serverTs = data.ts || Date.now();
      for (const [id, state] of Object.entries(data.states || {})) {
        if (id === this.ownId) continue;
        let remote = this.remotes.get(id);
        if (!remote) {
          // Player joined before we received a joined message
          remote = this._createRemote({ id, nick: 'Player', state });
        }
        remote.pushState(serverTs, state);
      }
    };
  }

  _createRemote(info) {
    const remote = new RemotePlayer(info, {
      scene: this.scene,
      baseAssetScene: this.baseAssetScene,
    });
    this.remotes.set(info.id, remote);
    return remote;
  }

  _updatePlayerListUI() {
    if (!this.hudCount || !this.hudList) return;
    const totalCount = 1 + this.remotes.size;
    this.hudCount.textContent = `${totalCount} ${totalCount === 1 ? 'PLAYER' : 'PLAYERS'}`;

    let html = `
      <div class="mp-player-item is-self">
        <span class="mp-color-dot" style="background-color: ${this.ownColor || '#e6194b'}"></span>
        <span class="mp-player-nick">${this.client.nick} (You)</span>
      </div>
    `;

    for (const remote of this.remotes.values()) {
      html += `
        <div class="mp-player-item">
          <span class="mp-color-dot" style="background-color: ${remote.color}"></span>
          <span class="mp-player-nick">${remote.nick}</span>
        </div>
      `;
    }
    this.hudList.innerHTML = html;
  }

  update(dt) {
    const now = performance.now();
    const serverTime = this.client.getServerTime();

    // 1. Gather and send local state
    if (this.localVehicle?.getNetState && this.client.status === 'connected') {
      const rawState = this.localVehicle.getNetState();
      const currentLightHash = `${rawState.li?.head}-${rawState.li?.brake}-${rawState.li?.rev}`;
      const lightsChanged = currentLightHash !== this.lastLightHash;

      // Rate limit send rate
      const sendInterval = document.hidden ? 500 : NET_SEND_INTERVAL_MS;
      this.sendAccumulator += dt * 1000;

      const speed = rawState.spd || 0;
      const isStationary = speed < 0.2;
      const forceKeepAlive = isStationary && (now - this.lastStateSentTime > 500);

      if (this.sendAccumulator >= sendInterval || lightsChanged || forceKeepAlive) {
        this.sendAccumulator = 0;
        this.seq++;
        this.lastLightHash = currentLightHash;
        this.lastStateSentTime = now;

        const payload = formatStatePayload(this.seq, now, rawState);
        this.client.sendState(payload);
      }
    }

    // 2. Update remote players (interpolation & effects)
    const cameraPos = this.camera?.position;
    for (const remote of this.remotes.values()) {
      remote.update(dt, serverTime, cameraPos);
    }

    // 3. Update HUD telemetry
    if (this.hudPing) {
      const rtt = this.client.getRTT();
      this.hudPing.textContent = rtt > 0 ? `${rtt} ms` : '-- ms';
    }
  }

  stop() {
    this.client.disconnect();
    for (const remote of this.remotes.values()) {
      remote.dispose();
    }
    this.remotes.clear();

    if (this.hudRoot) {
      this.hudRoot.remove();
      this.hudRoot = null;
    }
  }
}
