// The train car model: an open wooden interior with wide windows and big sliding doors,
// plus a painted exterior shell and roof. Local frame: the car runs along x, the floor is y = 0.
import * as THREE from 'three';
import { box, merge, paint, propMaterial, type Track } from './lowpoly';

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
const ROOF_LIGHT = '#5a5f66';
const IRON = '#3d3f44';
const LAMP = '#ffe3ad'; // always-bright warm color (no real lights)

/** Open platform at the back end of the car, outside the end wall. */
export const BALCONY_DEPTH = 1.6;
/** Driver's cab at the front end, outside the end wall. */
export const CAB_LENGTH = 2.6;
const GLASS = '#a9bfcd';
const GLASS_SHINE = '#d7e3ea';
const BUFFER = '#8a4a3e';
/** The body paint stops this high; below it a dark skirt hides the wheels. */
const SKIRT_TOP = 0.22;
const SKIRT = '#2f3236';
const WHEEL = '#26282c';
const HUB = '#7d828a';
const GROUND = -0.12; // ground level in car coordinates: the floor sits at platform height (PLATFORM.height)

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
  yStart = 0,
): void {
  const L = CAR_HALF_LENGTH;
  const xs = [...new Set([-L, L, ...OPENINGS.flatMap((o) => [o.x0, o.x1])])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    const mid = (a + b) / 2;
    const hole = OPENINGS.find((o) => mid > o.x0 && mid < o.x1);
    const spans = hole ? [[0, hole.y0], [hole.y1, CAR_HEIGHT]] : [[0, CAR_HEIGHT]];
    for (const [y0Raw, y1] of spans) {
      const y0 = Math.max(y0Raw, yStart);
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
    buildSideWall(parts, side * (W + 0.046), 0.012, EXT_LOW, EXT_HIGH, SKIRT_TOP); // exterior paint

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

  // Skirt below the body paint (gaps at the doorways, with a step), a lip where the body
  // overhangs it, and two bogies of wheels showing in front of it near each end.
  addSkirt(parts, W);

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

  // The two ends: a driver's cab at the front (+x, the direction of travel) and an open
  // balcony at the back. Each end door inside the car leads to one of them. Decorative only.
  addCab(parts, W);
  addBalcony(parts, W);

  // Ceiling inside; outside, one roof from the cab front over the back balcony, with a raised middle.
  const roofFront = CAR_HALF_LENGTH + CAB_LENGTH + 0.06;
  const roofBack = -CAR_HALF_LENGTH - BALCONY_DEPTH - 0.06;
  const roofLength = roofFront - roofBack;
  const roofMid = (roofFront + roofBack) / 2;
  parts.push(box(L, 0.06, W * 2, 0, CAR_HEIGHT + 0.03, 0, CEILING));
  parts.push(box(roofLength, 0.12, W * 2 + 0.24, roofMid, CAR_HEIGHT + 0.12, 0, ROOF));
  parts.push(box(roofLength - 0.3, 0.08, W * 2 - 0.3, roofMid, CAR_HEIGHT + 0.22, 0, ROOF_LIGHT));
  parts.push(box(L - 2.5, 0.22, W * 1.05, 0, CAR_HEIGHT + 0.37, 0, ROOF));
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

/** A painted box turned around the vertical axis (for the cab's cut-off front corners). */
function turnedBox(w: number, h: number, d: number, x: number, y: number, z: number, yaw: number, color: string) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(yaw);
  g.translate(x, y, z);
  return paint(g, color, { min: 0.72 });
}

/**
 * Driver's cab at +x: the car body carries on for CAB_LENGTH with a blunt, chamfered nose,
 * three big front windows, a round headlight and small side windows. It has no outside door.
 */
function addCab(parts: THREE.BufferGeometry[], W: number): void {
  const x0 = CAR_HALF_LENGTH;
  const at = (d: number) => x0 + d; // d meters forward of the end wall
  const C = CAB_LENGTH;
  const cut = 0.55; // chamfer at the front corners
  const body = C - cut; // straight part of the cab sides
  const split = WINDOW_BOTTOM; // teal below, cream above, as on the car
  const band = (x: number, len: number, z: number, wid: number) => {
    parts.push(box(len, split - SKIRT_TOP, wid, x, (split + SKIRT_TOP) / 2, z, EXT_LOW));
    parts.push(box(len, CAR_HEIGHT - split, wid, x, (CAR_HEIGHT + split) / 2, z, EXT_HIGH));
    // Skirt underneath, a little narrower so the body overhangs it.
    parts.push(box(len, SKIRT_TOP - GROUND, wid - 0.06, x, (SKIRT_TOP + GROUND) / 2, z, SKIRT));
  };

  // Body: full-width straight part, then a narrower nose with the corners cut at 45 degrees.
  band(at(body / 2), body, 0, W * 2 + 0.1);
  const noseHalf = W - cut;
  band(at(body + cut / 2), cut, 0, noseHalf * 2);
  const diag = Math.SQRT2 * cut;
  for (const side of [-1, 1]) {
    const cx = at(body + cut / 2);
    const cz = side * (W - cut / 2);
    const yaw = side * Math.PI / 4;
    parts.push(turnedBox(diag, split - SKIRT_TOP, 0.12, cx, (split + SKIRT_TOP) / 2, cz, yaw, EXT_LOW));
    parts.push(turnedBox(diag, SKIRT_TOP - GROUND, 0.12, cx - 0.03, (SKIRT_TOP + GROUND) / 2, cz - side * 0.03, yaw, SKIRT));
    parts.push(turnedBox(diag, CAR_HEIGHT - split, 0.12, cx, (CAR_HEIGHT + split) / 2, cz, yaw, EXT_HIGH));
  }
  parts.push(box(C, 0.08, W * 2 - 0.3, at(C / 2), -0.09, 0, '#3a3633')); // undercarriage

  // Front windows: a wide middle pane and one on each chamfer, with frames and a shine stripe.
  const front = at(C) + 0.01;
  const winY = 1.75;
  const winH = 0.95;
  parts.push(box(0.04, winH, noseHalf * 2 - 0.3, front, winY, 0, GLASS));
  parts.push(box(0.05, winH + 0.1, 0.07, front + 0.01, winY, 0, FRAME)); // middle mullion
  parts.push(box(0.05, 0.07, noseHalf * 2 - 0.2, front + 0.01, winY + winH / 2, 0, FRAME));
  parts.push(box(0.05, 0.07, noseHalf * 2 - 0.2, front + 0.01, winY - winH / 2, 0, FRAME));
  parts.push(box(0.045, 0.06, 0.5, front + 0.005, winY + 0.25, -0.45, GLASS_SHINE));
  parts.push(box(0.045, 0.06, 0.5, front + 0.005, winY + 0.25, 0.55, GLASS_SHINE));
  for (const side of [-1, 1]) {
    const cx = at(body + cut / 2) + 0.045;
    const cz = side * (W - cut / 2) + side * 0.045;
    parts.push(turnedBox(diag - 0.25, winH, 0.04, cx, winY, cz, side * Math.PI / 4, GLASS));
  }
  // Wiper resting on the middle pane.
  parts.push(turnedBox(0.03, 0.03, 0.7, front + 0.03, winY - 0.25, 0.3, 0, IRON));

  // Headlight above the windows, two small lamps low on the nose, and a name board.
  const lamp = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10);
  lamp.rotateZ(Math.PI / 2);
  lamp.translate(front + 0.06, 2.75, 0);
  parts.push(paint(lamp, LAMP, { min: 0.9 }));
  parts.push(box(0.08, 0.5, 0.5, front + 0.02, 2.75, 0, IRON));
  for (const side of [-1, 1]) {
    parts.push(box(0.08, 0.16, 0.22, front + 0.04, 0.85, side * (noseHalf - 0.35), LAMP));
  }
  // Buffer beam and a low guard plate at the very front.
  parts.push(box(0.16, 0.16, noseHalf * 2 + 0.3, front + 0.08, 0.06, 0, BUFFER));
  parts.push(box(0.1, 0.1, noseHalf * 2, front + 0.18, -0.06, 0, IRON));

  // Two side windows on each side. No outside door: the cab is reached from inside the car.
  for (const side of [-1, 1]) {
    const z = side * (W + 0.06);
    for (const cx of [0.65, 1.55]) {
      parts.push(box(0.75, 0.75, 0.03, at(cx), 1.85, z, GLASS));
      parts.push(box(0.85, 0.06, 0.04, at(cx), 2.25, z + side * 0.005, FRAME));
      parts.push(box(0.85, 0.06, 0.04, at(cx), 1.45, z + side * 0.005, FRAME));
    }
  }
}

/** Open balcony at -x: a deep wooden deck with an iron railing, the end door opening onto it. */
function addBalcony(parts: THREE.BufferGeometry[], W: number): void {
  const x0 = -CAR_HALF_LENGTH;
  const out = (d: number) => x0 - d; // d meters out from the end wall
  const deck = BALCONY_DEPTH;
  const planks = 6;
  for (let i = 0; i < planks; i++) {
    const d = (deck * (i + 0.5)) / planks;
    parts.push(box(deck / planks - 0.02, 0.06, W * 2 - 0.1, out(d), -0.03, 0, i % 2 ? FLOOR : FLOOR_DARK));
  }
  parts.push(box(0.14, 0.1, W * 2 + 0.05, out(deck - 0.05), -0.07, 0, '#4a3830'));
  parts.push(box(deck, 0.08, W * 2 - 0.4, out(deck / 2), -0.1, 0, '#3a3633'));

  // Exterior end door, matching the one inside: frame, panel, window, handle.
  parts.push(box(0.03, 2.15, 1.05, out(0.06), 1.075, 0, FRAME));
  parts.push(box(0.04, 2.05, 0.92, out(0.08), 1.03, 0, DOOR));
  parts.push(box(0.03, 0.55, 0.55, out(0.1), 1.5, 0, '#cfd9e3'));
  parts.push(box(0.03, 0.05, 0.1, out(0.11), 1.0, 0.33, BRASS));

  // Railing: corner posts up to the roof, rails along both sides and across the back.
  const rx = deck - 0.06;
  for (const side of [-1, 1]) {
    const z = side * (W - 0.08);
    parts.push(box(0.08, CAR_HEIGHT + 0.06, 0.08, out(rx), (CAR_HEIGHT + 0.06) / 2, z, IRON));
    parts.push(box(0.07, CAR_HEIGHT + 0.06, 0.07, out(0.04), (CAR_HEIGHT + 0.06) / 2, z, IRON));
    parts.push(box(deck, 0.05, 0.05, out(deck / 2), 1.0, z, IRON));
    parts.push(box(deck, 0.04, 0.04, out(deck / 2), 0.5, z, IRON));
    for (let d = 0.3; d < rx - 0.1; d += 0.3) parts.push(box(0.03, 1.0, 0.03, out(d), 0.5, z, IRON));
  }
  parts.push(box(0.05, 0.05, W * 2 - 0.16, out(rx), 1.0, 0, IRON));
  parts.push(box(0.04, 0.04, W * 2 - 0.16, out(rx), 0.5, 0, IRON));
  for (let z = -W + 0.45; z <= W - 0.44; z += 0.37) parts.push(box(0.03, 1.0, 0.03, out(rx), 0.5, z, IRON));

  // Lantern over the door, marker lamps at the upper corners, and a tail lamp at the back rail.
  parts.push(box(0.12, 0.08, 0.3, out(0.07), 2.45, 0, IRON));
  parts.push(box(0.14, 0.22, 0.22, out(0.12), 2.3, 0, LAMP));
  for (const side of [-1, 1]) parts.push(box(0.1, 0.14, 0.14, out(0.06), 2.9, side * (W - 0.25), LAMP));
  parts.push(box(0.1, 0.16, 0.16, out(rx + 0.06), 1.12, W - 0.3, '#e0705f'));
}

/**
 * Skirt along both sides under the body paint, with gaps (and a step) at the doorways, a lip
 * where the body overhangs, and two bogies of wheels near the ends showing in front of it.
 */
function addSkirt(parts: THREE.BufferGeometry[], W: number): void {
  const L = CAR_HALF_LENGTH;
  const h = SKIRT_TOP - GROUND;
  const y = (SKIRT_TOP + GROUND) / 2;
  const gaps = DOORS.map((c) => [c - DOOR_WIDTH / 2, c + DOOR_WIDTH / 2]);
  const cuts = [-L, ...gaps.flat(), L];
  for (const side of [-1, 1]) {
    const z = side * (W + 0.03);
    for (let i = 0; i < cuts.length - 1; i += 2) {
      const a = cuts[i];
      const b = cuts[i + 1];
      parts.push(box(b - a, h, 0.03, (a + b) / 2, y, z, SKIRT));
    }
    // Lip: the body's lower edge sticks out a little over the skirt, reading as a shadow line.
    parts.push(box(L * 2, 0.05, 0.06, 0, SKIRT_TOP + 0.02, side * (W + 0.07), EXT_LOW));
    for (const c of DOORS) parts.push(box(DOOR_WIDTH - 0.2, 0.05, 0.22, c, -0.06, side * (W + 0.12), IRON));

    // Bogies: a dark frame with two wheels each, near both ends.
    for (const bx of [-(L - 1.5), L - 1.5]) {
      parts.push(box(1.7, 0.12, 0.05, bx, 0.12, side * (W + 0.1), SKIRT));
      for (const wx of [-0.55, 0.55]) {
        const wheel = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12);
        wheel.rotateX(Math.PI / 2);
        wheel.translate(bx + wx, GROUND + 0.2, side * (W + 0.1));
        parts.push(paint(wheel, WHEEL, { min: 0.8 }));
        const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.08, 8);
        hub.rotateX(Math.PI / 2);
        hub.translate(bx + wx, GROUND + 0.2, side * (W + 0.11));
        parts.push(paint(hub, HUB, { min: 0.8 }));
      }
    }
  }
}
