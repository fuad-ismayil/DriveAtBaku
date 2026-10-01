import { engineLayerGains, engineMixTargets } from './engineMix.js';

const ROOT = '/assets/audio/engines/';
export const ENGINE_BANKS = {
  ferrari: {
    idle: { file: 'car-rpm-0.wav', rpm: 950, level: 1.7 },
    on: [
      { file: 'car-rpm-1.wav', rpm: 1900, level: 1.18 },
      { file: 'car-rpm-3.wav', rpm: 4200 },
      { file: 'v8-load-5570.wav', rpm: 5570, level: 1.18 },
    ],
    off: [
      { file: 'car-rpm-2.wav', rpm: 2200 },
      { file: 'v8-overrun-5580.wav', rpm: 5580, level: 1.15 },
    ],
    character: { file: 'v8-load-5570.wav', rpm: 5570, level: 0.72 },
    brightness: 1.12,
    cutoffFloor: 1250,
  },
  elantra: {
    gain: 1.6,
    idle: { file: 'car-rpm-0.wav', rpm: 750, level: 1.45 },
    on: [
      { file: 'car-rpm-1.wav', rpm: 1500 },
      { file: 'car-rpm-3.wav', rpm: 3300 },
      { file: 'car-rpm-5.wav', rpm: 6000 },
    ],
    off: [
      { file: 'car-rpm-2.wav', rpm: 2100 },
      { file: 'car-rpm-4.wav', rpm: 4800 },
    ],
    brightness: 0.95,
    cutoffFloor: 1100,
  },
};

