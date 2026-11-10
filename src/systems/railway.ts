// The railway: a loop line with equally spaced stations and one train per station, all on the
// same timetable, so every station has a train standing at it at the same time (CLAUDE.md).
//
// Two ways of showing the motion (CLAUDE.md "열차 설계"):
//  - 'station' view: the station the player is at stays put and the trains really move.
//  - 'train' view:   the car the player rides stays put and stations + scenery slide past.
// The view only changes while the trains are stopped, so nothing jumps.
//
// Stations load lazily (CLAUDE.md): the railway always knows every station's season, name and
// colors, but builds a station's scenery only when the view comes within LOAD_DISTANCE of it,
// and disposes it again beyond UNLOAD_DISTANCE. The station the player is at is always loaded.
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
import { TrackScenery, CHUNK, type SeasonSample } from '../scenes/trackScenery';
import { PLATFORM, RAIL_Z, stationInfo, type StationInfo, type StationSeason, type StationZone } from '../scenes/station';
import { clonePalette, emptyWeights, lerpPalette } from '../scenes/seasons';
import type { Track } from '../scenes/lowpoly';

// Test timetable (seconds): about 40 s of travel between stations.
const CYCLE = { stopped: 40, closing: 3, departing: 8, running: 22, arriving: 10, opening: 3 } as const;
type Phase = keyof typeof CYCLE;
const ORDER: Phase[] = ['stopped', 'closing', 'departing', 'running', 'arriving', 'opening'];
/** Distance between neighboring stations. The loop (SEGMENT x stations) must be a multiple of 360 m. */
const SEGMENT = 720;
/** Cruising speed that covers one segment in the timetable (accel/decel each cover SPEED * T / 2). */
const SPEED = SEGMENT / (CYCLE.departing / 2 + CYCLE.running + CYCLE.arriving / 2);
/** Build a station when the view is this close (stations show from 220 m), drop it beyond UNLOAD. */
const LOAD_DISTANCE = 380;
const UNLOAD_DISTANCE = 450;

/** A station's place on the line: always present, with its scenery loaded only when near. */
interface StationSlot {
  info: StationInfo;
  root: THREE.Group;
  zone: StationZone | null;
}

export const TRAIN_FLOOR = PLATFORM.height; // level boarding from the platform

export class Railway {
  /** 0 = closed, 1 = open (all trains move together). */
  doorOpen = 0;
  /** Train speed relative to cruising speed, 0..1 (all trains move together). */
  speedRatio = 0;
  phase: Phase = 'stopped';
  view: 'station' | 'train' = 'station';
  /** Called when the trains pull in and their doors start to open. */
  onArrive: ((station: StationZone) => void) | null = null;
  /** Called right after a station is built, and right before one is disposed. */
  onLoad: ((station: StationZone) => void) | null = null;
  onUnload: ((station: StationZone) => void) | null = null;

  private slots: StationSlot[];

  private readonly loop: number;
  private cars: TrainCar[] = [];
  private carX: number[] = []; // car positions along x in the current view
  private scenery: TrackScenery;
  private phaseIndex = 0;
  private phaseTime = 0;
  private d = 0; // distance along the current leg, 0..SEGMENT
  private legs = 0; // completed legs, decides which car is at which station
  private frame = 0; // station the player's frame belongs to (station view)
  private riding = -1; // car the player rides (train view)
  private sample: SeasonSample;

  constructor(
    scene: THREE.Scene,
    track: Track,
    seasons: StationSeason[],
    private build: (root: THREE.Group, season: StationSeason) => StationZone,
  ) {
    this.slots = seasons.map((season) => {
      const root = new THREE.Group();
      scene.add(root);
      return { info: stationInfo(season), root, zone: null };
    });
    const stations = this.slots.map((slot) => slot.info);
    this.loop = SEGMENT * stations.length;
    if (this.loop % (CHUNK * 3) !== 0) console.warn(`Railway loop ${this.loop} m is not a multiple of ${CHUNK * 3} m`);

    for (let k = 0; k < stations.length; k++) {
      const car = createTrainCar(track, -1); // platforms are on the -z side of the track
      car.group.position.set(0, TRAIN_FLOOR, RAIL_Z);
      scene.add(car.group);
      this.cars.push(car);
      this.carX.push(0);
    }
    this.sample = { palette: clonePalette(stations[0].palette), weights: emptyWeights() };
    this.scenery = new TrackScenery(
      track,
      this.loop,
      stations.map((_, i) => i * SEGMENT),
      (u) => this.seasonAt(u),
    );
    this.scenery.root.position.z = RAIL_Z;
    scene.add(this.scenery.root);

  }

  private load(i: number): StationZone {
    const slot = this.slots[i];
    if (slot.zone) return slot.zone;
    const t0 = performance.now();
    const zone = this.build(slot.root, slot.info.season);
    // A platform edge opens only at an open door of the car standing there.
    zone.railGate = (x) =>
      this.doorsPassable() && this.cars.some((_, k) => Math.abs(this.carX[k]) < 1 && this.inDoorway(x - this.carX[k], 0.3));
    slot.zone = zone;
    this.onLoad?.(zone);
    if (import.meta.env.DEV) {
      console.info(`[stations] built ${slot.info.season} in ${(performance.now() - t0).toFixed(1)} ms, loaded: ${this.loaded.map((z) => z.season)}`);
    }
    return zone;
  }

