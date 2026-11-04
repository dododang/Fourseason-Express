// Zipline in the spring village: a tall wooden tower beside the boat landing, a sagging cable,
// and a low frame near the dock where the ride ends. This file holds the fixed parts (towers,
// cable, collision, keep-clear area); the moving seat lives in systems/ziplineRide.ts.
import * as THREE from 'three';
import { box, merge, propMaterial, type Track } from './lowpoly';

/** Tower beside the landing, and the low frame near the dock (station coordinates). */
const START = new THREE.Vector2(45, -26.5);
const END = new THREE.Vector2(5, -37);
/** Cable height at both anchors, and how far it sags in the middle. */
const START_HEIGHT = 4.8;
const END_HEIGHT = 1.9; // the seat stops about 0.4 m off the ground, feet nearly touching
const SAG = 0.7; // small enough that the cable never dips below the end anchor
/** The seat hangs this far below the cable (its top). */
export const SEAT_DROP = 1.5;
const DECK = START_HEIGHT - SEAT_DROP; // tower deck level with the seat, as if you sat down from it
const TOWER_HALF = 0.8;
const SAMPLES = 80;

export interface Zipline {
  objects: THREE.Object3D[];
  colliders: { x: number; z: number; r: number }[];
  reserved(x: number, z: number, margin: number): boolean;
  /** Ground spot at the foot of the tower where the "짚라인 타기" button shows. */
  boardSpot: THREE.Vector2;
  /** Ride distance along the cable, from just off the tower deck to just before the end frame. */
  rideStart: number;
  rideEnd: number;
  /** Horizontal travel direction (start → end). */
  direction: THREE.Vector2;
  /** Cable point (station coordinates) at distance u along it. */
  pointAt(u: number, out: THREE.Vector3): THREE.Vector3;
}

export function createZipline(track: Track): Zipline {
  const dir = END.clone().sub(START).normalize();
  const yaw = Math.atan2(dir.x, dir.y); // local +z → toward the end
  // Cable anchors: at the tower's front edge, and at the end frame.
  const a = new THREE.Vector3(START.x + dir.x * TOWER_HALF, START_HEIGHT, START.y + dir.y * TOWER_HALF);
  const b = new THREE.Vector3(END.x, END_HEIGHT, END.y);

  // Sampled cable with arc length, so the seat moves at a true speed.
  const pts: THREE.Vector3[] = [];
  const lengths: number[] = [0];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const p = a.clone().lerp(b, t);
    p.y -= SAG * 4 * t * (1 - t);
    if (i > 0) lengths.push(lengths[i - 1] + p.distanceTo(pts[i - 1]));
    pts.push(p);
  }
  const total = lengths[SAMPLES];
  const pointAt = (u: number, out: THREE.Vector3) => {
    const d = THREE.MathUtils.clamp(u, 0, total);
    let i = 1;
    while (i < SAMPLES && lengths[i] < d) i++;
    const f = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return out.copy(pts[i - 1]).lerp(pts[i], f);
  };

  const cable = new THREE.Mesh(
    track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.018, 4, false)),
    track(new THREE.MeshBasicMaterial({ color: '#5d5753' })),
  );

  const tower = new THREE.Mesh(track(createTower()), propMaterial);
  tower.position.set(START.x, 0, START.y);
  tower.rotation.y = yaw;
  const frame = new THREE.Mesh(track(createEndFrame()), propMaterial);
  frame.position.set(END.x, 0, END.y);
  frame.rotation.y = yaw;

  // Collision: the tower as one round footprint, and the two posts of the end frame.
  const side = new THREE.Vector2(dir.y, -dir.x);
  const colliders = [
    { x: START.x, z: START.y, r: TOWER_HALF * 1.45 },
    { x: END.x + side.x * 0.95, z: END.y + side.y * 0.95, r: 0.14 },
    { x: END.x - side.x * 0.95, z: END.y - side.y * 0.95, r: 0.14 },
  ];

  // Keep trees and rocks out from under the cable, around the tower, and past the end frame.
  const from = START.clone().addScaledVector(dir, -3);
  const span = START.distanceTo(END) + 6;
  const reserved = (x: number, z: number, margin: number) => {
    const t = THREE.MathUtils.clamp((x - from.x) * dir.x + (z - from.y) * dir.y, 0, span);
    return Math.hypot(x - (from.x + dir.x * t), z - (from.y + dir.y * t)) < 2.6 + margin;
  };

  return {
    objects: [tower, frame, cable],
    colliders,
    reserved,
    boardSpot: START.clone().addScaledVector(dir, -(TOWER_HALF + 0.9)), // at the ladder side
    rideStart: 0.35,
    rideEnd: total - 0.9,
    direction: dir,
    pointAt,
  };
}

/**
 * Wooden tower, built facing +z (the cable side): four posts, a deck at seat level with rails
 * on three sides, a ladder at the back, and two tall posts with a beam holding the cable.
 */
function createTower(): THREE.BufferGeometry {
  const h = TOWER_HALF;
  const parts: THREE.BufferGeometry[] = [];
  const dark = '#7d6655';
  const wood = '#a98d74';
  for (const x of [-h, h]) {
    for (const z of [-h, h]) parts.push(box(0.14, DECK + 1.0, 0.14, x, (DECK + 1.0) / 2, z, dark));
  }
  // Cross braces on the sides, for a sturdy look.
  for (const x of [-h, h]) {
    for (const y of [DECK * 0.33, DECK * 0.66]) parts.push(box(0.06, 0.08, h * 2, x, y, 0, wood));
  }
  // Deck.
  const planks = 7;
  for (let i = 0; i < planks; i++) {
    const z = -h + (h * 2 * (i + 0.5)) / planks;
    parts.push(box(h * 2 + 0.2, 0.07, (h * 2) / planks - 0.03, 0, DECK, z, i % 3 === 0 ? '#8f735d' : wood));
  }
  // Rails on the back and both sides (the front, toward the cable, is open).
  const railY = DECK + 0.9;
  parts.push(box(h * 2, 0.07, 0.07, 0, railY, -h, wood));
  for (const x of [-h, h]) parts.push(box(0.07, 0.07, h * 2, x, railY, 0, wood));
  // Ladder at the back.
  for (const x of [-0.25, 0.25]) parts.push(box(0.07, DECK + 0.4, 0.07, x, (DECK + 0.4) / 2, -h - 0.12, dark));
  for (let y = 0.35; y < DECK + 0.2; y += 0.35) parts.push(box(0.5, 0.05, 0.05, 0, y, -h - 0.12, wood));
  // Tall front posts and the cable beam.
  const top = START_HEIGHT + 0.15;
  for (const x of [-h, h]) parts.push(box(0.14, top - DECK - 1.0, 0.14, x, (top + DECK + 1.0) / 2, h, dark));
  parts.push(box(h * 2 + 0.2, 0.14, 0.16, 0, top, h, dark));
  return merge(parts);
}

/** End frame near the dock: two posts and a crossbeam where the cable is tied off. */
function createEndFrame(): THREE.BufferGeometry {
  const top = END_HEIGHT + 0.12;
  return merge([
    box(0.14, top, 0.14, -0.95, top / 2, 0, '#7d6655'),
    box(0.14, top, 0.14, 0.95, top / 2, 0, '#7d6655'),
    box(2.1, 0.14, 0.16, 0, top, 0, '#7d6655'),
    // A soft straw mat underneath, where riders step down.
    box(1.4, 0.04, 1.6, 0, 0.02, -0.9, '#e0cf9a'),
  ]);
}
