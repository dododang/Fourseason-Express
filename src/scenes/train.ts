// Train interior: a long open wooden car with wide windows and big sliding doors.
// The car stays still while the scenery outside scrolls past; the car runs along x.
// A simple stop/run cycle drives the doors (open only while stopped) and the scenery speed.
import * as THREE from 'three';
import { box, cylinder, merge, propMaterial, seededRandom } from './lowpoly';
import { createMountains, createPineGeometry, createSky, type Track } from './winter';
import type { Zone } from './zone';

// Interior palette: warm wood and cream, a contrast to the cold blue-white outside.
const FLOOR = '#8a6a52';
const FLOOR_DARK = '#816350';
const RUNNER = '#9a5f5a';
const WALL_LOW = '#7b5a46';
const WALL_HIGH = '#efe4d2';
const CEILING = '#f4ecdf';
const FRAME = '#5e4636';
const DOOR = '#6d8f8a';
const BRASS = '#c9a96a';
const SNOW = '#f8fafd';

// Car dimensions (meters).
export const TRAIN_HALF_LENGTH = 11;
export const TRAIN_HALF_WIDTH = 2.1;
const HEIGHT = 3.3;
const WALL = 0.08;

// Openings in each side wall. Windows start low so the short character sees out at eye level.
const WINDOW_BOTTOM = 0.5;
const WINDOW_TOP = 2.05;
const WINDOW_WIDTH = 1.6;
// Each door needs clear wall on both sides for its leaves to slide over, so windows keep away.
const WINDOWS = [-9.8, -3.15, -1.05, 1.05, 3.15, 9.8];
const DOOR_WIDTH = 2.5;
const DOOR_HEIGHT = 2.9;
export const DOORS = [-6.5, 6.5]; // door centers along x, on both sides

// Stop / run cycle (seconds) and cruising speed.
const SPEED = 12; // m/s
const CYCLE = { stopped: 20, closing: 2.5, departing: 8, running: 40, arriving: 10, opening: 2.5 } as const;
type Phase = keyof typeof CYCLE;
const ORDER: Phase[] = ['stopped', 'closing', 'departing', 'running', 'arriving', 'opening'];

const CHUNK = 120; // scenery is built in two chunks that leapfrog each other

export interface TrainZone extends Zone {
  /** 0 = closed, 1 = fully open. */
  readonly doorOpen: number;
  readonly phase: Phase;
}

