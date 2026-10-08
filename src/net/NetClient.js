import { PROTOCOL_VERSION } from './protocol.js';

export class NetClient {
  constructor() {
    this.ws = null;
    this.url = '';
    this.nick = '';
    this.status = 'disconnected'; // 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.shouldReconnect = true;

    // Clock sync
    this.rtt = 0;
    this.rttSamples = [];
    this.timeOffset = 0; // serverTime - localTime

    // Event callbacks
    this.onWelcome = null;
    this.onJoined = null;
    this.onLeft = null;
    this.onSnapshot = null;
    this.onChat = null;
    this.onStatus = null;
    this.onError = null;
  }

  setStatus(status, detail = '') {
    if (this.status !== status) {
      this.status = status;
      this.onStatus?.(status, detail);
    }
  }

  getRTT() {
    return Math.round(this.rtt);
  }

  getServerTime() {
    return Date.now() + this.timeOffset;
  }

  /**
   * Resolves server URL in order:
   * 1. URL search param (?server=...)
   * 2. localStorage ('dab_server_url')
   * 3. /multiplayer-config.json
   */
  static async resolveServerUrl() {
    // 1. Query parameter
    const params = new URLSearchParams(window.location.search);
    const queryServer = params.get('server');
    if (queryServer) {
      const normalized = NetClient.normalizeUrl(queryServer);
      try { localStorage.setItem('dab_server_url', normalized); } catch { /* ignore */ }
      return normalized;
    }

    // 2. localStorage
    try {
      const saved = localStorage.getItem('dab_server_url');
      if (saved) return NetClient.normalizeUrl(saved);
    } catch { /* ignore */ }

    // 3. /multiplayer-config.json
    try {
      const res = await fetch('/multiplayer-config.json', { cache: 'no-store' });
      if (res.ok) {
        const config = await res.json();
        if (config.serverUrl && typeof config.serverUrl === 'string' && config.serverUrl.trim()) {
          return NetClient.normalizeUrl(config.serverUrl.trim());
        }
      }
    } catch { /* ignore */ }

    // Fallback: if running on localhost dev, default to ws://localhost:8787
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'ws://localhost:8787';
    }

    return '';
  }

  static normalizeUrl(rawUrl) {
    let url = String(rawUrl || '').trim();
    if (!url) return '';
    // Strip trailing slash
    url = url.replace(/\/+$/, '');

    const isSecureOrigin = window.location.protocol === 'https:';
    if (url.startsWith('https://')) {
      url = 'wss://' + url.slice('https://'.length);
    } else if (url.startsWith('http://')) {
      url = isSecureOrigin ? 'wss://' + url.slice('http://'.length) : 'ws://' + url.slice('http://'.length);
    } else if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = (isSecureOrigin ? 'wss://' : 'ws://') + url;
    }
    return url;
  }

  connect(url, nick) {
    this.shouldReconnect = true;
    this.url = NetClient.normalizeUrl(url);
    this.nick = (nick || 'Player').slice(0, 16);
    this.reconnectAttempts = 0;
    this._initiateSocket();
  }

  _initiateSocket() {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);

    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }

    if (!this.url) {
      this.setStatus('error', 'No server URL configured');
      return;
    }

    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.setStatus('error', err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      // Send join message
      this.send({
        t: 'join',
        nick: this.nick,
        v: PROTOCOL_VERSION,
      });

      // Start ping interval every 20s
      this.pingTimer = setInterval(() => this.sendPing(), 20000);
      this.sendPing();
    };

    this.ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        this._handleMessage(msg);
      } catch (e) {
        console.warn('NetClient: malformed message received', e);
      }
    };

    this.ws.onclose = event => {
      clearInterval(this.pingTimer);
      console.log(`NetClient: connection closed (code: ${event.code})`);

      if (event.code === 4001) {
        this.shouldReconnect = false;
        this.setStatus('error', 'Protocol version mismatch. Please refresh.');
        this.onError?.('Protocol version mismatch');
        return;
      }
      if (event.code === 4002) {
        this.shouldReconnect = false;
        this.setStatus('error', 'Server is full (max 32 players).');
        this.onError?.('Server is full');
        return;
      }
      if (event.code === 4003) {
        this.shouldReconnect = false;
        this.setStatus('error', 'Connection rejected: origin not allowed.');
        this.onError?.('Origin not allowed');
        return;
      }

      if (this.shouldReconnect) {
        this._scheduleReconnect();
      } else {
        this.setStatus('disconnected');
      }
    };

    this.ws.onerror = () => {
      // onerror is always followed by onclose
    };
  }

  _scheduleReconnect() {
    this.setStatus('reconnecting');
    const delays = [1000, 2000, 4000, 8000, 15000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect) {
        this._initiateSocket();
      }
    }, delay);
  }

  _handleMessage(msg) {
    if (!msg || !msg.t) return;

    switch (msg.t) {
      case 'welcome':
        this.onWelcome?.(msg);
        break;
      case 'joined':
        this.onJoined?.(msg);
        break;
      case 'left':
        this.onLeft?.(msg);
        break;
      case 'snapshot':
        this.onSnapshot?.(msg);
        break;
      case 'pong': {
        const now = Date.now();
        const rtt = Math.max(0, performance.now() - (msg.ts || 0));
        this.rttSamples.push(rtt);
        if (this.rttSamples.length > 10) this.rttSamples.shift();
        this.rtt = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;

        // Estimated server time offset
        if (msg.serverTime) {
          const estimatedLocalReceive = now - (this.rtt / 2);
          this.timeOffset = msg.serverTime - estimatedLocalReceive;
        }
        break;
      }
      case 'chat':
        this.onChat?.(msg);
        break;
      case 'error':
        console.warn('Server error:', msg.code, msg.message);
        this.onError?.(msg.message || msg.code);
        break;
    }
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
  }

  sendState(stateObj) {
    this.send(stateObj);
  }

  sendPing() {
    this.send({
      t: 'ping',
      ts: performance.now(),
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}
