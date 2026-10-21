import * as THREE from 'three';

const TAU = Math.PI * 2;
const MAX_SPIN = 12; // rad/s after a flick
const COAST_DECAY = 3.2; // 1/s
const xAxis = new THREE.Vector3(1, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);

/** Wraps an angle into (-π, π]. */
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Turntable rotation: unlimited yaw about the vertical axis, pitch clamped. Drags move it directly,
 * a flick keeps it coasting, and turnTo() animates with a critically damped spring.
 */
export class Turntable {
  yaw = 0;
  pitch = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private target: { yaw: number; pitch: number; stiffness: number } | null = null;
  private dragging = false;
  private readonly qYaw = new THREE.Quaternion();
  private readonly qPitch = new THREE.Quaternion();

  constructor(public pitchLimit: number) {}

  /** Where the turntable is heading (the spring target, or where it is). */
  get aimYaw() {
    return this.target ? this.target.yaw : this.yaw;
  }
  get aimPitch() {
    return this.target ? this.target.pitch : this.pitch;
  }

  /** The yaw equivalent to `angle` that is closest to where the turntable is heading. */
  nearestYaw(angle: number) {
    const from = this.aimYaw;
    return from + wrapAngle(angle - from);
  }

  private clampPitch(p: number) {
    return Math.min(Math.max(p, -this.pitchLimit), this.pitchLimit);
  }

  beginDrag() {
    this.dragging = true;
    this.target = null;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
  }

  dragBy(dYaw: number, dPitch: number, seconds: number) {
    this.yaw += dYaw;
    this.pitch = this.clampPitch(this.pitch + dPitch);
    const s = Math.max(seconds, 1 / 240);
    const limit = (v: number) => Math.min(Math.max(v, -MAX_SPIN), MAX_SPIN);
    this.yawVelocity = limit(this.yawVelocity + (dYaw / s - this.yawVelocity) * 0.4);
    this.pitchVelocity = limit(this.pitchVelocity + (dPitch / s - this.pitchVelocity) * 0.4);
  }

  /** Ends a drag; with coast, a flick keeps turning and slows down. */
  endDrag(coast: boolean) {
    this.dragging = false;
    if (!coast) {
      this.yawVelocity = 0;
      this.pitchVelocity = 0;
    }
  }

  turnTo(yaw: number, pitch: number, stiffness = 60) {
    this.target = { yaw, pitch: this.clampPitch(pitch), stiffness };
  }

  update(dt: number, instant: boolean) {
    if (this.dragging) return;
    if (this.target) {
      if (instant) {
        this.yaw = this.target.yaw;
        this.pitch = this.target.pitch;
        this.target = null;
        this.yawVelocity = this.pitchVelocity = 0;
        return;
      }
      const k = this.target.stiffness;
      const c = 2 * Math.sqrt(k);
      for (let left = dt; left > 1e-6; left -= 1 / 240) {
        const h = Math.min(left, 1 / 240);
        this.yawVelocity += (k * (this.target.yaw - this.yaw) - c * this.yawVelocity) * h;
        this.pitchVelocity += (k * (this.target.pitch - this.pitch) - c * this.pitchVelocity) * h;
        this.yaw += this.yawVelocity * h;
        this.pitch += this.pitchVelocity * h;
      }
      const off = Math.abs(this.target.yaw - this.yaw) + Math.abs(this.target.pitch - this.pitch);
      const speed = Math.abs(this.yawVelocity) + Math.abs(this.pitchVelocity);
      if (off < 1e-4 && speed < 1e-3) {
        this.yaw = this.target.yaw;
        this.pitch = this.target.pitch;
        this.target = null;
        this.yawVelocity = this.pitchVelocity = 0;
      }
      return;
    }
    if (this.yawVelocity === 0 && this.pitchVelocity === 0) return;
    if (instant) {
      this.yawVelocity = this.pitchVelocity = 0;
      return;
    }
    this.yaw += this.yawVelocity * dt;
    const pitch = this.pitch + this.pitchVelocity * dt;
    this.pitch = this.clampPitch(pitch);
    if (this.pitch !== pitch) this.pitchVelocity = 0;
    const decay = Math.exp(-dt * COAST_DECAY);
    this.yawVelocity = Math.abs(this.yawVelocity * decay) < 0.02 ? 0 : this.yawVelocity * decay;
    this.pitchVelocity = Math.abs(this.pitchVelocity * decay) < 0.02 ? 0 : this.pitchVelocity * decay;
  }

  /** Back to the rest pose by the shortest way round. */
  home() {
    this.turnTo(Math.round(this.yaw / TAU) * TAU, 0, 45);
  }

  /** Object orientation: the rest pose, turned by yaw about the vertical, then tilted by pitch. */
  orientation(rest: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
    this.qYaw.setFromAxisAngle(yAxis, this.yaw);
    this.qPitch.setFromAxisAngle(xAxis, this.pitch);
    return out.copy(this.qPitch).multiply(this.qYaw).multiply(rest);
  }
}