export function buildTrainScene(scene: THREE.Scene): TrainZone {
  const disposables: { dispose: () => void }[] = [];
  const track: Track = (d) => {
    disposables.push(d);
    return d;
  };
  const rand = seededRandom(7);

  const horizon = new THREE.Color('#e3e9f0');
  scene.background = horizon;
  scene.fog = new THREE.Fog(horizon, 25, 110);

  scene.add(createSky(track), createMountains(track, rand), createOutsideGround(track));
  scene.add(createCar(track));
  const doors = createDoorLeaves(track);
  scene.add(doors.mesh);

  const pineGeo = track(createPineGeometry());
  const chunks = [0, 1].map((i) => {
    const chunk = createSceneryChunk(track, pineGeo, rand);
    chunk.position.x = i * CHUNK;
    scene.add(chunk);
    return chunk;
  });

  let phaseIndex = 0;
  let phaseTime = 0;
  let doorOpen = 1;
  let speed = 0;

  const constrain = (p: THREE.Vector3, r: number): void => {
    // Doors lead nowhere yet in this test scene, so stay inside even when they are open.
    p.x = THREE.MathUtils.clamp(p.x, -TRAIN_HALF_LENGTH + WALL + r, TRAIN_HALF_LENGTH - WALL - r);
    p.z = THREE.MathUtils.clamp(p.z, -TRAIN_HALF_WIDTH + WALL + r, TRAIN_HALF_WIDTH - WALL - r);
  };

  const zone: TrainZone = {
    spawn: new THREE.Vector3(-2, 0, 0),
    viewYaw: -Math.PI / 2, // camera toward -x, player looks down the car toward +x
    snowfall: false,
    cameraBounds: new THREE.Box3(
      new THREE.Vector3(-TRAIN_HALF_LENGTH + 0.2, 0.4, -TRAIN_HALF_WIDTH + 0.15),
      new THREE.Vector3(TRAIN_HALF_LENGTH - 0.2, HEIGHT - 0.12, TRAIN_HALF_WIDTH - 0.15),
    ),
    get doorOpen() {
      return doorOpen;
    },
    get phase() {
      return ORDER[phaseIndex];
    },
    heightAt: () => 0,
    surfaceAt: () => 'wood',
    constrain,
    update: (dt) => {
      phaseTime += dt;
      const phase = ORDER[phaseIndex];
      const t = Math.min(phaseTime / CYCLE[phase], 1);
      const ease = t * t * (3 - 2 * t);

      switch (phase) {
        case 'stopped':
          speed = 0;
          doorOpen = 1;
          break;
        case 'closing':
          doorOpen = 1 - ease;
          break;
        case 'departing':
          speed = SPEED * ease;
          break;
        case 'running':
          speed = SPEED;
          break;
        case 'arriving':
          speed = SPEED * (1 - ease);
          break;
        case 'opening':
          speed = 0;
          doorOpen = ease;
          break;
      }
      if (t >= 1) {
        phaseIndex = (phaseIndex + 1) % ORDER.length;
        phaseTime = 0;
      }

      doors.setOpen(doorOpen);
      for (const c of chunks) {
        c.position.x -= speed * dt;
        if (c.position.x < -CHUNK * 1.5) c.position.x += CHUNK * 2;
      }
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
  return zone;
}

interface Opening {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A side wall with rectangular openings: solid pieces fill everything else. */
function buildSideWall(parts: THREE.BufferGeometry[], z: number, openings: Opening[]): void {
  const L = TRAIN_HALF_LENGTH;
  const xs = [...new Set([-L, L, ...openings.flatMap((o) => [o.x0, o.x1])])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    const mid = (a + b) / 2;
    const hole = openings.find((o) => mid > o.x0 && mid < o.x1);
    const spans = hole ? [[0, hole.y0], [hole.y1, HEIGHT]] : [[0, HEIGHT]];
    for (const [y0, y1] of spans) {
      if (y1 - y0 < 0.001) continue;
      // Lower band in dark wood, upper in cream, split at the window sill height.
      const split = WINDOW_BOTTOM;
      if (y0 < split && y1 > split) {
        parts.push(box(b - a, split - y0, WALL, mid, (y0 + split) / 2, z, WALL_LOW));
        parts.push(box(b - a, y1 - split, WALL, mid, (split + y1) / 2, z, WALL_HIGH));
      } else {
        parts.push(box(b - a, y1 - y0, WALL, mid, (y0 + y1) / 2, z, y1 <= split ? WALL_LOW : WALL_HIGH));
      }
    }
  }
}

// The car body: floor, walls with window and door openings, and ceiling lights.
function createCar(track: Track): THREE.Group {
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const L = TRAIN_HALF_LENGTH * 2;
  const W = TRAIN_HALF_WIDTH;

  // Floor planks along the car, with a runner down the middle.
  const planks = 14;
  for (let i = 0; i < planks; i++) {
    const z = -W + (W * 2 * (i + 0.5)) / planks;
    parts.push(box(L, 0.05, (W * 2) / planks - 0.02, 0, -0.025, z, i % 2 ? FLOOR : FLOOR_DARK));
  }
  parts.push(box(L - 0.4, 0.012, 1.1, 0, 0.006, 0, RUNNER));

  const openings: Opening[] = [
    ...WINDOWS.map((c) => ({ x0: c - WINDOW_WIDTH / 2, x1: c + WINDOW_WIDTH / 2, y0: WINDOW_BOTTOM, y1: WINDOW_TOP })),
    ...DOORS.map((c) => ({ x0: c - DOOR_WIDTH / 2, x1: c + DOOR_WIDTH / 2, y0: 0, y1: DOOR_HEIGHT })),
  ];

  for (const side of [-1, 1]) {
    const z = side * W;
    buildSideWall(parts, z, openings);

    // Window frames and sills.
    for (const c of WINDOWS) {
      parts.push(box(WINDOW_WIDTH + 0.08, 0.06, 0.16, c, WINDOW_BOTTOM, z - side * 0.04, FRAME));
      parts.push(box(WINDOW_WIDTH + 0.08, 0.05, 0.1, c, WINDOW_TOP, z - side * 0.02, FRAME));
      for (const dx of [-WINDOW_WIDTH / 2, WINDOW_WIDTH / 2]) {
        parts.push(box(0.05, WINDOW_TOP - WINDOW_BOTTOM, 0.1, c + dx, (WINDOW_BOTTOM + WINDOW_TOP) / 2, z - side * 0.02, FRAME));
      }
    }
    // Door frames and a brass step plate at the threshold.
    for (const c of DOORS) {
      parts.push(box(DOOR_WIDTH + 0.12, 0.08, 0.14, c, DOOR_HEIGHT, z, FRAME));
      for (const dx of [-DOOR_WIDTH / 2, DOOR_WIDTH / 2]) {
        parts.push(box(0.06, DOOR_HEIGHT, 0.14, c + dx, DOOR_HEIGHT / 2, z, FRAME));
      }
      parts.push(box(DOOR_WIDTH, 0.015, 0.3, c, 0.008, z - side * 0.1, BRASS));
    }
  }

  // End walls.
  for (const end of [-1, 1]) {
    const x = end * TRAIN_HALF_LENGTH;
    parts.push(box(WALL, HEIGHT, W * 2, x, HEIGHT / 2, 0, WALL_HIGH));
    parts.push(box(WALL, WINDOW_BOTTOM, W * 2, x - end * 0.01, WINDOW_BOTTOM / 2, 0, WALL_LOW));
    parts.push(box(0.04, 2.1, 0.95, x - end * 0.05, 1.05, 0, FRAME));
    parts.push(box(0.03, 0.55, 0.55, x - end * 0.07, 1.5, 0, '#cfd9e3'));
  }

  // Ceiling and two warm light strips (always-bright color, no real lights).
  parts.push(box(L, 0.06, W * 2, 0, HEIGHT + 0.03, 0, CEILING));
  group.add(new THREE.Mesh(track(merge(parts)), propMaterial));

  const glowMat = track(new THREE.MeshBasicMaterial({ color: '#fff1d6' }));
  for (const z of [-0.7, 0.7]) {
    const strip = new THREE.Mesh(track(new THREE.BoxGeometry(L - 1.2, 0.03, 0.14)), glowMat);
    strip.position.set(0, HEIGHT - 0.015, z);
    group.add(strip);
  }
  return group;
}

/** Sliding door leaves: two per doorway, sliding apart along the outside of the wall. */
function createDoorLeaves(track: Track): { mesh: THREE.InstancedMesh; setOpen: (t: number) => void } {
  const leafWidth = DOOR_WIDTH / 2;
  const geo = track(
    merge([
      box(leafWidth - 0.02, DOOR_HEIGHT - 0.04, 0.05, 0, DOOR_HEIGHT / 2, 0, DOOR),
      box(leafWidth * 0.55, 0.7, 0.06, 0, 1.45, 0, '#d6e0e8'), // small window in the leaf
    ]),
  );
  const leaves: { x: number; z: number; dir: number }[] = [];
  for (const side of [-1, 1]) {
    for (const c of DOORS) {
      const z = side * (TRAIN_HALF_WIDTH + 0.06); // just outside the wall
      leaves.push({ x: c - leafWidth / 2, z, dir: -1 }, { x: c + leafWidth / 2, z, dir: 1 });
    }
  }
  const mesh = new THREE.InstancedMesh(geo, propMaterial, leaves.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m = new THREE.Matrix4();
  let last = -1;
  const setOpen = (t: number) => {
    if (t === last) return;
    last = t;
    leaves.forEach((l, i) => mesh.setMatrixAt(i, m.makeTranslation(l.x + l.dir * leafWidth * t, 0, l.z)));
    mesh.instanceMatrix.needsUpdate = true;
  };
  setOpen(1);
  return { mesh, setOpen };
}

// Snowy ground outside, below the car floor (the car rides on an embankment).
function createOutsideGround(track: Track): THREE.Mesh {
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(400, 400)),
    track(new THREE.MeshBasicMaterial({ color: SNOW })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.9;
  return ground;
}

// One stretch of passing scenery: pines on both sides and telegraph poles along the track.
function createSceneryChunk(track: Track, pineGeo: THREE.BufferGeometry, rand: () => number): THREE.Group {
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const count = 90;
  const trees = new THREE.InstancedMesh(pineGeo, propMaterial, count);
  for (let i = 0; i < count; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    // More trees far away than close, so the near ones flick past without crowding the view.
    const dist = 8 + Math.pow(rand(), 0.7) * 55;
    p.set(rand() * CHUNK - CHUNK / 2, -0.9, side * dist);
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.setScalar(1.0 + rand() * 1.0);
    trees.setMatrixAt(i, m.compose(p, q, s));
  }
  group.add(trees);

  // Telegraph poles every 30 m on one side: the strongest cue of speed.
  const poleGeo = track(
    merge([cylinder(0.08, 6.5, 0, 3.25 - 0.9, 0, '#6b5848'), box(0.08, 0.08, 1.2, 0, 5.2 - 0.9, 0, '#6b5848')]),
  );
  const poles = new THREE.InstancedMesh(poleGeo, propMaterial, CHUNK / 30);
  for (let i = 0; i < CHUNK / 30; i++) {
    poles.setMatrixAt(i, m.makeTranslation(i * 30 - CHUNK / 2, 0, 5.2));
  }
  group.add(poles);
  return group;
}
