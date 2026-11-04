// A small stream winding through a station's village, with a wooden footbridge across it.
// The water is one flat ribbon whose texture slides slowly downstream (no lights, one draw
// call); the banks are a second, wider ribbon.
import * as THREE from 'three';
import { box, merge, paint, propMaterial, type Track } from './lowpoly';
import { createRockGeometry } from './props';

/**
 * Course of the stream (x, z), upstream first. Seen from above with the rails at the bottom:
 * it comes in at the back of the village a little left of center, bends down to the right,
 * passes above and to the right of the station, and leaves through the right edge.
 * Both ends lie beyond the tree line so the stream runs out into the forest.
 */
const COURSE: [number, number][] = [
  [-31, -84],
  [-30, -66],
  [-26, -58],
  [-16, -54],
  [-3, -51],
  [9, -47],
  [18, -41],
  [27, -35],
  [36, -33],
  [46, -33],
  [55, -30],
  [63, -24],
  [82, -14],
];
const BRIDGE_NEAR = new THREE.Vector2(24, -37.5); // on the diagonal stretch, up and right of the station
const STEP = 1; // centerline sample spacing (m)
const BANK = 0.85; // extra width of the bank strip on each side
const FLOW_SPEED = 0.35; // texture repeats per second along the stream
const TEXTURE_LENGTH = 5; // meters of stream per texture repeat
const BRIDGE_HALF_WIDTH = 1.2;
const ARCH_RISE = 1.75; // deck height at the middle; a seated rider in the boat passes underneath
const DOCK_NEAR = new THREE.Vector2(4, -49); // boat dock, upstream of the bridge
const LANDING_NEAR = new THREE.Vector2(46, -33); // where the boat ride ends, downstream
const PIER_INNER = 0.62; // pier deck starts this far from the centerline (the moored boat is half as wide)
const PIER_HALF_WIDTH = 0.7;
const PIER_HEIGHT = 0.2;
const PATH_START = new THREE.Vector2(0, -12); // where the straight path from the platform ends
const STATION_SIGN = new THREE.Vector2(3.2, -1.3); // beside the path, just behind the platform

/** Half the water width at sample k (samples are 1 m apart): gently wider and narrower along the way. */
function halfWidth(k: number): number {
  return 1.6 + 0.45 * Math.sin(0.13 * k + 0.4);
}

/** A small wooden pier reaching from the station-side bank to a boat moored mid-stream. */
export interface Pier {
  /** Distance along the stream (m) where the boat moors. */
  s: number;
  center: THREE.Vector2; // centerline point beside the pier
  normal: THREE.Vector2; // from the water toward the pier's bank
  tangent: THREE.Vector2; // downstream
  /** Where someone stepping off the boat stands. */
  stand: THREE.Vector2;
}

/** A signpost you can be carried from to its partner (with a soft fade), e.g. station ↔ dock. */
export interface Signpost {
  pos: THREE.Vector2;
  /** Button label when standing near it. */
  label: string;
  /** Where you arrive at this sign when coming from its partner, and which way you face. */
  arrive: THREE.Vector2;
  arriveFacing: number;
  partner: Signpost | null;
}

export interface Creek {
  objects: THREE.Object3D[];
  /** Station ↔ dock signposts. */
  signs: Signpost[];
  /** Centerline length (m). */
  length: number;
  dock: Pier;
  landing: Pier;
  /** Centerline point and downstream direction at distance s along the stream. */
  sample(s: number, pos: THREE.Vector2, tangent: THREE.Vector2): void;
  /** Distance from (x, z) to the water's edge (negative inside the water), and the nearest centerline point. */
  nearest(x: number, z: number, out: THREE.Vector2): number;
  /** True where nothing should be placed: the water, its banks, and the walk to the bridge. */
  reserved(x: number, z: number, margin: number): boolean;
  /** On the bridge or a pier: walkable even above the water. */
  onDeck(x: number, z: number): boolean;
  deckHeight(x: number, z: number): number;
  /** Bridge railing posts and pier edges for collision. */
  colliders: { x: number; z: number; r: number }[];
  update(dt: number): void;
}