  private unload(i: number): void {
    const slot = this.slots[i];
    if (!slot.zone) return;
    this.onUnload?.(slot.zone);
    slot.zone.dispose();
    slot.zone = null;
    if (import.meta.env.DEV) console.info(`[stations] disposed ${slot.info.season}, loaded: ${this.loaded.map((z) => z.season)}`);
  }

  /** Stations that are built right now. */
  get loaded(): StationZone[] {
    return this.slots.flatMap((slot) => (slot.zone ? [slot.zone] : []));
  }

  /** The always-present group a station is placed under (for things that outlast its scenery). */
  rootOf(season: StationSeason): THREE.Group {
    return this.slots.find((slot) => slot.info.season === season)!.root;
  }

  /** Builds and drops stations by distance from the view. At most one build per frame. */
  private stream(anchor: number): void {
    let built = false;
    this.slots.forEach((slot, i) => {
      const dist = Math.abs(this.rel(anchor, i * SEGMENT));
      const keep = this.view === 'station' && i === this.frame;
      if (!slot.zone && (keep || (!built && dist < LOAD_DISTANCE))) {
        this.load(i);
        built = true;
      } else if (slot.zone && !keep && dist > UNLOAD_DISTANCE) {
        this.unload(i);
      }
    });
  }

  /** Dev only: start the player's frame at another station. */
  startAt(index: number): void {
    this.frame = ((index % this.slots.length) + this.slots.length) % this.slots.length;
  }

  /** The station the player is at (or was last at while riding). */
  get station(): StationZone {
    return this.load(this.frame);
  }

  /** Where the trains are heading on this leg, as seen by the player's car or station. */
  get nextStation(): StationInfo {
    const from = this.riding >= 0 ? this.stationOfCar(this.riding) : this.frame;
    return this.slots[(from + 1) % this.slots.length].info;
  }

  /** Season at the current view position (for sky, ground, snowfall). */
  get viewSeason(): SeasonSample {
    return this.seasonAt(this.viewS());
  }

  /** Station index a car departed from on the current leg (or stands at while stopped). */
  private stationOfCar(k: number): number {
    return (k + this.legs) % this.slots.length;
  }

  /** Track position of a car. */
  private carS(k: number): number {
    return this.stationOfCar(k) * SEGMENT + this.d;
  }

  /** Signed distance a → b along the loop, wrapped to (-loop/2, loop/2]. */
  private rel(from: number, to: number): number {
    const r = (((to - from) % this.loop) + this.loop) % this.loop;
    return r > this.loop / 2 ? r - this.loop : r;
  }

  private viewS(): number {
    return this.view === 'train' ? this.carS(this.riding) : this.frame * SEGMENT;
  }

  /** Palette and tree mix at a track position: pure at stations, blended mid-leg. */
  private seasonAt(u: number): SeasonSample {
    const n = this.slots.length;
    const wrapped = ((u % this.loop) + this.loop) % this.loop;
    const i = Math.floor(wrapped / SEGMENT) % n;
    const t = THREE.MathUtils.smoothstep((wrapped - i * SEGMENT) / SEGMENT, 0.3, 0.7);
    const a = this.slots[i].info;
    const b = this.slots[(i + 1) % n].info;
    lerpPalette(a.palette, b.palette, t, this.sample.palette);
    const w = this.sample.weights;
    for (const season of Object.keys(w) as (keyof typeof w)[]) w[season] = 0;
    w[a.season] += 1 - t;
    w[b.season] += t;
    return this.sample;
  }

