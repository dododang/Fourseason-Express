// The train car model: an open wooden interior with wide windows and big sliding doors,
// plus a painted exterior shell and roof. Local frame: the car runs along x, the floor is y = 0.
import * as THREE from 'three';
import { box, merge, propMaterial, type Track } from './lowpoly';

// Interior palette: warm wood and cream, a contrast to the cold blue-white outside.
const FLOOR = '#8a6a52';
const FLOOR_DARK = '#816350';
const RUNNER = '#9a5f5a';
const WALL_LOW = '#7b5a46';
const WALL_HIGH = '#efe4d2';
const CEILING = '#f4ecdf';
const FRAME = '#5e4636';
const BRASS = '#c9a96a';
// Exterior: deep teal below, cream above, dark roof.
const EXT_LOW = '#3f6265';
const EXT_HIGH = '#ece2cf';
const ROOF = '#4b4f55';
const DOOR = '#5b7f80';

export const CAR_HALF_LENGTH = 11;
export const CAR_HALF_WIDTH = 2.1;
export const CAR_HEIGHT = 3.3;
export const CAR_WALL = 0.08;

// Openings in each side wall. Windows start low so the short character sees out at eye level.
export const WINDOW_BOTTOM = 0.5;
export const WINDOW_TOP = 2.05;
export const WINDOW_WIDTH = 1.6;
// Each door needs clear wall on both sides for its leaves to slide over, so windows keep away.
export const WINDOWS = [-9.8, -3.15, -1.05, 1.05, 3.15, 9.8];
export const DOOR_WIDTH = 2.5;
export const DOOR_HEIGHT = 2.9;
export const DOORS = [-6.5, 6.5]; // door centers along x