/** The bridge spans the stream at right angles: `axis` runs across the water, `side` along it. */
interface BridgeFrame {
  center: THREE.Vector2;
  axis: THREE.Vector2;
  side: THREE.Vector2;
  halfLength: number;
}

export function createCreek(track: Track, rand: () => number): Creek {
  const curve = new THREE.CatmullRomCurve3(
    COURSE.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'centripetal',
  );
  const count = Math.round(curve.getLength() / STEP);
  const points = curve.getSpacedPoints(count).map((v) => new THREE.Vector2(v.x, v.z));
  const widths = points.map((_, k) => halfWidth(k));
  const spacing = curve.getLength() / count;
  const closestSample = (target: THREE.Vector2) => {
    let best = 0;
    points.forEach((p, k) => {
      if (p.distanceTo(target) < points[best].distanceTo(target)) best = k;
    });
    return best;
  };

  // Water ribbon (u runs downstream in texture repeats) and the bank ribbon under it.
  const water = track(ribbon(points, (k) => widths[k], 0.03));
  const bank = track(ribbon(points, (k) => widths[k] + BANK, 0.015));

  const flow = track(flowTexture());
  // Double-sided, so the strip shows whichever way it winds.
  const waterMat = track(new THREE.MeshBasicMaterial({ map: flow, side: THREE.DoubleSide }));
  const bankMat = track(new THREE.MeshBasicMaterial({ color: '#8fae78', side: THREE.DoubleSide }));
  // Both ribbons lie almost on the ground; push them toward the camera in depth so they never flicker.
  for (const [mat, units] of [
    [waterMat, -4],
    [bankMat, -2],
  ] as const) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = units;
    mat.polygonOffsetUnits = units;
  }
  const waterMesh = new THREE.Mesh(water, waterMat);
  const bankMesh = new THREE.Mesh(bank, bankMat);
  waterMesh.renderOrder = 1;

  // Bridge where the stream passes closest to BRIDGE_NEAR, square to the water.
  const kb = closestSample(BRIDGE_NEAR);
  const bridge: BridgeFrame = {
    center: points[kb].clone(),
    axis: normalAt(points, kb),
    side: tangentAt(points, kb),
    halfLength: widths[kb] + 2.8, // long enough that the arch is a walkable slope, landing on the banks
  };
  const local = new THREE.Vector2();
  /** Bridge coordinates: x along the bridge (across the water), y across the bridge. */
  const toBridge = (x: number, z: number) => {
    const dx = x - bridge.center.x;
    const dz = z - bridge.center.y;
    return local.set(dx * bridge.axis.x + dz * bridge.axis.y, dx * bridge.side.x + dz * bridge.side.y);
  };
  const onBridge = (x: number, z: number) => {
    toBridge(x, z);
    return Math.abs(local.x) < bridge.halfLength && Math.abs(local.y) < BRIDGE_HALF_WIDTH;
  };

  // Piers on the station-side bank: one where the boat ride starts, one where it ends.
  const makePier = (near: THREE.Vector2): Pier & { length: number } => {
    const k = closestSample(near);
    let normal = normalAt(points, k);
    if (normal.y < 0) normal = normal.negate(); // toward +z, the station side
    const length = widths[k] + 1.3 - PIER_INNER; // reaches onto the bank
    return {
      s: k * spacing,
      center: points[k].clone(),
      normal,
      tangent: tangentAt(points, k),
      stand: points[k].clone().addScaledVector(normal, PIER_INNER + 0.45),
      length,
    };
  };
  const piers = [makePier(DOCK_NEAR), makePier(LANDING_NEAR)];
  const pierLocal = new THREE.Vector2();
  /** Pier coordinates: x out from the centerline toward the bank, y along the stream. */
  const toPier = (pier: (typeof piers)[number], x: number, z: number) => {
    const dx = x - pier.center.x;
    const dz = z - pier.center.y;
    return pierLocal.set(dx * pier.normal.x + dz * pier.normal.y, dx * pier.tangent.x + dz * pier.tangent.y);
  };
  const pierAt = (x: number, z: number) =>
    piers.find((pier) => {
      toPier(pier, x, z);
      return (
        pierLocal.x > PIER_INNER && pierLocal.x < PIER_INNER + pier.length && Math.abs(pierLocal.y) < PIER_HALF_WIDTH
      );
    });
  const onDeck = (x: number, z: number) => onBridge(x, z) || pierAt(x, z) !== undefined;

  // Pebbles along both banks, leaving the bridge ends clear.
  const pebbleSpots: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 90; i++) {
    const k = Math.floor(rand() * points.length);
    const p = points[k];
    const side = rand() < 0.5 ? -1 : 1;
    const n = normalAt(points, k);
    const d = widths[k] + 0.05 + rand() * (BANK + 0.2);
    const x = p.x + n.x * d * side;
    const z = p.y + n.y * d * side;
    toBridge(x, z);
    if (Math.abs(local.y) < BRIDGE_HALF_WIDTH + 0.6 && Math.abs(local.x) < bridge.halfLength + 1) continue;
    if (piers.some((pier) => pier.stand.distanceTo(new THREE.Vector2(x, z)) < 2.2)) continue;
    pebbleSpots.push({ x, z, s: 0.12 + rand() * 0.22 });
  }
  const pebbles = new THREE.InstancedMesh(
    track(createRockGeometry(rand, false, '#9aa29a')),
    propMaterial,
    pebbleSpots.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  pebbleSpots.forEach((p, i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    pebbles.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, -0.04, p.z), q, new THREE.Vector3(p.s, p.s * 0.8, p.s)));
  });

  const { mesh: bridgeMesh, colliders } = createBridge(track, bridge);
  const pierMeshes = piers.map((pier) => {
    const built = createPier(track, pier, pier.length);
    colliders.push(...built.colliders);
    return built.mesh;
  });

  // A clear walk from the end of the platform path to the near (station-side) end of the bridge.
  const nearEnd = bridge.center
    .clone()
    .addScaledVector(bridge.axis, bridge.axis.y > 0 ? bridge.halfLength : -bridge.halfLength);
  const pathDir = nearEnd.clone().sub(PATH_START);
  const pathLength = pathDir.length();
  pathDir.normalize();
  const onPath = (x: number, z: number, margin: number) => {
    const t = THREE.MathUtils.clamp((x - PATH_START.x) * pathDir.x + (z - PATH_START.y) * pathDir.y, 0, pathLength + 2);
    return Math.hypot(x - (PATH_START.x + pathDir.x * t), z - (PATH_START.y + pathDir.y * t)) < 2.4 + margin;
  };

  const nearest = (x: number, z: number, out: THREE.Vector2): number => {
    let best = Infinity;
    let bestK = 0;
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k];
      const ax = x - a.x;
      const az = z - a.y;
      // Cheap reject: a segment starting this far away can't be closer than the best so far.
      if (best < Infinity && ax * ax + az * az > (Math.sqrt(best) + STEP + 0.01) ** 2) continue;
      const b = points[k + 1];
      const abx = b.x - a.x;
      const abz = b.y - a.y;
      const t = THREE.MathUtils.clamp((ax * abx + az * abz) / (abx * abx + abz * abz), 0, 1);
      const px = a.x + abx * t;
      const pz = a.y + abz * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best) {
        best = d2;
        bestK = k;
        out.set(px, pz);
      }
    }
    return Math.sqrt(best) - widths[bestK];
  };

  // Signposts: one beside the platform path, one on the bank at the dock.
  const dockPier = piers[0];
  const dockBank = dockPier.center.clone().addScaledVector(dockPier.normal, PIER_INNER + dockPier.length + 0.9);
  const stationSign: Signpost = {
    pos: STATION_SIGN.clone(),
    label: '선착장으로 가기',
    arrive: new THREE.Vector2(1.4, -1.5),
    arriveFacing: 0, // toward the platform and the train
    partner: null,
  };
  const dockSign: Signpost = {
    pos: dockBank.clone().addScaledVector(dockPier.tangent, 2.1),
    label: '역으로 가기',
    arrive: dockBank,
    arriveFacing: Math.atan2(-dockPier.normal.x, -dockPier.normal.y), // looking out along the pier
    partner: stationSign,
  };
  stationSign.partner = dockSign;
  const signs = [stationSign, dockSign];
  const signMeshes = [
    createSignpost(track, stationSign.pos, 0, '선착장'),
    createSignpost(track, dockSign.pos, Math.atan2(dockPier.normal.x, dockPier.normal.y), '역'),
  ];
  for (const sign of signs) colliders.push({ x: sign.pos.x, z: sign.pos.y, r: 0.15 });

  const tmp = new THREE.Vector2();
  return {
    objects: [bankMesh, waterMesh, pebbles, bridgeMesh, ...pierMeshes, ...signMeshes],
    signs,
    length: (points.length - 1) * spacing,
    dock: piers[0],
    landing: piers[1],
    sample: (s, pos, tangent) => {
      const f = THREE.MathUtils.clamp(s / spacing, 0, points.length - 1.001);
      const k = Math.floor(f);
      pos.copy(points[k]).lerp(points[k + 1], f - k);
      tangent.copy(points[k + 1]).sub(points[k]).normalize();
    },
    nearest,
    reserved: (x, z, margin) =>
      nearest(x, z, tmp) < BANK + 0.8 + margin ||
      onPath(x, z, margin) ||
      piers.some((pier) => pier.stand.distanceTo(tmp.set(x, z)) < 4 + margin),
    onDeck,
    deckHeight: (x, z) => {
      if (onBridge(x, z)) return archHeight(local.x, bridge.halfLength);
      const pier = pierAt(x, z);
      if (!pier) return 0;
      const fromBank = PIER_INNER + pier.length - pierLocal.x;
      return PIER_HEIGHT * Math.min(1, fromBank / 0.4); // short step down onto the bank
    },
    colliders,
    update: (dt) => {
      flow.offset.x = (flow.offset.x - dt * FLOW_SPEED) % 1;
    },
  };
}

