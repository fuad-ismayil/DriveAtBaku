import * as THREE from 'three';
import { createCarModel, setHeadlightBulbs } from '../carModel.js';
import { updateLicensePlates } from '../licensePlates.js';
import { createTireEffects } from '../tireEffects.js';
import { ENGINE_BANKS } from '../engineAudio.js';
import { INTERP_DELAY_MS } from './protocol.js';

export class RemotePlayer {
  constructor(info, options) {
    this.id = info.id;
    this.nick = info.nick || 'Player';
    this.color = info.color || '#e6194b';
    this.scene = options.scene;
    this.baseAssetScene = options.baseAssetScene;
    this.createVehicleModel = options.createVehicleModel;
    this.engineAudio = options.engineAudio;

    // Active vehicle state
    this.carId = info.state?.cid || 'ferrari';
    this.paintColor = info.state?.col || this.color;
    this.plateData = info.state?.plt || null;
    this.isLoadingVehicle = false;
    this.loadingCarId = null;
    this.pendingCarId = null;

    // Server-time timeline buffer: [ { timestamp, state } ]
    this.buffer = [];
    this.maxBufferSize = 32;
    this.interpolationDelayMs = INTERP_DELAY_MS;
    this.serverTimeOffsetMs = 0;

    // Visual model
    this.car = null;
    this.wheels = [];
    this.headlights = [];
    this.wheelSpin = 0;
    this.wheelRadius = 0.34;

    // Effects
    this.tireEffects = createTireEffects(this.scene);
    this.syntheticTireState = {
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      wheels: Array.from({ length: 4 }, () => ({
        grounded: false,
        contact: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 0, 1),
        steer: 0,
        load: 0,
        surfaceMu: 1,
        slideSpeed: 0,
      })),
    };

    // Nameplate sprite
    this.nameplate = null;
    this.nameplateTexture = null;

    // Transform state
    this.currentPosition = new THREE.Vector3();
    this.currentQuaternion = new THREE.Quaternion();
    this.currentVelocity = new THREE.Vector3();
    this._p0 = new THREE.Vector3();
    this._p1 = new THREE.Vector3();
    this._v0 = new THREE.Vector3();
    this._v1 = new THREE.Vector3();
    this._targetPosition = new THREE.Vector3();
    this._q0 = new THREE.Quaternion();
    this._q1 = new THREE.Quaternion();
    this._forward = new THREE.Vector3();

    // Positional audio
    this.audioSource = null;
    this.audioGain = null;
    this.audioPanner = null;
    this.audioActive = false;
    this.remoteHornGain = null;
    this.remoteHornOscillators = [];

    this._initNameplate();
    this._initVehicle(this.carId);
    this._initAudio();

