import * as THREE from 'three';
import { createCarModel, setHeadlightBulbs } from '../carModel.js';
import { createTireEffects } from '../tireEffects.js';
import { INTERP_DELAY_MS } from './protocol.js';

export class RemotePlayer {
  constructor(info, options) {
    this.id = info.id;
    this.nick = info.nick || 'Player';
    this.color = info.color || '#e6194b';
    this.scene = options.scene;
    this.baseAssetScene = options.baseAssetScene;

    // Buffer of received states: [ { tServer, state } ]
    this.buffer = [];
    this.maxBufferSize = 30;

    // Visual model
    this.car = null;
    this.wheels = [];
    this.headlights = [];
    this.brakeMaterials = [];
    this.reverseMaterials = [];
    this.paintMaterials = [];
    this.wheelSpin = 0;
    this.wheelRadius = 0.34; // standard sports car wheel radius

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

    // Extrapolation & stall state
    this.lastRenderTime = 0;
    this.currentPosition = new THREE.Vector3();
    this.currentQuaternion = new THREE.Quaternion();
    this.currentVelocity = new THREE.Vector3();

    this._initVisual();
    this._initNameplate();

    if (info.state) {
      this.pushState(Date.now(), info.state);
    }
  }

  _initVisual() {
    try {
      // Clone the raw base car hierarchy so we get independent meshes & materials
      const clonedScene = this.baseAssetScene.clone(true);
      this.car = createCarModel({ scene: clonedScene });

      // Prevent local raycasters (ground, collision) from interacting with remote car
      this.car.traverse(obj => {
        if (obj.isMesh) {
          obj.raycast = () => {};
        }
      });

      // Tint body paint with player's assigned color
      if (this.car.userData.paintMaterials) {
        for (const mat of this.car.userData.paintMaterials) {
          // Clone material so it's strictly private to this remote player
          const clonedMat = mat.clone();
          clonedMat.color.set(this.color);
          this.paintMaterials.push(clonedMat);
        }
        // Apply cloned paint material to body mesh
        const bodyMesh = this.car.getObjectByName('body');
        if (bodyMesh && this.paintMaterials.length > 0) {
          bodyMesh.material = this.paintMaterials[0];
        }
      }

      // Add remote spotlights
      const nose = 4.5 * 0.43;
      for (const x of [-0.55, 0.55]) {
        const lamp = new THREE.SpotLight(0xe8f2ff, 0, 28, 0.42, 0.75, 1.35);
        lamp.position.set(x, nose, 0.6);
        lamp.castShadow = false;
        const target = new THREE.Object3D();
        target.position.set(x * 0.4, 22, 0.04);
        this.car.add(lamp, target);
        lamp.target = target;
        this.headlights.push(lamp);
      }

      this.wheels = this.car.userData.wheels || [];
      this.scene.add(this.car);
    } catch (err) {
      console.error('Failed to create visual for remote player:', err);
    }
  }