function tangentAt(points: THREE.Vector2[], k: number): THREE.Vector2 {
  const a = points[Math.max(0, k - 1)];
  const b = points[Math.min(points.length - 1, k + 1)];
  return b.clone().sub(a).normalize();
}

function normalAt(points: THREE.Vector2[], k: number): THREE.Vector2 {
  const t = tangentAt(points, k);
  return new THREE.Vector2(-t.y, t.x);
}

/** A flat strip following the centerline at height y, `half(i)` wide on each side. */
function ribbon(points: THREE.Vector2[], half: (i: number) => number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) along += points[i].distanceTo(points[i - 1]);
    const n = normalAt(points, i);
    const h = half(i);
    const p = points[i];
    pos.push(p.x + n.x * h, y, p.y + n.y * h, p.x - n.x * h, y, p.y - n.y * h);
    uv.push(along / TEXTURE_LENGTH, 0, along / TEXTURE_LENGTH, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/** Soft pastel water with lighter streaks that read as gentle ripples when the texture slides. */
function flowTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#9fcbd6'); // shallow edges are lighter
  grad.addColorStop(0.5, '#7fb5c9');
  grad.addColorStop(1, '#9fcbd6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Streaks, drawn wrapped so the texture tiles along the stream.
  let seed = 7;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = 'rgba(226, 244, 247, 0.55)';
  for (let i = 0; i < 26; i++) {
    const x = r() * w;
    const y = 8 + r() * (h - 16);
    const len = 14 + r() * 30;
    const thick = 1 + r() * 1.6;
    for (const dx of [0, -w, w]) {
      ctx.beginPath();
      ctx.ellipse(x + dx, y, len / 2, thick, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Deck height of the arch at `u` meters from the bridge center (0 at both ends). */
export function archHeight(u: number, halfLength: number): number {
  return Math.abs(u) >= halfLength ? 0 : ARCH_RISE * Math.cos((Math.PI / 2) * (u / halfLength));
}

/** A painted box laid along local z from (y0 at z0) to (y1 at z1), e.g. a plank or beam on the arch. */
function slopedBox(w: number, h: number, x: number, z0: number, y0: number, z1: number, y1: number, color: string) {
  const len = Math.hypot(z1 - z0, y1 - y0);
  const g = new THREE.BoxGeometry(w, h, len);
  g.rotateX(-Math.atan2(y1 - y0, z1 - z0));
  g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
  return paint(g, color, { min: 0.72 });
}

/**
 * Arched wooden footbridge with low rails, high enough in the middle for a small boat to pass
 * under. Built along local z, then turned square to the stream.
 */
function createBridge(
  track: Track,
  frame: BridgeFrame,
): { mesh: THREE.Mesh; colliders: { x: number; z: number; r: number }[] } {
  const hw = BRIDGE_HALF_WIDTH;
  const hl = frame.halfLength;
  const arch = (u: number) => archHeight(u, hl);
  const parts: THREE.BufferGeometry[] = [];

  // Deck planks across the bridge, each tilted to follow the curve.
  const planks = Math.round(hl * 5);
  const plankLen = (hl * 2) / planks;
  for (let i = 0; i < planks; i++) {
    const z0 = -hl + plankLen * i + 0.015;
    const z1 = z0 + plankLen - 0.03;
    const tone = i % 3 === 0 ? '#8f735d' : '#a98d74';
    parts.push(slopedBox(hw * 2, 0.07, 0, z0, arch(z0) - 0.035, z1, arch(z1) - 0.035, tone));
  }

  // Arched stringers under both deck edges, rails following the curve, and upright posts.
  const segments = 14;
  const segLen = (hl * 2) / segments;
  const posts: THREE.Vector2[] = [];
  for (const side of [-1, 1]) {
    const rx = side * (hw + 0.05);
    for (let i = 0; i < segments; i++) {
      const z0 = -hl + segLen * i;
      const z1 = z0 + segLen;
      parts.push(slopedBox(0.12, 0.2, rx, z0, arch(z0) - 0.12, z1, arch(z1) - 0.12, '#7d6655'));
      if (i > 0 && i < segments - 1) {
        parts.push(slopedBox(0.07, 0.07, rx, z0, arch(z0) + 0.62, z1, arch(z1) + 0.62, '#a98d74'));
      }
    }
    for (let k = 1; k < segments; k += 2) {
      const pz = -hl + segLen * k;
      parts.push(box(0.08, 0.66, 0.08, rx, arch(pz) + 0.3, pz, '#7d6655'));
    }
    for (let pz = -hl + 0.2; pz <= hl - 0.2; pz += 0.35) posts.push(new THREE.Vector2(rx, pz));
  }
  // Stone footings where the arch meets the banks.
  for (const end of [-1, 1]) parts.push(box(hw * 2 + 0.4, 0.22, 0.5, 0, 0.04, end * (hl - 0.25), '#a3a8a0'));
  // rotateY(angle) turns local +z onto frame.axis (across the water).
  const angle = Math.atan2(frame.axis.x, frame.axis.y);
  const geo = track(merge(parts));
  geo.rotateY(angle);
  geo.translate(frame.center.x, 0, frame.center.y);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const colliders = posts.map((p) => ({
    x: frame.center.x + p.x * cos + p.y * sin,
    z: frame.center.y - p.x * sin + p.y * cos,
    r: 0.1,
  }));
  return { mesh: new THREE.Mesh(geo, propMaterial), colliders };
}

/**
 * Pier: a short deck on posts from the bank out over the water, with a mooring post at the end.
 * Built with local z pointing from the water to the bank, then turned into place. Invisible
 * posts along the open edges keep walkers from stepping off into the stream.
 */
function createPier(
  track: Track,
  pier: Pier,
  length: number,
): { mesh: THREE.Mesh; colliders: { x: number; z: number; r: number }[] } {
  const hw = PIER_HALF_WIDTH;
  const z0 = PIER_INNER;
  const z1 = PIER_INNER + length;
  const deckY = (z: number) => PIER_HEIGHT * Math.min(1, (z1 - z) / 0.4) - 0.03;
  const parts: THREE.BufferGeometry[] = [];
  const planks = Math.round(length / 0.28);
  const plankLen = length / planks;
  for (let i = 0; i < planks; i++) {
    const a = z0 + plankLen * i + 0.012;
    const b = a + plankLen - 0.024;
    parts.push(slopedBox(hw * 2, 0.06, 0, a, deckY(a), b, deckY(b), i % 3 === 1 ? '#8f735d' : '#a98d74'));
  }
  for (const side of [-1, 1]) {
    parts.push(box(0.1, 0.14, length - 0.4, side * (hw - 0.05), PIER_HEIGHT - 0.1, (z0 + z1 - 0.4) / 2, '#7d6655'));
    for (const pz of [z0 + 0.08, (z0 + z1) / 2]) parts.push(box(0.12, 0.5, 0.12, side * (hw - 0.06), -0.05, pz, '#6f5a4b'));
  }
  // Mooring post at the water end, a little taller than the deck.
  parts.push(box(0.14, 0.75, 0.14, hw - 0.08, 0.25, z0 + 0.08, '#6f5a4b'));

  const angle = Math.atan2(pier.normal.x, pier.normal.y);
  const geo = track(merge(parts));
  geo.rotateY(angle);
  geo.translate(pier.center.x, 0, pier.center.y);

  // Edge guards: along both sides over the water, and across the water end. The bank end stays open.
  const local: THREE.Vector2[] = [];
  for (let pz = z0; pz <= z1 - 1.2; pz += 0.3) {
    local.push(new THREE.Vector2(-hw - 0.05, pz), new THREE.Vector2(hw + 0.05, pz));
  }
  for (let px = -hw; px <= hw + 0.01; px += 0.3) local.push(new THREE.Vector2(px, z0 - 0.05));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const colliders = local.map((v) => ({
    x: pier.center.x + v.x * cos + v.y * sin,
    z: pier.center.y - v.x * sin + v.y * cos,
    r: 0.1,
  }));
  return { mesh: new THREE.Mesh(geo, propMaterial), colliders };
}

/** A small wooden signpost with a name board, readable from both sides. `yaw` turns the board. */
function createSignpost(track: Track, pos: THREE.Vector2, yaw: number, text: string): THREE.Group {
  const group = new THREE.Group();
  group.position.set(pos.x, 0, pos.y);
  group.rotation.y = yaw;
  group.add(
    new THREE.Mesh(
      track(
        merge([
          // Two thin posts at the board's ends, so neither face is covered.
          box(0.07, 1.25, 0.07, -0.39, 0.62, 0, '#7d6655'),
          box(0.07, 1.25, 0.07, 0.39, 0.62, 0, '#7d6655'),
          box(0.72, 0.36, 0.06, 0, 1.08, 0, '#e8dcc4'),
          box(0.92, 0.05, 0.09, 0, 1.28, 0, '#8f735d'),
        ]),
      ),
      propMaterial,
    ),
  );

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 104;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8dcc4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#5a4a3e';
  ctx.font = "600 46px -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const tex = track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = track(new THREE.MeshBasicMaterial({ map: tex }));
  const geo = track(new THREE.PlaneGeometry(0.68, 0.3));
  for (const side of [1, -1]) {
    const label = new THREE.Mesh(geo, mat);
    label.position.set(0, 1.08, side * 0.045); // clear of the board face, even far away
    if (side < 0) label.rotation.y = Math.PI;
    group.add(label);
  }
  return group;
}