  update(dt: number, player: THREE.Vector3): void {
    this.phaseTime += dt;
    const phase = ORDER[this.phaseIndex];
    const T = CYCLE[phase];
    const t = Math.min(this.phaseTime / T, 1);
    const ease = t * t * (3 - 2 * t);

    // Speed along the timetable: smoothstep ramps while departing and arriving.
    this.speedRatio =
      phase === 'departing' ? 3 * t * t - 2 * t ** 3 : phase === 'running' ? 1 : phase === 'arriving' ? 1 - 3 * t * t + 2 * t ** 3 : 0;

    switch (phase) {
      case 'stopped':
        this.d = 0;
        this.doorOpen = 1;
        break;
      case 'closing':
        this.doorOpen = 1 - ease;
        break;
      case 'departing':
        // Distance under a smoothstep speed ramp: V T (t^3 - t^4 / 2).
        this.d = SPEED * T * (t ** 3 - t ** 4 / 2);
        break;
      case 'running':
        this.d = SPEED * (CYCLE.departing / 2 + Math.min(this.phaseTime, T));
        break;
      case 'arriving': {
        const start = SEGMENT - (SPEED * T) / 2;
        this.d = start + SPEED * T * (t - t ** 3 + t ** 4 / 2);
        break;
      }
      case 'opening':
        this.d = 0;
        this.doorOpen = ease;
        break;
    }
    this.phase = phase;

    if (t >= 1) {
      this.phaseIndex = (this.phaseIndex + 1) % ORDER.length;
      this.phaseTime = 0;
      const next = ORDER[this.phaseIndex];
      if (next === 'departing') {
        // Choose how to show the trip at the moment the trains start to move.
        this.riding = this.cars.findIndex((_, k) => this.insideCar(k, player));
        this.view = this.riding >= 0 ? 'train' : 'station';
      }
      if (next === 'opening') {
        // Every train has reached the next station.
        this.legs++;
        this.d = 0;
        if (this.riding >= 0) this.frame = this.stationOfCar(this.riding);
        this.riding = -1;
        this.view = 'station';
        this.onArrive?.(this.station);
      }
    }

    // Place cars, stations and scenery relative to the view's anchor.
    const anchor = this.viewS();
    this.cars.forEach((car, k) => {
      this.carX[k] = this.view === 'train' && k === this.riding ? 0 : this.rel(anchor, this.carS(k));
      car.group.position.x = this.carX[k];
      car.group.visible = Math.abs(this.carX[k]) < 200;
      car.setDoorOpen(this.doorOpen);
    });
    this.stream(anchor);
    this.slots.forEach((st, i) => {
      const x = this.rel(anchor, i * SEGMENT);
      st.root.position.x = x;
      st.root.visible = Math.abs(x) < 220;
    });
    this.scenery.update(anchor);
  }

  private insideCar(k: number, p: THREE.Vector3): boolean {
    return Math.abs(p.x - this.carX[k]) < CAR_HALF_LENGTH && Math.abs(p.z - RAIL_Z) < CAR_HALF_WIDTH;
  }

  /** Distance from p to the nearest car in view (m), measured to the car's body. */
  nearestCarDistance(p: THREE.Vector3): number {
    let best = Infinity;
    for (const x of this.carX) {
      const dx = Math.max(0, Math.abs(p.x - x) - CAR_HALF_LENGTH);
      const dz = Math.max(0, Math.abs(p.z - RAIL_Z) - CAR_HALF_WIDTH);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  }

  /** Index of the car containing this point, or -1. */
  carAt(p: THREE.Vector3): number {
    return this.cars.findIndex((_, k) => this.insideCar(k, p));
  }

  isInside(p: THREE.Vector3): boolean {
    return this.carAt(p) >= 0;
  }

  private doorsPassable(): boolean {
    return this.view === 'station' && this.phase === 'stopped' && this.doorOpen > 0.95;
  }

  private inDoorway(localX: number, r: number): boolean {
    return DOORS.some((c) => Math.abs(localX - c) < DOOR_WIDTH / 2 - r);
  }

  /** Keeps the player inside a car, letting them through an open door on the platform side. */
  constrainInside(k: number, p: THREE.Vector3, r: number): void {
    const cx = this.carX[k];
    const lx = THREE.MathUtils.clamp(p.x - cx, -CAR_HALF_LENGTH + CAR_WALL + r, CAR_HALF_LENGTH - CAR_WALL - r);
    p.x = cx + lx;
    p.z = Math.min(p.z, RAIL_Z + CAR_HALF_WIDTH - CAR_WALL - r);
    if (!(this.doorsPassable() && this.inDoorway(lx, r))) {
      p.z = Math.max(p.z, RAIL_Z - CAR_HALF_WIDTH + CAR_WALL + r);
    }
  }

  /** Seconds left in the current phase. */
  private get phaseLeft(): number {
    return Math.max(0, CYCLE[ORDER[this.phaseIndex]] - this.phaseTime);
  }

  /** Seconds until the trains next stand at a station with doors opening (0 while there). */
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

  /** Horizontal distance from a point to where a car stands at this station (0 when inside). */
  distanceToStop(p: THREE.Vector3): number {
    const dx = Math.max(0, Math.abs(p.x) - CAR_HALF_LENGTH);
    const dz = Math.max(0, Math.abs(p.z - RAIL_Z) - CAR_HALF_WIDTH);
    return Math.hypot(dx, dz);
  }

  /**
   * Camera collision with nearby cars: if the line from the look target to the camera passes
   * through a solid part of a wall or the roof, pull the camera in to just before it.
   * Windows and open doors let the view through, so the camera never jumps sideways.
   */
  collideCamera(target: THREE.Vector3, desired: THREE.Vector3): void {
    for (let k = 0; k < this.cars.length; k++) {
      if (Math.abs(this.carX[k] - target.x) < CAR_HALF_LENGTH + 12) this.collideWithCar(k, target, desired);
    }
  }

  private collideWithCar(k: number, target: THREE.Vector3, desired: THREE.Vector3): void {
    const ax = target.x - this.carX[k];
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
      if (dz !== 0) {
        const t = (side * W - az) / dz;
        test(t, sideWallSolid(ax + dx * t, ay + dy * t, side === -1));
      }
      if (dx !== 0) {
        const t = (side * L - ax) / dx;
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