  _initNameplate() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Background pill
    const pad = 8;
    ctx.fillStyle = 'rgba(17, 21, 24, 0.88)';
    ctx.beginPath();
    ctx.roundRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2, 28);
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();

    // Color dot
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(60, canvas.height / 2, 20, 0, Math.PI * 2);
    ctx.fill();

    // Text
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
    this.nameplate.center.set(0.5, 0); // bottom-centered
    this.scene.add(this.nameplate);
  }

  pushState(tServer, state) {
    if (!state) return;
    this.buffer.push({ tServer, state });
    // Keep buffer sorted by timestamp
    this.buffer.sort((a, b) => a.tServer - b.tServer);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  update(dt, serverTimeEstimate, cameraPosition) {
    if (!this.car) return;

    const renderTime = serverTimeEstimate - INTERP_DELAY_MS;
    this._interpolate(renderTime, dt);
    this._updateEffects(dt);
    this._updateNameplate(cameraPosition);
  }

  _interpolate(renderTime, dt) {
    if (this.buffer.length === 0) return;

    // If only one state or renderTime is older than our oldest state
    if (this.buffer.length === 1 || renderTime <= this.buffer[0].tServer) {
      const s = this.buffer[0].state;
      this._applyState(s, s, 0, dt);
      return;
    }

    const newest = this.buffer[this.buffer.length - 1];

    // Check if we need to extrapolate past the newest packet
    if (renderTime > newest.tServer) {
      const overTime = (renderTime - newest.tServer) / 1000;
      if (overTime < 0.25) {
        // Extrapolate linearly using velocity
        const s = newest.state;
        const targetPos = new THREE.Vector3(s.p[0], s.p[1], s.p[2])
          .addScaledVector(new THREE.Vector3(s.v[0], s.v[1], s.v[2]), overTime);
        this.currentPosition.copy(targetPos);
        this.currentQuaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
        this.car.position.copy(this.currentPosition);
        this.car.quaternion.copy(this.currentQuaternion);
        this._applyLights(s.li);
        this._applyWheels(s.w, s.spd, dt);
      }
      return;
    }

    // Find bracketing states
    let older = this.buffer[0];
    let newer = this.buffer[1];
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].tServer <= renderTime && this.buffer[i + 1].tServer >= renderTime) {
        older = this.buffer[i];
        newer = this.buffer[i + 1];
        break;
      }
    }

    const span = newer.tServer - older.tServer;
    const alpha = span > 0 ? (renderTime - older.tServer) / span : 0;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    this._applyState(older.state, newer.state, clampedAlpha, dt);
  }

  _applyState(s0, s1, alpha, dt) {
    const p0 = new THREE.Vector3(s0.p[0], s0.p[1], s0.p[2]);
    const p1 = new THREE.Vector3(s1.p[0], s1.p[1], s1.p[2]);
    const q0 = new THREE.Quaternion(s0.q[0], s0.q[1], s0.q[2], s0.q[3]);
    const q1 = new THREE.Quaternion(s1.q[0], s1.q[1], s1.q[2], s1.q[3]);

    // Check for large snap / teleport (> 20m)
    if (this.car.position.lengthSq() > 0 && this.car.position.distanceTo(p1) > 20) {
      this.currentPosition.copy(p1);
      this.currentQuaternion.copy(q1);
    } else {
      this.currentPosition.lerpVectors(p0, p1, alpha);
      this.currentQuaternion.slerpQuaternions(q0, q1, alpha);
    }

    this.car.position.copy(this.currentPosition);
    this.car.quaternion.copy(this.currentQuaternion);

    this.currentVelocity.set(s1.v[0], s1.v[1], s1.v[2]);

    // Apply lights from the newer state
    this._applyLights(s1.li);

    // Apply wheels
    this._applyWheels(s1.w, s1.spd, dt, s0.w, alpha);
  }

  _applyLights(li) {
    if (!li) return;
    const headMode = li.head ?? 0;
    setHeadlightBulbs(this.car, headMode);

    for (const lamp of this.headlights) {
      lamp.intensity = headMode === 0 ? 0 : headMode === 1 ? 320 : 780;
      lamp.distance = headMode === 2 ? 72 : 22;
      lamp.angle = headMode === 2 ? 0.22 : 0.48;
    }

    // Brake lights
    const isBraking = Boolean(li.brake);
    const brakes = this.car.userData.brakeLights;
    for (const mat of Array.isArray(brakes) ? brakes : brakes ? [brakes] : []) {
      mat.emissiveIntensity = isBraking ? 3.6 : 0.3;
    }

    // Reverse lights
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

    // Advance wheel spin smoothly based on speed
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

    // Feed remote wheel slip/skid/smoke into the replicated tireEffects instance
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
        // Fallback to wheel world position
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

    // Position ~2.1m above car chassis
    this.nameplate.position.copy(this.currentPosition);
    this.nameplate.position.z += 2.1;

    // Distance culling: hide if > 150m away
    if (cameraPosition) {
      const dist = this.currentPosition.distanceTo(cameraPosition);
      this.nameplate.visible = dist < 150;
    }
  }

  dispose() {
    // Remove car and lights
    if (this.car) {
      this.car.removeFromParent();
    }
    // Remove nameplate
    if (this.nameplate) {
      this.nameplate.removeFromParent();
      this.nameplate.material.dispose();
      this.nameplateTexture?.dispose();
    }
    // Dispose tire effects
    this.tireEffects?.dispose();
    // Dispose private materials
    for (const mat of this.paintMaterials) {
      mat.dispose();
    }
  }
}