function smoothBuffer(context, original) {
  // Overlap the tail with the beginning so the wrap is sample-continuous.
  const overlap = Math.min(Math.floor(original.sampleRate * 0.045), Math.floor(original.length * 0.14));
  const length = original.length - overlap;
  const result = context.createBuffer(original.numberOfChannels, length, original.sampleRate);
  let peak = 0, sum = 0, count = 0;
  for (let channel = 0; channel < original.numberOfChannels; channel++) {
    const input = original.getChannelData(channel);
    const output = result.getChannelData(channel);
    let mean = 0;
    for (let i = 0; i < input.length; i++) mean += input[i];
    mean /= input.length;
    for (let i = 0; i < length; i++) {
      const t = i < overlap ? i / overlap : 1;
      const sample = i < overlap ? input[length + i] * (1 - t) + input[i] * t : input[i];
      output[i] = sample - mean;
      peak = Math.max(peak, Math.abs(output[i]));
      sum += output[i] * output[i];
      count++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(count, 1));
  const scale = Math.min(0.8 / Math.max(peak, 0.001), 0.17 / Math.max(rms, 0.001), 6);
  for (let channel = 0; channel < result.numberOfChannels; channel++) {
    const output = result.getChannelData(channel);
    for (let i = 0; i < output.length; i++) output[i] *= scale;
  }
  return result;
}

function noiseLayer(context, noise, type, frequency, q, destination) {
  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(destination);
  source.start();
  return { filter, gain };
}

export class EngineAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.volume = 0.32;
    this.lastGear = null;
    this.lastVehicle = null;
    this.mixLoad = 0.08;
    this.audioRpm = 0;
    this.banks = new Map();
    this.loadPromise = null;
  }

  async activate() {
    if (!this.context) this.createGraph();
    if (!this.context) return;
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.loadPromise) this.loadPromise = this.loadBanks().catch(error => {
      this.loadPromise = null;
      console.warn('Engine recordings could not be loaded', error);
    });
    await this.loadPromise;
  }

  createGraph() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    this.context = context;
    const master = context.createGain();
    master.gain.value = 0;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -13;
    compressor.knee.value = 15;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.22;
    master.connect(compressor).connect(context.destination);
    this.master = master;

    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    this.noiseBuffer = noise;
    this.wind = noiseLayer(context, noise, 'lowpass', 450, 0.6, master);
    this.skid = noiseLayer(context, noise, 'bandpass', 850, 3, master);

    const hornGain = context.createGain();
    hornGain.gain.value = 0;
    hornGain.connect(master);
    for (const hz of [420, 505]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = hz;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = hz * 2.6;
      filter.Q.value = 1.1;
      oscillator.connect(filter).connect(hornGain);
      oscillator.start();
    }
    this.horn = hornGain;
  }

  async loadBanks() {
    const context = this.context;
    const files = [...new Set(Object.values(ENGINE_BANKS).flatMap(bank => [bank.idle, ...bank.on, ...bank.off, bank.character].filter(Boolean).map(layer => layer.file)))];
    const decoded = new Map(await Promise.all(files.map(async file => {
      const response = await fetch(ROOT + file);
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      return [file, smoothBuffer(context, buffer)];
    })));
    for (const [id, config] of Object.entries(ENGINE_BANKS)) {
      const bus = context.createGain();
      bus.gain.value = 0;
      const tone = context.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1500;
      tone.Q.value = 0.52;
      bus.connect(tone).connect(this.master);
      const addLayer = (layer, index) => {
        const source = context.createBufferSource();
        source.buffer = decoded.get(layer.file);
        source.loop = true;
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain).connect(bus);
        source.start(0, (index * 0.173) % source.buffer.duration);
        return { ...layer, source, gain };
      };
      this.banks.set(id, {
        bus, tone, config,
        idle: addLayer(config.idle, 0),
        on: config.on.map((layer, index) => addLayer(layer, index + 1)),
        off: config.off.map((layer, index) => addLayer(layer, index + 7)),
        character: config.character ? addLayer(config.character, 12) : null,
      });
    }
  }

  shiftSound(level) {
    if (!this.context || !this.noiseBuffer) return;
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 550;
    filter.Q.value = 0.8;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now, Math.random() * 0.6, 0.14);
    source.stop(now + 0.15);
  }

  update(state, vehicle, playing, dt = 1 / 60) {
    if (!this.context || !state) return;
    const context = this.context, now = context.currentTime;
    const active = playing && this.enabled && context.state === 'running';
    const targets = engineMixTargets(state, vehicle);
    if (this.lastVehicle !== vehicle.id) {
      this.lastVehicle = vehicle.id;
      this.lastGear = state.gear;
      this.audioRpm = targets.rpm;
      this.mixLoad = targets.load;
    }
    this.audioRpm += (targets.rpm - this.audioRpm) * (1 - Math.exp(-25 * dt));
    this.mixLoad += (targets.load - this.mixLoad) * (1 - Math.exp(-(targets.shifting ? 18 : 9) * dt));

    for (const [id, bank] of this.banks) {
      const selected = id === vehicle.id;
      bank.bus.gain.setTargetAtTime(active && selected ? (vehicle.soundVol ?? 1) * 0.95 * (bank.config.gain ?? 1) : 0, now, selected ? 0.12 : 0.18);
      if (!selected) continue;
      bank.tone.frequency.setTargetAtTime(
        Math.max(bank.config.cutoffFloor, Math.min(6800, (420 + this.audioRpm * 0.4 + this.mixLoad * 1100) * bank.config.brightness)), now, 0.065,
      );
      const levels = engineLayerGains(bank.config, this.audioRpm, targets.idle, targets.running, this.mixLoad);
      bank.idle.gain.gain.setTargetAtTime(active ? levels.idle : 0, now, 0.07);
      bank.idle.source.playbackRate.setTargetAtTime(Math.max(0.75, Math.min(1.45, this.audioRpm / bank.idle.rpm)), now, 0.045);
      for (const [role, layers] of [['on', bank.on], ['off', bank.off]]) {
        layers.forEach((layer, index) => {
          layer.gain.gain.setTargetAtTime(active ? levels[role][index] : 0, now, 0.075);
          layer.source.playbackRate.setTargetAtTime(Math.max(0.62, Math.min(1.7, this.audioRpm / layer.rpm)), now, 0.045);
        });
      }
      if (bank.character) {
        const character = bank.character;
        const lowRpmFade = Math.max(0, Math.min(1, (5500 - this.audioRpm) / 1700));
        const presence = targets.running * (0.38 + 0.62 * this.mixLoad) * lowRpmFade;
        character.gain.gain.setTargetAtTime(active ? character.level * presence : 0, now, 0.09);
        character.source.playbackRate.setTargetAtTime(Math.max(0.45, Math.min(1.65, this.audioRpm / character.rpm)), now, 0.055);
      }
    }

    const speed = targets.speedKmh;
    this.wind.gain.gain.setTargetAtTime(active ? Math.min(0.13, 0.12 * (speed / 170) ** 2) : 0, now, 0.12);
    this.wind.filter.frequency.setTargetAtTime(260 + speed * 5, now, 0.1);
    const sliding = Math.max(...state.wheels.map(wheel => wheel.grounded ? Math.max(0, wheel.slideSpeed - 2.2) / 8 : 0));
    this.skid.gain.gain.setTargetAtTime(active ? Math.min(0.16, sliding * 0.14) : 0, now, 0.06);
    this.skid.filter.frequency.setTargetAtTime(770 + 400 * Math.min(sliding, 1), now, 0.08);
    this.horn.gain.setTargetAtTime(active && state.horn ? 0.2 : 0, now, 0.025);
    if (active && this.lastGear !== null && state.gear !== this.lastGear && state.gear > 1 && speed > 7) {
      this.shiftSound(0.014 * (vehicle.soundVol ?? 1));
    }
    this.lastGear = state.gear;
    this.master.gain.setTargetAtTime(active ? this.volume : 0, now, active ? 0.08 : 0.04);
  }

  setVolume(value) { this.volume = Math.max(0, Math.min(0.65, Number(value) || 0)); }
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled && this.context) this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.04);
  }
}