interface Opening {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const OPENINGS: Opening[] = [
  ...WINDOWS.map((c) => ({ x0: c - WINDOW_WIDTH / 2, x1: c + WINDOW_WIDTH / 2, y0: WINDOW_BOTTOM, y1: WINDOW_TOP })),
  ...DOORS.map((c) => ({ x0: c - DOOR_WIDTH / 2, x1: c + DOOR_WIDTH / 2, y0: 0, y1: DOOR_HEIGHT })),
];

/** A side wall with rectangular openings: solid pieces fill everything else. */
function buildSideWall(
  parts: THREE.BufferGeometry[],
  z: number,
  thickness: number,
  low: string,
  high: string,
): void {
  const L = CAR_HALF_LENGTH;
  const xs = [...new Set([-L, L, ...OPENINGS.flatMap((o) => [o.x0, o.x1])])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    const mid = (a + b) / 2;
    const hole = OPENINGS.find((o) => mid > o.x0 && mid < o.x1);
    const spans = hole ? [[0, hole.y0], [hole.y1, CAR_HEIGHT]] : [[0, CAR_HEIGHT]];
    for (const [y0, y1] of spans) {
      if (y1 - y0 < 0.001) continue;
      // Lower band dark, upper band light, split at the window sill height.
      const split = WINDOW_BOTTOM;
      if (y0 < split && y1 > split) {
        parts.push(box(b - a, split - y0, thickness, mid, (y0 + split) / 2, z, low));
        parts.push(box(b - a, y1 - split, thickness, mid, (split + y1) / 2, z, high));
      } else {
        parts.push(box(b - a, y1 - y0, thickness, mid, (y0 + y1) / 2, z, y1 <= split ? low : high));
      }
    }
  }
}

export interface TrainCar {
  group: THREE.Group;
  /** 0 = closed, 1 = fully open. Only the doors on `openSide` move. */
  setDoorOpen: (t: number) => void;
}

/** `openSide`: -1 opens the doors on the -z side (toward the platform), +1 the +z side. */
export function createTrainCar(track: Track, openSide: -1 | 1): TrainCar {
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const L = CAR_HALF_LENGTH * 2;
  const W = CAR_HALF_WIDTH;

  // Floor planks along the car, a runner down the middle, and a dark undercarriage.
  const planks = 14;
  for (let i = 0; i < planks; i++) {
    const z = -W + (W * 2 * (i + 0.5)) / planks;
    parts.push(box(L, 0.05, (W * 2) / planks - 0.02, 0, -0.025, z, i % 2 ? FLOOR : FLOOR_DARK));
  }
  parts.push(box(L - 0.4, 0.012, 1.1, 0, 0.006, 0, RUNNER));
  parts.push(box(L - 0.6, 0.08, W * 2 - 0.3, 0, -0.09, 0, '#3a3633'));

  for (const side of [-1, 1]) {
    const z = side * W;
    buildSideWall(parts, z, CAR_WALL, WALL_LOW, WALL_HIGH);
    buildSideWall(parts, side * (W + 0.046), 0.012, EXT_LOW, EXT_HIGH); // exterior paint

    for (const c of WINDOWS) {
      parts.push(box(WINDOW_WIDTH + 0.08, 0.06, 0.16, c, WINDOW_BOTTOM, z - side * 0.04, FRAME));
      parts.push(box(WINDOW_WIDTH + 0.08, 0.05, 0.1, c, WINDOW_TOP, z - side * 0.02, FRAME));
      for (const dx of [-WINDOW_WIDTH / 2, WINDOW_WIDTH / 2]) {
        parts.push(box(0.05, WINDOW_TOP - WINDOW_BOTTOM, 0.1, c + dx, (WINDOW_BOTTOM + WINDOW_TOP) / 2, z - side * 0.02, FRAME));
      }
    }
    for (const c of DOORS) {
      parts.push(box(DOOR_WIDTH + 0.12, 0.08, 0.14, c, DOOR_HEIGHT, z, FRAME));
      for (const dx of [-DOOR_WIDTH / 2, DOOR_WIDTH / 2]) {
        parts.push(box(0.06, DOOR_HEIGHT, 0.14, c + dx, DOOR_HEIGHT / 2, z, FRAME));
      }
      parts.push(box(DOOR_WIDTH, 0.015, 0.3, c, 0.008, z - side * 0.1, BRASS));
    }
  }

  // End walls, inside and out.
  for (const end of [-1, 1]) {
    const x = end * CAR_HALF_LENGTH;
    parts.push(box(CAR_WALL, CAR_HEIGHT, W * 2, x, CAR_HEIGHT / 2, 0, WALL_HIGH));
    parts.push(box(CAR_WALL, WINDOW_BOTTOM, W * 2, x - end * 0.01, WINDOW_BOTTOM / 2, 0, WALL_LOW));
    parts.push(box(0.04, 2.1, 0.95, x - end * 0.05, 1.05, 0, FRAME));
    parts.push(box(0.03, 0.55, 0.55, x - end * 0.07, 1.5, 0, '#cfd9e3'));
    parts.push(box(0.012, CAR_HEIGHT - WINDOW_BOTTOM, W * 2 + 0.1, x + end * 0.046, (CAR_HEIGHT + WINDOW_BOTTOM) / 2, 0, EXT_HIGH));
    parts.push(box(0.012, WINDOW_BOTTOM, W * 2 + 0.1, x + end * 0.046, WINDOW_BOTTOM / 2, 0, EXT_LOW));
  }

  // Ceiling inside, roof outside.
  parts.push(box(L, 0.06, W * 2, 0, CAR_HEIGHT + 0.03, 0, CEILING));
  parts.push(box(L + 0.12, 0.14, W * 2 + 0.16, 0, CAR_HEIGHT + 0.13, 0, ROOF));
  group.add(new THREE.Mesh(track(merge(parts)), propMaterial));

  // Warm light strips (always-bright color, no real lights).
  const glowMat = track(new THREE.MeshBasicMaterial({ color: '#fff1d6' }));
  for (const z of [-0.7, 0.7]) {
    const strip = new THREE.Mesh(track(new THREE.BoxGeometry(L - 1.2, 0.03, 0.14)), glowMat);
    strip.position.set(0, CAR_HEIGHT - 0.015, z);
    group.add(strip);
  }

  // Sliding door leaves: two per doorway, sliding apart along the outside of the wall.
  const leafWidth = DOOR_WIDTH / 2;
  const leafGeo = track(
    merge([
      box(leafWidth - 0.02, DOOR_HEIGHT - 0.04, 0.05, 0, DOOR_HEIGHT / 2, 0, DOOR),
      box(leafWidth * 0.55, 0.7, 0.06, 0, 1.45, 0, '#d6e0e8'), // small window in the leaf
    ]),
  );
  const leaves: { x: number; z: number; dir: number; moves: boolean }[] = [];
  for (const side of [-1, 1]) {
    for (const c of DOORS) {
      const z = side * (W + 0.09); // just outside the exterior paint
      const moves = side === openSide;
      leaves.push({ x: c - leafWidth / 2, z, dir: -1, moves }, { x: c + leafWidth / 2, z, dir: 1, moves });
    }
  }
  const doorMesh = new THREE.InstancedMesh(leafGeo, propMaterial, leaves.length);
  doorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(doorMesh);
  const m = new THREE.Matrix4();
  let last = -1;
  const setDoorOpen = (t: number) => {
    if (t === last) return;
    last = t;
    leaves.forEach((l, i) => {
      const open = l.moves ? t : 0;
      doorMesh.setMatrixAt(i, m.makeTranslation(l.x + l.dir * leafWidth * open, 0, l.z));
    });
    doorMesh.instanceMatrix.needsUpdate = true;
  };
  setDoorOpen(0);

  return { group, setDoorOpen };
}
