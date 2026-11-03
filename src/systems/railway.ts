// The railway: one train car running a loop through the station on a timetable.
//
// Two ways of showing the same motion (CLAUDE.md "열차 설계"):
//  - 'station' view: the station stays put and the train really moves (player on the platform).
//  - 'train' view:   the train stays put and the station + scenery slide past (player on board).
// The view only changes while the train is stopped, so nothing jumps.
import * as THREE from 'three';
import {
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  CAR_HEIGHT,
  CAR_WALL,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  DOORS,
  WINDOW_BOTTOM,
  WINDOW_TOP,
  WINDOW_WIDTH,
  WINDOWS,
  createTrainCar,
  type TrainCar,
} from '../scenes/trainCar';
import { TrackScenery, CHUNK } from '../scenes/trackScenery';
import { createPineGeometry, PLATFORM, RAIL_Z, type StationZone, type Track } from '../scenes/winter';

const SPEED = 12; // m/s cruising
// Test timetable (seconds). Distances: departing and arriving cover SPEED * T / 2 each.
const CYCLE = { stopped: 40, closing: 3, departing: 10, running: 47, arriving: 16, opening: 3 } as const;
type Phase = keyof typeof CYCLE;
const ORDER: Phase[] = ['stopped', 'closing', 'departing', 'running', 'arriving', 'opening'];
// One lap = departing + running + arriving distance. Must be a multiple of 3 scenery chunks.
const LOOP = SPEED * (CYCLE.departing / 2 + CYCLE.running + CYCLE.arriving / 2);
if (LOOP % (CHUNK * 3) !== 0) console.warn(`Railway loop ${LOOP} m is not a multiple of ${CHUNK * 3} m`);

export const TRAIN_FLOOR = PLATFORM.height; // level boarding from the platform

export class Railway {
  /** 0 = closed, 1 = open. */
  doorOpen = 0;
  phase: Phase = 'stopped';
  view: 'station' | 'train' = 'station';
  /** Called when the train pulls in and its doors start to open. */
  onArrive: (() => void) | null = null;

  private car: TrainCar;
  private scenery: TrackScenery;
  private phaseIndex = 0;
  private phaseTime = 0;
  private s = 0; // distance along the loop since the station, 0..LOOP
  private carX = 0; // car position along x in the current view

  constructor(
    scene: THREE.Scene,
    track: Track,
    private station: StationZone,
  ) {
    this.car = createTrainCar(track, -1); // platform is on the -z side of the track
    this.car.group.position.set(0, TRAIN_FLOOR, RAIL_Z);
    this.scenery = new TrackScenery(track, track(createPineGeometry()), LOOP, [0]);
    this.scenery.root.position.z = RAIL_Z;
    scene.add(this.car.group, this.scenery.root);

    // The platform edge opens only at an open door.
    station.railGate = (x) => this.doorsPassable() && this.inDoorway(x - this.carX, 0.3);
  }

  /** Position along the loop wrapped to (-LOOP/2, LOOP/2]: negative while approaching. */
  private get rel(): number {
    return this.s > LOOP / 2 ? this.s - LOOP : this.s;
  }

  update(dt: number, player: THREE.Vector3): void {
    this.phaseTime += dt;
    const phase = ORDER[this.phaseIndex];
    const T = CYCLE[phase];
    const t = Math.min(this.phaseTime / T, 1);
    const ease = t * t * (3 - 2 * t);

    switch (phase) {
      case 'stopped':
        this.s = 0;
        this.doorOpen = 1;
        break;
      case 'closing':
        this.doorOpen = 1 - ease;
        break;
      case 'departing':
        // Distance under a smoothstep speed ramp: V T (t^3 - t^4 / 2).
        this.s = SPEED * T * (t ** 3 - t ** 4 / 2);
        break;
      case 'running':
        this.s = SPEED * (CYCLE.departing / 2 + this.phaseTime);
        break;
      case 'arriving': {
        const start = LOOP - (SPEED * T) / 2;
        this.s = start + SPEED * T * (t - t ** 3 + t ** 4 / 2);
        break;
      }
      case 'opening':
        this.s = 0;
        this.doorOpen = ease;
        break;
    }
    this.phase = phase;

    if (t >= 1) {
      this.phaseIndex = (this.phaseIndex + 1) % ORDER.length;
      this.phaseTime = 0;
      const next = ORDER[this.phaseIndex];
      // Choose how to show the trip at the moment the train starts to move.
      if (next === 'departing') this.view = this.isInside(player) ? 'train' : 'station';
      if (next === 'opening') {
        this.view = 'station';
        this.onArrive?.();
      }
    }

    if (this.view === 'train') {
      this.carX = 0;
      this.station.root.position.x = -this.rel;
      this.scenery.update(this.s);
    } else {
      this.carX = this.rel;
      this.station.root.position.x = 0;
      this.scenery.update(0);
    }
    this.car.group.position.x = this.carX;
    this.car.setDoorOpen(this.doorOpen);
  }

