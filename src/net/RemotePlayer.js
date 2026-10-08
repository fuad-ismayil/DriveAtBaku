import * as THREE from 'three';
import { createCarModel, setHeadlightBulbs } from '../carModel.js';
import { updateLicensePlates } from '../licensePlates.js';
import { createTireEffects } from '../tireEffects.js';
import { ENGINE_BANKS } from '../engineAudio.js';

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

    // Local reception timeline buffer: [ { localTime, state } ]
    this.buffer = [];
    this.maxBufferSize = 25;
    this.interpolationDelayMs = 95; // ~2 ticks at 20 Hz, smooth 60fps playback

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

    // Positional audio
    this.audioSource = null;
    this.audioGain = null;
    this.audioPanner = null;
    this.audioActive = false;

    this._initNameplate();
    this._initVehicle(this.carId);
    this._initAudio();

    if (info.state) {
      this.pushState(info.state);
    }
  }

  async _initVehicle(carId) {
    if (this.isLoadingVehicle) return;
    this.isLoadingVehicle = true;
    this.carId = carId;

    try {
      let newCar = null;
      if (typeof this.createVehicleModel === 'function') {
        newCar = await this.createVehicleModel(carId);
      }
      if (!newCar && this.baseAssetScene) {
        newCar = createCarModel({ scene: this.baseAssetScene.clone(true) });
      }

      if (!newCar) return;

      // Prevent local raycasters from testing against remote vehicle
      newCar.traverse(obj => {
        if (obj.isMesh) obj.raycast = () => {};
      });

      // Transfer position & rotation if replacing existing
      newCar.position.copy(this.currentPosition);
      newCar.quaternion.copy(this.currentQuaternion);

      // Setup private paint materials
      if (newCar.userData.paintMaterials) {
        const clonedMaterials = [];
        for (const mat of newCar.userData.paintMaterials) {
          const cloned = mat.clone();
          cloned.color.set(this.paintColor);
          clonedMaterials.push(cloned);
        }
        newCar.userData.paintMaterials = clonedMaterials;
        const bodyMesh = newCar.getObjectByName('body');
        if (bodyMesh && clonedMaterials[0]) bodyMesh.material = clonedMaterials[0];
      }

      // Setup spotlights
      const nose = 4.5 * 0.43;
      const lamps = [];
      for (const x of [-0.55, 0.55]) {
        const lamp = new THREE.SpotLight(0xe8f2ff, 0, 28, 0.42, 0.75, 1.35);
        lamp.position.set(x, nose, 0.6);
        lamp.castShadow = false;
        const target = new THREE.Object3D();
        target.position.set(x * 0.4, 22, 0.04);
        newCar.add(lamp, target);
        lamp.target = target;
        lamps.push(lamp);
      }

      // Apply initial license plate
      if (this.plateData) {
        updateLicensePlates(newCar, this.plateData);
      }

      // Swap out old car
      if (this.car) {
        this.scene.remove(this.car);
      }

      this.car = newCar;
      this.wheels = newCar.userData.wheels || [];
      this.headlights = lamps;
      this.scene.add(this.car);
    } catch (err) {
      console.error(`RemotePlayer: failed to create vehicle model for ${carId}:`, err);
    } finally {
      this.isLoadingVehicle = false;
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

      this.audioGain = gain;
      this.audioPanner = panner;
    } catch { /* Audio is progressive enhancement */ }
  }

  pushState(state) {
    if (!state) return;
    const now = performance.now();
    this.buffer.push({ localTime: now, state });
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // Check if vehicle model, color, or plate changed
    if (state.cid && state.cid !== this.carId) {
      this._initVehicle(state.cid);
    }
    if (state.col && state.col !== this.paintColor) {
      this.paintColor = state.col;
      for (const mat of this.car?.userData.paintMaterials || []) {
        mat.color.set(this.paintColor);
      }
    }
    if (state.plt && this.car) {
      this.plateData = state.plt;
      updateLicensePlates(this.car, state.plt);
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

    const now = performance.now();
    const renderTime = now - this.interpolationDelayMs;

    // Case 1: Only 1 state, or renderTime is before oldest received
    if (this.buffer.length === 1 || renderTime <= this.buffer[0].localTime) {
      const s = this.buffer[0].state;
      this._applyState(s, s, 0, dt);
      return;
    }

    const newest = this.buffer[this.buffer.length - 1];

    // Case 2: Network delay / packet loss — smoothly extrapolate with velocity
    if (renderTime > newest.localTime) {
      const pastSeconds = Math.min(0.35, (renderTime - newest.localTime) / 1000);
      const s = newest.state;
      const targetPos = new THREE.Vector3(s.p[0], s.p[1], s.p[2])
        .addScaledVector(new THREE.Vector3(s.v[0], s.v[1], s.v[2]), pastSeconds);
      const targetQuat = new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3]);

      // Smooth decay extrapolation
      this.currentPosition.lerp(targetPos, 0.45);
      this.currentQuaternion.slerp(targetQuat, 0.45);
      this.currentVelocity.set(s.v[0], s.v[1], s.v[2]);

      if (this.car) {
        this.car.position.copy(this.currentPosition);
        this.car.quaternion.copy(this.currentQuaternion);
        this._applyLights(s.li);
        this._applyWheels(s.w, s.spd, dt);
      }
      return;
    }

    // Case 3: Normal playback bracketed by two states
    let older = this.buffer[0];
    let newer = this.buffer[1];
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].localTime <= renderTime && this.buffer[i + 1].localTime >= renderTime) {
        older = this.buffer[i];
        newer = this.buffer[i + 1];
        break;
      }
    }

    const span = newer.localTime - older.localTime;
    const alpha = span > 0 ? (renderTime - older.localTime) / span : 0;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    this._applyState(older.state, newer.state, clampedAlpha, dt);
  }

  _applyState(s0, s1, alpha, dt) {
    const p0 = new THREE.Vector3(s0.p[0], s0.p[1], s0.p[2]);
    const p1 = new THREE.Vector3(s1.p[0], s1.p[1], s1.p[2]);
    const q0 = new THREE.Quaternion(s0.q[0], s0.q[1], s0.q[2], s0.q[3]);
    const q1 = new THREE.Quaternion(s1.q[0], s1.q[1], s1.q[2], s1.q[3]);

    // Teleport snap detection (> 20 meters)
    if (this.currentPosition.lengthSq() > 0 && this.currentPosition.distanceTo(p1) > 20) {
      this.currentPosition.copy(p1);
      this.currentQuaternion.copy(q1);
    } else {
      this.currentPosition.lerpVectors(p0, p1, alpha);
      this.currentQuaternion.slerpQuaternions(q0, q1, alpha);
    }

    this.currentVelocity.set(s1.v[0], s1.v[1], s1.v[2]);

    if (this.car) {
      this.car.position.copy(this.currentPosition);
      this.car.quaternion.copy(this.currentQuaternion);
      this._applyLights(s1.li);
      this._applyWheels(s1.w, s1.spd, dt, s0.w, alpha);
    }
  }

  _applyLights(li) {
    if (!li || !this.car) return;
    const headMode = li.head ?? 0;
    setHeadlightBulbs(this.car, headMode);

    for (const lamp of this.headlights) {
      lamp.intensity = headMode === 0 ? 0 : headMode === 1 ? 320 : 780;
      lamp.distance = headMode === 2 ? 72 : 22;
      lamp.angle = headMode === 2 ? 0.22 : 0.48;
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

  _applyWheels(wNew, speedKmh, dt, wOld = null, alpha = 0) {
    if (!wNew) return;

    const speedMs = (speedKmh || 0) / 3.6;
    this.wheelSpin = (this.wheelSpin + (speedMs / this.wheelRadius) * dt) % (Math.PI * 2);

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
        wheelRig.spinPivot.rotation.x = this.wheelSpin * (wheelRig.spinDirection ?? -1);
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
    if (!this.audioGain || !this.engineAudio?.context || this.engineAudio.context.state !== 'running') return;
    if (!camera) return;

    const ctx = this.engineAudio.context;
    const dist = this.currentPosition.distanceTo(camera.position);

    // Mute if far away (> 55 meters)
    if (dist > 55 || !this.engineAudio.enabled) {
      this.audioGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
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
    const distFactor = THREE.MathUtils.clamp(1 - dist / 55, 0, 1);
    const targetVolume = distFactor * distFactor * 0.22 * (this.engineAudio.volume ?? 0.32);
    this.audioGain.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.05);

    // Modulate pitch from RPM
    if (this.audioSource && this.buffer.length > 0) {
      const latest = this.buffer[this.buffer.length - 1].state;
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
    if (this.audioSource) {
      try { this.audioSource.stop(); this.audioSource.disconnect(); } catch { /* ignore */ }
    }
    if (this.audioGain) {
      try { this.audioGain.disconnect(); } catch { /* ignore */ }
    }
  }
}