    if (info.state) {
      this.pushState(info.state);
    }
  }

  async _initVehicle(carId) {
    // Do not let the previous car's loop continue while the replacement asset
    // is downloading. A new source is created from this player's new bank
    // after the model swap completes.
    if (carId !== this.carId) this._disposeAudioSource();
    this.pendingCarId = carId;
    if (this.isLoadingVehicle) return;
    this.isLoadingVehicle = true;

    try {
      while (this.pendingCarId) {
        const requestedCarId = this.pendingCarId;
        this.pendingCarId = null;
        this.loadingCarId = requestedCarId;

        let newCar = null;
        if (typeof this.createVehicleModel === 'function') {
          newCar = await this.createVehicleModel(requestedCarId);
        }
        if (!newCar && this.baseAssetScene) {
          newCar = createCarModel({ scene: this.baseAssetScene.clone(true) });
        }

        // A more recent state arrived while this asset was loading. Do not
        // briefly install a stale car (or its stale plate fitment).
        if (this.pendingCarId && this.pendingCarId !== requestedCarId) continue;
        if (!newCar) continue;

        // Prevent local raycasters from testing against remote vehicle.
        newCar.traverse(obj => {
          if (obj.isMesh) obj.raycast = () => {};
        });

        // Transfer position & rotation if replacing existing.
        newCar.position.copy(this.currentPosition);
        newCar.quaternion.copy(this.currentQuaternion);

        // Each remote needs private instances for every paint material. Some
        // models use the same paint on several meshes, so replacing just a
        // mesh named "body" left parts of a remote car sharing another
        // player's material state.
        const paintMaterials = newCar.userData.paintMaterials || [];
        const materialMap = new Map();
        for (const material of paintMaterials) {
          if (!materialMap.has(material)) {
            const cloned = material.clone();
            cloned.color.set(this.paintColor);
            materialMap.set(material, cloned);
          }
        }
        if (materialMap.size) {
          newCar.traverse(obj => {
            if (!obj.isMesh) return;
            if (Array.isArray(obj.material)) obj.material = obj.material.map(material => materialMap.get(material) || material);
            else obj.material = materialMap.get(obj.material) || obj.material;
          });
          newCar.userData.paintMaterials = paintMaterials.map(material => materialMap.get(material));
        }

        // Setup spotlights.
        const nose = 4.5 * 0.43;
        const lamps = [];
        for (const x of [-0.55, 0.55]) {
          const lamp = new THREE.SpotLight(0xfff1d6, 0, 34, 0.36, 0.62, 2);
          lamp.position.set(x, nose, 0.6);
          lamp.castShadow = false;
          const target = new THREE.Object3D();
          target.position.set(x * 0.4, 22, 0.04);
          newCar.add(lamp, target);
          lamp.target = target;
          lamps.push(lamp);
        }

        // Apply the most recent plate only after the final model is ready.
        // This avoids fitting a new registration to an obsolete model while a
        // vehicle-change request is still in flight.
        if (this.plateData) updateLicensePlates(newCar, this.plateData);

        if (this.car) this.scene.remove(this.car);
        this.car = newCar;
        this.carId = requestedCarId;
        this.wheels = newCar.userData.wheels || [];
        this.headlights = lamps;
        this.scene.add(this.car);
        this._disposeAudioSource();
      }
    } catch (err) {
      console.error(`RemotePlayer: failed to create vehicle model for ${carId}:`, err);
    } finally {
      this.loadingCarId = null;
      this.isLoadingVehicle = false;
      if (this.pendingCarId) this._initVehicle(this.pendingCarId);
    }
  }

  _initNameplate() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const pad = 8;
    ctx.fillStyle = 'rgba(17, 21, 24, 0.88)';
    ctx.beginPath();
    ctx.roundRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2, 28);
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(60, canvas.height / 2, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 50px "Space Grotesk", system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.nick, 100, canvas.height / 2);

    this.nameplateTexture = new THREE.CanvasTexture(canvas);
    this.nameplateTexture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: this.nameplateTexture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this.nameplate = new THREE.Sprite(spriteMaterial);
    this.nameplate.scale.set(2.4, 0.6, 1);
    this.nameplate.center.set(0.5, 0);
    this.scene.add(this.nameplate);
  }

  _initAudio() {
    if (this.audioGain) return;
    const ctx = this.engineAudio?.context;
    if (!ctx) return;

    try {
      const gain = ctx.createGain();
      gain.gain.value = 0;

      let panner = null;
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        gain.connect(panner).connect(this.engineAudio.master || ctx.destination);
      } else {
        gain.connect(this.engineAudio.master || ctx.destination);
      }

      const hornGain = ctx.createGain();
      hornGain.gain.value = 0;
      hornGain.connect(gain);
      for (const hz of [410, 492]) {
        const oscillator = ctx.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = hz;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = hz * 2.5;
        filter.Q.value = 1.15;
        oscillator.connect(filter).connect(hornGain);
        oscillator.start();
        this.remoteHornOscillators.push(oscillator);
      }
      this.audioGain = gain;
      this.audioPanner = panner;
      this.remoteHornGain = hornGain;
    } catch { /* Audio is progressive enhancement */ }
  }

  pushState(state, serverTime = Date.now(), serverTimeOffsetMs = 0) {
    if (!state) return;
    this.serverTimeOffsetMs = Number.isFinite(serverTimeOffsetMs) ? serverTimeOffsetMs : this.serverTimeOffsetMs;
    const last = this.buffer[this.buffer.length - 1];
    // Relay snapshots repeat the latest stationary state. Keeping just the
    // newest version avoids a flat receive-time staircase in the history.
    if (last && last.state.seq === state.seq) return;
    const timestamp = Number.isFinite(serverTime) ? serverTime : Date.now() + this.serverTimeOffsetMs;
    this.buffer.push({ timestamp: Math.max(timestamp, (last?.timestamp ?? -Infinity) + 0.001), state });
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // Check if vehicle model, color, or plate changed
    if (state.cid && state.cid !== this.carId && state.cid !== this.loadingCarId && state.cid !== this.pendingCarId) {
      this._initVehicle(state.cid);
    }
    if (state.col && state.col !== this.paintColor) {
      this.paintColor = state.col;
      for (const mat of this.car?.userData.paintMaterials || []) {
        mat.color.set(this.paintColor);
      }
    }
    if (state.plt) {
      this.plateData = state.plt;
      if (this.car) updateLicensePlates(this.car, state.plt);
    }
  }

  update(dt, camera) {
    this._interpolate(dt);
    this._updateEffects(dt);
    this._updateNameplate(camera?.position);
    this._updateAudio(camera);
  }

  _interpolate(dt) {
    if (this.buffer.length === 0) return;

    const renderTime = Date.now() + this.serverTimeOffsetMs - this.interpolationDelayMs;

    // Case 1: Only 1 state, or renderTime is before oldest received
    if (this.buffer.length === 1 || renderTime <= this.buffer[0].timestamp) {
      const s = this.buffer[0].state;
      this._applyState(s, s, 0, dt);
      return;
    }

    const newest = this.buffer[this.buffer.length - 1];

    // Case 2: Network delay / packet loss — smoothly extrapolate with velocity
    if (renderTime > newest.timestamp) {
      const pastSeconds = Math.min(0.18, (renderTime - newest.timestamp) / 1000);
      const s = newest.state;
      this._targetPosition.set(s.p[0], s.p[1], s.p[2]).addScaledVector(this._v1.set(s.v[0], s.v[1], s.v[2]), pastSeconds);
      this._q1.set(s.q[0], s.q[1], s.q[2], s.q[3]);

      // Smooth decay extrapolation
      this.currentPosition.lerp(this._targetPosition, 0.55);
      this.currentQuaternion.slerp(this._q1, 0.55);
      this.currentVelocity.set(s.v[0], s.v[1], s.v[2]);

      if (this.car) {
        this.car.position.copy(this.currentPosition);
        this.car.quaternion.copy(this.currentQuaternion);
        this._applyLights(s.li);
        this._applyWheels(s.w, dt);
      }
      return;
    }

    // Case 3: Normal playback bracketed by two states
    let older = this.buffer[0];
    let newer = this.buffer[1];
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].timestamp <= renderTime && this.buffer[i + 1].timestamp >= renderTime) {
        older = this.buffer[i];
        newer = this.buffer[i + 1];
        break;
      }
    }

    const span = newer.timestamp - older.timestamp;
    const alpha = span > 0 ? (renderTime - older.timestamp) / span : 0;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    this._applyState(older.state, newer.state, clampedAlpha, dt, span / 1000);
  }

  _applyState(s0, s1, alpha, dt, spanSeconds = 0) {
    const p0 = this._p0.set(s0.p[0], s0.p[1], s0.p[2]);
    const p1 = this._p1.set(s1.p[0], s1.p[1], s1.p[2]);
    const q0 = this._q0.set(s0.q[0], s0.q[1], s0.q[2], s0.q[3]);
    const q1 = this._q1.set(s1.q[0], s1.q[1], s1.q[2], s1.q[3]);

    // Teleport snap detection (> 20 meters)
    if (this.currentPosition.lengthSq() > 0 && this.currentPosition.distanceTo(p1) > 20) {
      this.currentPosition.copy(p1);
      this.currentQuaternion.copy(q1);
    } else {
      // Cubic Hermite interpolation honours the velocities supplied by the
      // authoritative driver and prevents the back-and-forth motion visible
      // when fast cars are sampled only at relay tick boundaries.
      const t = alpha, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      this._v0.set(s0.v[0], s0.v[1], s0.v[2]);
      this._v1.set(s1.v[0], s1.v[1], s1.v[2]);
      this.currentPosition.copy(p0).multiplyScalar(h00)
        .addScaledVector(this._v0, h10 * spanSeconds)
        .addScaledVector(p1, h01)
        .addScaledVector(this._v1, h11 * spanSeconds);
      this.currentQuaternion.slerpQuaternions(q0, q1, alpha);
    }

    this.currentVelocity.set(s1.v[0], s1.v[1], s1.v[2]);

    if (this.car) {
      this.car.position.copy(this.currentPosition);
      this.car.quaternion.copy(this.currentQuaternion);
      this._applyLights(s1.li);
      this._applyWheels(s1.w, dt, s0.w, alpha);
    }
  }

  _applyLights(li) {
    if (!li || !this.car) return;
    const headMode = li.head ?? 0;
    setHeadlightBulbs(this.car, headMode);

    for (const lamp of this.headlights) {
      lamp.intensity = headMode === 0 ? 0 : headMode === 1 ? 172.5 : 585;
      lamp.distance = headMode === 2 ? 68 : 30;
      lamp.angle = headMode === 2 ? 0.24 : 0.36;
      lamp.penumbra = headMode === 2 ? 0.52 : 0.62;
      lamp.decay = 2;
    }

    const isBraking = Boolean(li.brake);
    const brakes = this.car.userData.brakeLights;
    for (const mat of Array.isArray(brakes) ? brakes : brakes ? [brakes] : []) {
      mat.emissiveIntensity = isBraking ? 3.6 : 0.3;
    }

    const isReverse = Boolean(li.rev);
    for (const mat of this.car.userData.reverseLightMaterials ?? []) {
      if (mat.userData.reverseLightLevel) {
        mat.userData.reverseLightLevel.value = isReverse ? 1 : 0;
      } else {
        mat.emissiveIntensity = isReverse ? 2.5 : 0;
      }
    }
  }

  _applyWheels(wNew, dt, wOld = null, alpha = 0) {
    if (!wNew) return;
    this._forward.set(0, 1, 0).applyQuaternion(this.currentQuaternion);
    const signedSpeed = this.currentVelocity.dot(this._forward);
    this.wheelSpin += signedSpeed / this.wheelRadius * dt;

    for (let i = 0; i < Math.min(this.wheels.length, wNew.length); i++) {
      const wheelRig = this.wheels[i];
      const wheelData = wNew[i];
      if (!wheelRig || !wheelData) continue;

      let steerAngle = wheelData.st || 0;
      if (wOld && wOld[i]) {
        steerAngle = THREE.MathUtils.lerp(wOld[i].st || 0, wheelData.st || 0, alpha);
      }

      if (wheelRig.front && wheelRig.steerPivot) {
        wheelRig.steerPivot.rotation.y = steerAngle;
      }
      if (wheelRig.spinPivot) {
        const oldRotation = wOld?.[i]?.rot;
        const newRotation = wheelData.rot;
        const rotation = Number.isFinite(oldRotation) && Number.isFinite(newRotation)
          ? THREE.MathUtils.lerp(oldRotation, newRotation, alpha) : this.wheelSpin;
        wheelRig.spinPivot.rotation.x = rotation * (wheelRig.spinDirection ?? -1);
      }
    }
  }

  _updateEffects(dt) {
    if (this.buffer.length === 0) return;
    const latestState = this.buffer[this.buffer.length - 1].state;
    if (!latestState || !latestState.w) return;

    this.syntheticTireState.quaternion.copy(this.currentQuaternion);
    this.syntheticTireState.velocity.copy(this.currentVelocity);

    for (let i = 0; i < 4; i++) {
      const wNet = latestState.w[i];
      const wSynth = this.syntheticTireState.wheels[i];
      if (!wNet || !wSynth) continue;

      wSynth.grounded = Boolean(wNet.c);
      if (wNet.cp) {
        wSynth.contact.set(wNet.cp[0], wNet.cp[1], wNet.cp[2]);
      } else {
        wSynth.contact.copy(this.currentPosition);
      }
      wSynth.steer = wNet.st || 0;
      wSynth.load = wNet.sk ? 220 : 0;
      wSynth.surfaceMu = 1.0;
      wSynth.slideSpeed = wNet.sk ? (2.8 + (wNet.sl || 0)) : (wNet.sm > 0 ? 5.2 : 0);
    }

    this.tireEffects.update(dt, this.syntheticTireState, { wheelWidth: 0.28 }, { wet: 0, snow: 0 }, true, true);
  }

  _updateNameplate(cameraPosition) {
    if (!this.nameplate) return;

    this.nameplate.position.copy(this.currentPosition);
    this.nameplate.position.z += 2.1;

    if (cameraPosition) {
      const dist = this.currentPosition.distanceTo(cameraPosition);
      this.nameplate.visible = dist < 150;
    }
  }

  _updateAudio(camera) {
    // The multiplayer session may be created before the user gesture that
    // starts Web Audio. Initialise lazily so remote engines still get a
    // dedicated graph once audio becomes available.
    this._initAudio();
    if (!this.audioGain || !this.engineAudio?.context || this.engineAudio.context.state !== 'running') return;
    if (!camera) return;

    const ctx = this.engineAudio.context;
    const dist = this.currentPosition.distanceTo(camera.position);

    // Remote engines and horns use the same spatial envelope.  The old gain
    // was multiplied by master volume twice, making nearby cars nearly silent.
    if (dist > 105 || !this.engineAudio.enabled) {
      this.audioGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      this.remoteHornGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
      return;
    }

    // Lazy start engine audio source if needed
    if (!this.audioActive) {
      try {
        const bank = this.engineAudio.banks?.get(this.carId) || this.engineAudio.banks?.get('ferrari');
        const buffer = bank?.idle?.source?.buffer || bank?.on?.[0]?.source?.buffer;
        if (buffer) {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.loop = true;
          src.connect(this.audioGain);
          src.start();
          this.audioSource = src;
          this.audioActive = true;
        }
      } catch { /* ignore */ }
    }

    // Attenuation with distance
    const distFactor = THREE.MathUtils.smoothstep(105, 5, dist);
    const targetVolume = 0.42 * distFactor * distFactor;
    this.audioGain.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.05);
    const latest = this.buffer[this.buffer.length - 1]?.state;
    this.remoteHornGain?.gain.setTargetAtTime(latest?.in?.hn ? 0.38 * distFactor : 0, ctx.currentTime, 0.02);

    // Modulate pitch from RPM
    if (this.audioSource && this.buffer.length > 0) {
      const rpm = latest.rpm || 900;
      const bankConfig = ENGINE_BANKS[this.carId] || ENGINE_BANKS.ferrari;
      const baseRpm = bankConfig.idle?.rpm || 950;
      const rate = THREE.MathUtils.clamp(rpm / baseRpm, 0.65, 2.8);
      this.audioSource.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.04);
    }

    // Pan based on camera-relative position
    if (this.audioPanner) {
      const toCar = this.currentPosition.clone().sub(camera.position);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const pan = THREE.MathUtils.clamp(toCar.dot(right) / 25, -1, 1);
      this.audioPanner.pan.setTargetAtTime(pan, ctx.currentTime, 0.06);
    }
  }

  dispose() {
    if (this.car) this.car.removeFromParent();
    if (this.nameplate) {
      this.nameplate.removeFromParent();
      this.nameplate.material.dispose();
      this.nameplateTexture?.dispose();
    }
    this.tireEffects?.dispose();
    this._disposeAudioSource();
    for (const oscillator of this.remoteHornOscillators) {
      try { oscillator.stop(); oscillator.disconnect(); } catch { /* ignore */ }
    }
    this.remoteHornOscillators.length = 0;
    if (this.remoteHornGain) {
      try { this.remoteHornGain.disconnect(); } catch { /* ignore */ }
      this.remoteHornGain = null;
    }
    if (this.audioGain) {
      try { this.audioGain.disconnect(); } catch { /* ignore */ }
    }
  }

  _disposeAudioSource() {
    if (this.audioSource) {
      try { this.audioSource.stop(); this.audioSource.disconnect(); } catch { /* ignore */ }
    }
    this.audioSource = null;
    this.audioActive = false;
  }
}