  /** Seconds left in the current phase. */
  private get phaseLeft(): number {
    return Math.max(0, CYCLE[ORDER[this.phaseIndex]] - this.phaseTime);
  }

  /** Seconds until the train next stands at the station with its doors opening (0 while there). */
  get secondsUntilArrival(): number {
    const i = this.phaseIndex;
    const opening = ORDER.indexOf('opening');
    if (ORDER[i] === 'stopped' || ORDER[i] === 'opening') return 0;
    let t = this.phaseLeft;
    for (let k = i + 1; k < opening; k++) t += CYCLE[ORDER[k]];
    return t;
  }

  /** Seconds until the doors start closing (only meaningful while stopped). */
  get secondsUntilClose(): number {
    return ORDER[this.phaseIndex] === 'stopped' ? this.phaseLeft : 0;
  }

  /** Horizontal distance from a point to where the car stands at the station (0 when inside). */
  distanceToStop(p: THREE.Vector3): number {
    const dx = Math.max(0, Math.abs(p.x) - CAR_HALF_LENGTH);
    const dz = Math.max(0, Math.abs(p.z - RAIL_Z) - CAR_HALF_WIDTH);
    return Math.hypot(dx, dz);
  }

  /** Is this point inside the car (walls included)? */
  isInside(p: THREE.Vector3): boolean {
    return Math.abs(p.x - this.carX) < CAR_HALF_LENGTH && Math.abs(p.z - RAIL_Z) < CAR_HALF_WIDTH;
  }

  private doorsPassable(): boolean {
    return this.view === 'station' && this.phase === 'stopped' && this.doorOpen > 0.95;
  }

  private inDoorway(localX: number, r: number): boolean {
    return DOORS.some((c) => Math.abs(localX - c) < DOOR_WIDTH / 2 - r);
  }

  /** Keeps the player inside the car, letting them through an open door on the platform side. */
  constrainInside(p: THREE.Vector3, r: number): void {
    const lx = THREE.MathUtils.clamp(p.x - this.carX, -CAR_HALF_LENGTH + CAR_WALL + r, CAR_HALF_LENGTH - CAR_WALL - r);
    p.x = this.carX + lx;
    p.z = Math.min(p.z, RAIL_Z + CAR_HALF_WIDTH - CAR_WALL - r);
    if (!(this.doorsPassable() && this.inDoorway(lx, r))) {
      p.z = Math.max(p.z, RAIL_Z - CAR_HALF_WIDTH + CAR_WALL + r);
    }
  }

  /**
   * Camera collision with the car: if the line from the look target to the camera passes
   * through a solid part of a wall or the roof, pull the camera in to just before it.
   * Windows and open doors let the view through, so the camera never jumps sideways.
   */
  collideCamera(target: THREE.Vector3, desired: THREE.Vector3): void {
    const ax = target.x - this.carX;
    const ay = target.y - TRAIN_FLOOR;
    const az = target.z - RAIL_Z;
    const dx = desired.x - target.x;
    const dy = desired.y - target.y;
    const dz = desired.z - target.z;
    const L = CAR_HALF_LENGTH;
    const W = CAR_HALF_WIDTH;
    // From inside, the ceiling stops the camera; from outside, the top of the roof does.
    const targetInside = Math.abs(ax) < L && Math.abs(az) < W;
    const H = targetInside ? CAR_HEIGHT - 0.05 : CAR_HEIGHT + 0.2;
    const doorsOpen = this.doorOpen > 0.5;
    let hit = 1;

    const sideWallSolid = (x: number, y: number, platformSide: boolean): boolean => {
      if (Math.abs(x) > L || y < 0 || y > H) return false;
      if (WINDOWS.some((c) => Math.abs(x - c) < WINDOW_WIDTH / 2) && y > WINDOW_BOTTOM && y < WINDOW_TOP) return false;
      if (platformSide && doorsOpen && DOORS.some((c) => Math.abs(x - c) < DOOR_WIDTH / 2) && y < DOOR_HEIGHT) return false;
      return true;
    };
    const test = (t: number, solid: boolean) => {
      if (t > 0 && t < hit && solid) hit = t;
    };

    for (const side of [-1, 1]) {
      const wz = side * W;
      if (dz !== 0) {
        const t = (wz - az) / dz;
        test(t, sideWallSolid(ax + dx * t, ay + dy * t, side === -1));
      }
      const wx = side * L;
      if (dx !== 0) {
        const t = (wx - ax) / dx;
        const y = ay + dy * t;
        const z = az + dz * t;
        test(t, Math.abs(z) < W && y > 0 && y < H);
      }
    }
    if (dy !== 0) {
      const t = (H - ay) / dy;
      test(t, Math.abs(ax + dx * t) < L && Math.abs(az + dz * t) < W);
    }

    if (hit < 1) {
      // Stop a little short of the wall so the near plane doesn't clip it.
      const len = Math.hypot(dx, dy, dz);
      const t = Math.max(0, hit - 0.25 / len);
      desired.set(target.x + dx * t, target.y + dy * t, target.z + dz * t);
    }
  }
}
