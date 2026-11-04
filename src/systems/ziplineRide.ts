// The zipline seat: a small swing seat on a trolley. From the tower (after a soft fade, so no
// ladder climbing), the rider slides down the cable to the frame near the dock, swinging a
// little as it speeds up and slows down, then steps down. The empty seat rolls back up.
import * as THREE from 'three';
import { box, merge, propMaterial, type Track } from '../scenes/lowpoly';
import { SEAT_DROP, type Zipline } from '../scenes/zipline';

const TOP_SPEED = 6; // m/s
const RETURN_SPEED = 3; // m/s, the empty seat going back up
const SETTLE = 1.2; // s seated on the tower before letting go
const STEP_DOWN = 0.8; // s at the end before stepping off
const GRAVITY = 9.8;

type State = 'ready' | 'settling' | 'sliding' | 'arrived' | 'returning';

export class ZiplineRide {
  /** Pivot on the cable; the seat hangs below it and swings around it. */
  readonly mesh = new THREE.Group();
  rider = false;
  /** Called when the rider should step off (they stay where the seat is and drop to the ground). */
  onArrive: (() => void) | null = null;

  private state: State = 'ready';
  private timer = 0;
  private u: number;
  private speed = 0;
  private swing = 0; // pendulum angle (rad), positive = seat trailing behind
  private swingVel = 0;
  private yaw: number;

  constructor(
    private line: Zipline,
    track: Track,
  ) {
    this.u = line.rideStart;
    this.yaw = Math.atan2(line.direction.x, line.direction.y);
    this.mesh.add(new THREE.Mesh(track(createSeatGeometry()), propMaterial));
    this.mesh.rotation.order = 'YXZ';
    this.place();
  }

  get canBoard(): boolean {
    return this.state === 'ready';
  }

  board(): void {
    this.rider = true;
    this.state = 'settling';
    this.timer = SETTLE;
  }

  /** Rider seat (world position) and facing. */
  seat(out: THREE.Vector3): THREE.Vector3 {
    this.mesh.updateWorldMatrix(true, false);
    return this.mesh.localToWorld(out.set(0, -SEAT_DROP, 0));
  }

  get facing(): number {
    return this.yaw;
  }

  /** Forward/back sway, for tilting the seated rider with the seat. */
  get tilt(): number {
    return this.swing;
  }

  /** Dev only: seat a rider already sliding, `meters` down the cable. */
  debugStart(meters: number): void {
    this.rider = true;
    this.state = 'sliding';
    this.u = this.line.rideStart + meters;
    this.speed = TOP_SPEED;
  }

  update(dt: number): void {
    this.timer -= dt;
    const { rideStart, rideEnd } = this.line;
    let accel = 0;

    switch (this.state) {
      case 'settling':
        if (this.timer <= 0) this.state = 'sliding';
        break;
      case 'sliding': {
        // Speeds up off the tower, coasts, and eases into the end.
        const travelled = this.u - rideStart;
        const remaining = rideEnd - this.u;
        const target = TOP_SPEED * THREE.MathUtils.clamp(Math.min((travelled + 0.6) / 5, (remaining + 0.2) / 7), 0.05, 1);
        accel = (target - this.speed) / Math.max(dt, 1e-3);
        this.speed = target;
        this.u = Math.min(rideEnd, this.u + this.speed * dt);
        if (this.u >= rideEnd - 0.005) {
          this.state = 'arrived';
          this.timer = STEP_DOWN;
          this.speed = 0;
        }
        break;
      }
      case 'arrived':
        if (this.timer <= 0) {
          this.rider = false;
          this.onArrive?.();
          this.state = 'returning';
        }
        break;
      case 'returning':
        this.u = Math.max(rideStart, this.u - RETURN_SPEED * dt);
        if (this.u <= rideStart) this.state = 'ready';
        break;
    }

    // Pendulum on a rope of SEAT_DROP: speeding up makes the seat trail, slowing down swings it ahead.
    const L = SEAT_DROP;
    accel = THREE.MathUtils.clamp(accel, -6, 6);
    const angAcc = (-GRAVITY * Math.sin(this.swing) + accel * Math.cos(this.swing)) / L - 1.4 * this.swingVel;
    this.swingVel += angAcc * dt;
    this.swing += this.swingVel * dt;
    this.place();
  }

  private place(): void {
    this.line.pointAt(this.u, this.mesh.position);
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.x = this.swing;
  }
}

/** Trolley on the cable, two ropes, and a little plank seat at SEAT_DROP below. Built facing +z. */
function createSeatGeometry(): THREE.BufferGeometry {
  const rope = '#cdbb98';
  const ropeLen = SEAT_DROP - 0.1;
  return merge([
    box(0.12, 0.1, 0.32, 0, -0.04, 0, '#6b6f78'), // trolley
    // Ropes wide enough apart for the roundest body type.
    box(1.04, 0.05, 0.05, 0, -0.1, 0, '#8f735d'), // bar the ropes hang from
    box(0.03, ropeLen, 0.03, -0.5, -0.1 - ropeLen / 2, 0, rope),
    box(0.03, ropeLen, 0.03, 0.5, -0.1 - ropeLen / 2, 0, rope),
    box(1.06, 0.05, 0.38, 0, -SEAT_DROP - 0.025, -0.05, '#a98d74'), // seat, top at -SEAT_DROP
  ]);
}
