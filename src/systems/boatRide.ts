// A small rowboat on the spring stream. It waits at the dock; once someone sits in it, it drifts
// downstream on its own (under the arched bridge) to the landing. Riders can step off there,
// or stay seated and the boat turns around and drifts back to the dock. Nothing to steer.
import * as THREE from 'three';
import { box, merge, paint, propMaterial, type Track } from '../scenes/lowpoly';
import type { Creek } from '../scenes/creek';

const SPEED = 2.5; // m/s (about 22 s from dock to landing)
const DEPART_AFTER_BOARDING = 2.5; // s, a moment to settle in
const DEPART_AGAIN = 8; // s at the dock after a round trip, time to step off first
const STAY_AT_LANDING = 15; // s before a seated rider is taken back
const RETURN_EMPTY = 5; // s before an empty boat heads back
const TURN_TIME = 4; // s for a slow half turn
const WATER_Y = 0.03;
/** Seat top in boat coordinates (x right, y up, z toward the bow). */
const SEAT = new THREE.Vector3(0, 0.18, -0.35);

type State = 'docked' | 'down' | 'landed' | 'turnBack' | 'up' | 'turnHome';

export class BoatRide {
  readonly mesh: THREE.Group;
  /** True while someone sits in the boat. */
  rider = false;

  private state: State = 'docked';
  private timer = 0;
  private s: number;
  private turn = 0; // 0 = bow downstream, 1 = bow upstream
  private time = 0;
  private pos = new THREE.Vector2();
  private tangent = new THREE.Vector2();

  constructor(
    private creek: Creek,
    track: Track,
  ) {
    this.mesh = new THREE.Group();
    this.mesh.add(new THREE.Mesh(track(createBoatGeometry()), propMaterial));
    this.mesh.rotation.order = 'YXZ';
    this.s = creek.dock.s;
    this.place();
  }

  /** Moored and still: at the dock or the landing. */
  get stopped(): boolean {
    return this.state === 'docked' || this.state === 'landed';
  }

  get canBoard(): boolean {
    return this.state === 'docked' && !this.rider;
  }

  /** Where the boat is moored now (station coordinates), for the "보트 타기" range check. */
  get pier() {
    return this.state === 'landed' ? this.creek.landing : this.creek.dock;
  }

  board(): void {
    this.rider = true;
    this.timer = DEPART_AFTER_BOARDING;
  }

  /** Steps off at the pier beside the boat; returns where the rider now stands (station coordinates). */
  alight(): THREE.Vector2 {
    this.rider = false;
    this.timer = this.state === 'landed' ? RETURN_EMPTY : Infinity;
    return this.pier.stand;
  }

  /** Rider position (world) and facing, for the seated character. */
  seat(out: THREE.Vector3): THREE.Vector3 {
    this.mesh.updateWorldMatrix(true, false);
    return this.mesh.localToWorld(out.copy(SEAT));
  }

  get yaw(): number {
    return this.mesh.rotation.y;
  }

  /** Dev only: seat a rider and start drifting `meters` below the dock. */
  debugStart(meters: number): void {
    this.rider = true;
    this.state = 'down';
    this.s = this.creek.dock.s + meters;
  }

  update(dt: number): void {
    this.time += dt;
    this.timer -= dt;
    const { dock, landing } = this.creek;

    switch (this.state) {
      case 'docked':
        if (this.rider && this.timer <= 0) this.state = 'down';
        break;
      case 'down':
        if (this.drift(dt, landing.s)) {
          this.state = 'landed';
          this.timer = this.rider ? STAY_AT_LANDING : RETURN_EMPTY;
        }
        break;
      case 'landed':
        if (this.timer <= 0) this.state = 'turnBack';
        break;
      case 'turnBack':
        this.turn = Math.min(1, this.turn + dt / TURN_TIME);
        if (this.turn >= 1) this.state = 'up';
        break;
      case 'up':
        if (this.drift(dt, dock.s)) this.state = 'turnHome';
        break;
      case 'turnHome':
        this.turn = Math.max(0, this.turn - dt / TURN_TIME);
        if (this.turn <= 0) {
          this.state = 'docked';
          this.timer = DEPART_AGAIN;
        }
        break;
    }
    this.place();
  }

  /** Moves toward `goal` along the stream, easing in and out. Returns true on arrival. */
  private drift(dt: number, goal: number): boolean {
    const remaining = Math.abs(goal - this.s);
    const from = this.state === 'down' ? this.creek.dock.s : this.creek.landing.s;
    const travelled = Math.abs(this.s - from);
    const ease = THREE.MathUtils.clamp(Math.min((travelled + 0.8) / 7, (remaining + 0.3) / 8), 0.04, 1);
    const step = Math.min(remaining, SPEED * ease * dt);
    this.s += Math.sign(goal - this.s) * step;
    return remaining - step < 0.005;
  }

  private place(): void {
    this.creek.sample(this.s, this.pos, this.tangent);
    // A slow, small bob and sway so it feels afloat even when moored.
    const t = this.time;
    this.mesh.position.set(this.pos.x, WATER_Y + Math.sin(t * 1.4) * 0.012, this.pos.y);
    this.mesh.rotation.y = Math.atan2(this.tangent.x, this.tangent.y) + Math.PI * smooth(this.turn);
    this.mesh.rotation.x = Math.sin(t * 1.7) * 0.012;
    this.mesh.rotation.z = Math.sin(t * 1.1) * 0.022;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Low-poly rowboat about 2.2 m long and 1 m wide: hull wall, floor, two benches. Bow toward +z. */
function createBoatGeometry(): THREE.BufferGeometry {
  const outline = new THREE.Shape();
  outline.moveTo(0, 1.15);
  outline.quadraticCurveTo(0.5, 0.75, 0.5, 0);
  outline.lineTo(0.5, -0.6);
  outline.quadraticCurveTo(0.48, -1.0, 0, -1.0);
  outline.quadraticCurveTo(-0.48, -1.0, -0.5, -0.6);
  outline.lineTo(-0.5, 0);
  outline.quadraticCurveTo(-0.5, 0.75, 0, 1.15);
  const innerPoints = outline.getPoints(8).map((p) => new THREE.Vector2(p.x * 0.86, (p.y - 0.07) * 0.9 + 0.07));
  const hull = new THREE.Shape(outline.getPoints(8));
  hull.holes.push(new THREE.Path(innerPoints));
  const floor = new THREE.Shape(innerPoints);

  // Shapes are drawn in x/y with the bow at +y; extrude upward and turn the bow to +z.
  const lay = (g: THREE.BufferGeometry, y: number) => {
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI);
    g.translate(0, y, 0);
    return g;
  };
  const wall = paint(lay(new THREE.ExtrudeGeometry(hull, { depth: 0.34, bevelEnabled: false, curveSegments: 8 }), -0.04), '#c4936e', { min: 0.74 });
  const bottom = paint(lay(new THREE.ExtrudeGeometry(floor, { depth: 0.05, bevelEnabled: false }), -0.02), '#8f735d');
  return merge([
    wall,
    bottom,
    box(0.84, 0.04, 0.3, 0, SEAT.y - 0.02, SEAT.z, '#e0c29a'), // rider's bench
    box(0.72, 0.04, 0.24, 0, SEAT.y - 0.02, 0.5, '#e0c29a'), // bow bench
  ]);
}
