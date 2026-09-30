const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const nearestTurn = (angle, reference) => angle + TAU * Math.round((reference - angle) / TAU);

function spring(value, velocity, target, frequency, dt) {
  const difference = value - target;
  const decay = Math.exp(-frequency * dt);
  return {
    value: target + (difference * (1 + frequency * dt) + velocity * dt) * decay,
    velocity: (velocity * (1 - frequency * dt) - difference * frequency * frequency * dt) * decay,
  };
}

export class DriveCameraControls {
  constructor() { this.reset(); }

  reset() {
    this.yaw = this.yawTarget = this.yawVelocity = 0;
    this.pitch = this.pitchTarget = this.pitchVelocity = 0;
    this.mouseIdle = 2;
    this.rearHeld = false;
  }

  setRearHeld(held) {
    if (this.rearHeld === held) return;
    this.rearHeld = held;
    if (!held) {
      this.yawTarget = nearestTurn(0, this.yaw);
      this.pitchTarget = 0;
      this.mouseIdle = 0;
    }
  }

  move(deltaX, deltaY, speedKmh) {
    if (this.rearHeld) return;
    const restriction = smoothstep(25, 42, speedKmh);
    const maxMovement = 140 - 60 * restriction;
    const movement = clamp(deltaX, -maxMovement, maxMovement);
    const precision = 0.0018 + 0.0012 * smoothstep(20, 90, Math.abs(movement));
    this.yawTarget -= movement * precision * (1 - 0.3 * restriction);
    this.pitchTarget = clamp(this.pitchTarget + clamp(deltaY, -90, 90) * 0.001, -0.12, 0.27);
    this.mouseIdle = 0;
  }

  edgeMove(horizontal, vertical, dt, speedKmh) {
    if (this.rearHeld || (!horizontal && !vertical)) return;
    const restriction = smoothstep(25, 42, speedKmh);
    this.yawTarget -= horizontal * dt * (2.6 - 0.7 * restriction);
    this.pitchTarget = clamp(this.pitchTarget + vertical * dt * 0.8, -0.12, 0.27);
    this.mouseIdle = 0;
  }

  update(dt, speedKmh, padX = 0, padY = 0) {
    dt = clamp(dt, 0, 0.1);
    const restriction = smoothstep(25, 42, speedKmh);
    if (!this.rearHeld && (Math.abs(padX) > 0.02 || Math.abs(padY) > 0.02)) {
      this.yawTarget -= padX * dt * (2.4 - 1.1 * restriction);
      this.pitchTarget = clamp(this.pitchTarget + padY * dt * 1.1, -0.12, 0.27);
      this.mouseIdle = 0;
    } else this.mouseIdle += dt;

    if (!this.rearHeld && this.mouseIdle > 0.85 && restriction > 0) {
      const center = nearestTurn(0, this.yawTarget);
      this.yawTarget += (center - this.yawTarget) * (1 - Math.exp(-0.9 * restriction * dt));
      this.pitchTarget *= Math.exp(-1.1 * restriction * dt);
    }

    const yawTarget = this.rearHeld ? nearestTurn(Math.PI, this.yaw) : this.yawTarget;
    const pitchTarget = this.rearHeld ? 0.04 : this.pitchTarget;
    const yaw = spring(this.yaw, this.yawVelocity, yawTarget, this.rearHeld ? 13 : 10 + 3 * restriction, dt);
    const pitch = spring(this.pitch, this.pitchVelocity, pitchTarget, 11, dt);
    this.yaw = yaw.value;
    this.yawVelocity = yaw.velocity;
    this.pitch = pitch.value;
    this.pitchVelocity = pitch.velocity;
    return { yaw: this.yaw, pitch: this.pitch, restriction };
  }
}
