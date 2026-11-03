// Orbit-style third-person camera that follows a target from behind and above.
import * as THREE from 'three';

const DISTANCE_MIN = 1.8;
const DISTANCE_MAX = 7;
const HEIGHT_OFFSET = 0.6; // look at the character's upper body
const PITCH_MIN = 0.12;
const PITCH_MAX = 0.95;
const YAW_SPEED = 0.006; // radians per pixel
const PITCH_SPEED = 0.004;

export class ThirdPersonCamera {
  yaw = 0; // 0 = camera on +z looking toward -z
  pitch = 0.32;
  distance = 3.6;
  /** Optional box the camera must stay inside (train interior walls). */
  bounds: THREE.Box3 | null = null;

  private lookTarget = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private followRate = 2.5; // starts soft for the boarding transition, then tightens

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Start following from wherever the camera currently is. */
  begin(lookTarget: THREE.Vector3): void {
    this.lookTarget.copy(lookTarget);
    this.followRate = 2.5;
  }

  rotate(dxPx: number, dyPx: number): void {
    this.yaw -= dxPx * YAW_SPEED;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dyPx * PITCH_SPEED, PITCH_MIN, PITCH_MAX);
  }

  /** factor < 1 moves closer, > 1 moves farther. */
  zoom(factor: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * factor, DISTANCE_MIN, DISTANCE_MAX);
  }

  /** Camera-relative ground directions for movement. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt: number, targetPos: THREE.Vector3): void {
    this.followRate = Math.min(this.followRate + dt * 6, 12);
    const k = 1 - Math.exp(-this.followRate * dt);

    this.lookTarget.lerp(this.desired.set(targetPos.x, targetPos.y + HEIGHT_OFFSET, targetPos.z), k);

    const cp = Math.cos(this.pitch);
    this.desired.set(
      this.lookTarget.x + Math.sin(this.yaw) * cp * this.distance,
      this.lookTarget.y + Math.sin(this.pitch) * this.distance,
      this.lookTarget.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.position.lerp(this.desired, k);
    if (this.bounds) this.camera.position.clamp(this.bounds.min, this.bounds.max);
    this.camera.lookAt(this.lookTarget);
  }
}
