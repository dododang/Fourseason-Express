// A station zone. Every station has the same size and layout (CLAUDE.md: equal station size),
// only the season dressing differs: ground colors, trees, rocks, mounds or bushes, flowers.
// Station content lives under one root group so the whole station can slide past the train
// window; the sky and far mountains are the shared Backdrop.
import * as THREE from 'three';
import { box, cylinder, merge, propMaterial, seededRandom, type Track } from './lowpoly';
import {
  createFlowerGeometry,
  createGinkgoGeometry,
  createLeafGeometry,
  createMoundGeometry,
  createPalmGeometry,
  createShellGeometry,
  createPersimmonGeometry,
  createPineGeometry,
  createRockGeometry,
  createRoundTreeGeometry,
  radialTexture,
} from './props';
import { createCreek, type Creek } from './creek';
import { createSea, shoreZ, type Sea } from './sea';
import { createZipline, type Zipline } from './zipline';
import { createSignposts, type Signpost } from './signposts';
import { PALETTES, type SeasonPalette } from './seasons';
import type { Surface, Zone } from './zone';

export const WORLD_RADIUS = 60;

// Station layout: the platform runs along the rails (x), the village lies toward -z.
// The platform is longer than the 22 m train car, and its edge meets the car's side wall.
export const PLATFORM = { minX: -13, maxX: 13, minZ: 0.2, maxZ: 2.8, height: 0.12 };
export const RAIL_Z = 4.95; // track center line; the car (4.2 m wide) starts at the platform edge
const SPAWN = new THREE.Vector3(0, PLATFORM.height, 1.6);
/** Trees keep this far from the rail line plus their crown reach (TREE_REACH x scale): half the car + air. */
const TRAIN_CLEARANCE = 2.1 + 0.4;
const TREE_REACH = 1.35; // widest crown radius per unit of tree scale (round trees ~1.3, pines 1.0)

const WOOD = '#a98d74';
const WOOD_DARK = '#7d6655';
const POLE = '#4a4f58';

export type StationSeason = 'winter' | 'spring' | 'summer' | 'autumn';

interface SeasonDressing {
  name: string;
  seed: number;
  palette: SeasonPalette;
  surface: Surface;
  snowfall: boolean;
  /** Tree kinds and how often each appears. */
  trees: { geo: () => THREE.BufferGeometry; weight: number }[];
  rock: { color: string; snow: boolean };
  mound: { color: string; faceted: boolean };
  edgeColor: string; // strip along the platform's village-side edge
  flowers: number;
  /** Colors the little ground details are tinted with (flowers, shells, fallen leaves). */
  flowerTints: string[];
  /** Shape of the little ground details (flowers unless set). */
  detail?: () => THREE.BufferGeometry;
  /** Each detail picks its own tint (fallen leaves) instead of one tint per drift (flowers). */
  mixTints?: boolean;
  /** A stream with a footbridge behind the village. */
  creek: boolean;
  /** The far side of the village is a beach and the sea. */
  sea: boolean;
}

const DRESSING: Record<StationSeason, SeasonDressing> = {
  winter: {
    name: '겨울',
    seed: 20261103,
    palette: PALETTES.winter,
    surface: 'snow',
    snowfall: true,
    trees: [{ geo: createPineGeometry, weight: 1 }],
    rock: { color: '#8f98a5', snow: true },
    mound: { color: '#f4f7fb', faceted: false },
    edgeColor: '#f1f4f8',
    flowers: 0,
    flowerTints: [],
    creek: false,
    sea: false,
  },
  spring: {
    name: '봄',
    seed: 20260402,
    palette: PALETTES.spring,
    surface: 'grass',
    snowfall: false,
    trees: [
      { geo: () => createRoundTreeGeometry('#f2bfcd', 11), weight: 0.45 },
      { geo: () => createRoundTreeGeometry('#8fbf72', 29), weight: 0.55 },
    ],
    rock: { color: '#8e968b', snow: false },
    mound: { color: '#7fa866', faceted: true },
    edgeColor: '#9fc283',
    flowers: 420,
    flowerTints: ['#ffffff', '#ffe58a', '#f6b8c8', '#c9b6e8', '#ffd1a6'],
    creek: true,
    sea: false,
  },
  summer: {
    name: '여름',
    seed: 20260801,
    palette: PALETTES.summer,
    surface: 'sand',
    snowfall: false,
    trees: [
      { geo: createPalmGeometry, weight: 0.6 },
      { geo: () => createRoundTreeGeometry('#86c07a', 47), weight: 0.4 },
    ],
    rock: { color: '#c9b08e', snow: false }, // sandstone
    mound: { color: '#ead9b2', faceted: false }, // low dunes
    edgeColor: '#e6d4ac',
    flowers: 160, // shells
    flowerTints: ['#fff7ee', '#f7d6d0', '#f3e2c4', '#e9eef2'],
    detail: createShellGeometry,
    creek: false,
    sea: true,
  },
  autumn: {
    name: '가을',
    seed: 20261015,
    palette: PALETTES.autumn,
    surface: 'leaves',
    snowfall: false,
    trees: [
      { geo: () => createRoundTreeGeometry('#e0844f', 13), weight: 0.35 }, // maple
      { geo: () => createRoundTreeGeometry('#d9a24e', 37), weight: 0.2 }, // turning oak
      { geo: createGinkgoGeometry, weight: 0.3 },
      { geo: createPersimmonGeometry, weight: 0.15 },
    ],
    rock: { color: '#9a9184', snow: false },
    mound: { color: '#b88a52', faceted: true }, // rust-brown shrubs
    edgeColor: '#d1a868', // leaves drifted against the platform
    flowers: 900, // fallen leaves
    flowerTints: ['#e9824e', '#f2c45a', '#d9603f', '#e8a24c', '#c98a52'],
    detail: createLeafGeometry,
    mixTints: true,
    creek: false,
    sea: false,
  },
};

/** The light part of a station, always known: what the railway needs even while it is not loaded. */
export interface StationInfo {
  /** Season name shown when entering, e.g. "겨울". */
  name: string;
  season: StationSeason;
  palette: SeasonPalette;
}

export function stationInfo(season: StationSeason): StationInfo {
  const dress = DRESSING[season];
  return { name: dress.name, season, palette: dress.palette };
}

export interface StationZone extends Zone, StationInfo {
  /** The station's place on the line; moves when seen from a running train. Its position is the
   *  station's world offset. Other things (like footprints) may live here too and outlast the zone. */
  root: THREE.Group;
  /** Everything this zone built, under root; removed and disposed by dispose(). */
  content: THREE.Group;
  /** Registers GPU resources made for this station elsewhere (boat, zipline seat) so they go with it. */
  track: Track;
  /** While set and true for x, the rail-side edge of the platform is open (train doors). */
  railGate: ((x: number) => boolean) | null;
  /** The stream, if this station has one (local coordinates, relative to root). */
  creek: Creek | null;
  /** The zipline from the boat landing back toward the dock (with the creek). */
  zipline: Zipline | null;
  /** Signposts that carry you between the platform, the dock and the zipline. */
  signs: Signpost[];
}

interface Collider {
  x: number;
  z: number;
  r: number;
}

/** Builds a station's content under `root` (which the railway places on the line). */
export function buildStation(root: THREE.Group, season: StationSeason): StationZone {
  const dress = DRESSING[season];
  const rand = seededRandom(dress.seed);
  const disposables: { dispose: () => void }[] = [];
  const track: Track = (d) => {
    disposables.push(d);
    return d;
  };
  const colliders: Collider[] = [];

  const content = new THREE.Group();
  content.add(createGround(track, dress.palette), createPlatform(track, colliders, dress));
  // The stream has its own seed so the rest of the layout keeps its own sequence.
  const creek = dress.creek ? createCreek(track, seededRandom(dress.seed + 1)) : null;
  const sea = dress.sea ? createSea(track) : null;
  if (sea) content.add(...sea.objects);
  if (creek) {
    content.add(...creek.objects);
    colliders.push(...creek.colliders);
  }
  const zipline = creek ? createZipline(track) : null;
  if (zipline) {
    content.add(...zipline.objects);
    colliders.push(...zipline.colliders);
  }
  const signposts = creek && zipline ? createSignposts(track, creek, zipline) : null;
  if (signposts) {
    content.add(...signposts.objects);
    colliders.push(...signposts.colliders);
  }
  content.add(...createNature(track, rand, colliders, dress, creek, zipline, sea));
  root.add(content);

  const heightAt = (x: number, z: number): number => {
    if (x > PLATFORM.minX && x < PLATFORM.maxX && z > PLATFORM.minZ && z < PLATFORM.maxZ) return PLATFORM.height;
    return creek ? creek.deckHeight(x, z) : 0;
  };
  const near = new THREE.Vector2();

  const constrain = (p: THREE.Vector3, radius: number): void => {
    // Soft circular world boundary.
    const r = Math.hypot(p.x, p.z);
    if (r > WORLD_RADIUS) {
      p.x *= WORLD_RADIUS / r;
      p.z *= WORLD_RADIUS / r;
    }
    // Don't step onto the rails, except through an open train door.
    if (!zone.railGate?.(p.x)) p.z = Math.min(p.z, PLATFORM.maxZ - radius);
    // Push out of props.
    for (const c of colliders) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
    // At the beach you can paddle a step into the foam, but no farther out to sea.
    if (sea) p.z = Math.max(p.z, shoreZ(p.x) - 0.5);
    // Keep out of the water, except on the bridge and piers: step back to the bank.
    if (creek && !creek.onDeck(p.x, p.z)) {
      const inside = creek.nearest(p.x, p.z, near) + radius * 0.5;
      if (inside < 0) {
        let dx = p.x - near.x;
        let dz = p.z - near.y;
        const d = Math.hypot(dx, dz);
        if (d < 1e-6) [dx, dz] = [0, 1];
        else [dx, dz] = [dx / d, dz / d];
        p.x -= dx * inside;
        p.z -= dz * inside;
      }
    }
  };

  const zone: StationZone = {
    name: dress.name,
    season,
    palette: dress.palette,
    root,
    content,
    track,
    railGate: null,
    creek,
    zipline,
    signs: signposts?.signs ?? [],
    spawn: SPAWN.clone(),
    viewYaw: Math.PI, // camera on the village side, so the player faces the train
    snowfall: dress.snowfall,
    heightAt,
    surfaceAt: (x, z) => (heightAt(x, z) > 0 || creek?.onDeck(x, z) ? 'wood' : dress.surface),
    update: (dt) => {
      creek?.update(dt);
      sea?.update(dt);
    },
    constrain,
    dispose: () => {
      root.remove(content);
      disposables.forEach((d) => d.dispose());
      disposables.length = 0;
    },
  };
  return zone;
}

// Ground with soft, large-scale color variation so movement reads on it.
function createGround(track: Track, palette: SeasonPalette): THREE.Mesh {
  const geo = track(new THREE.PlaneGeometry(200, 200, 60, 60));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 0.17 + 1.3) * Math.sin(z * 0.13 - 0.7) * 0.5 + Math.sin(x * 0.07 - z * 0.05 + 2.1) * 0.5;
    // Fade the variation out toward the edge so the ground meets the plain backdrop seamlessly.
    const edge = 1 - THREE.MathUtils.smoothstep(Math.hypot(x, z), 80, 100);
    c.copy(palette.ground).lerp(palette.groundShade, THREE.MathUtils.clamp(n * 0.5 + 0.5, 0, 1) * 0.6 * edge);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, track(new THREE.MeshBasicMaterial({ vertexColors: true })));
}

// Platform deck, bench, sign and lamp posts merged into one mesh, plus the sign text and lamp glows.
function createPlatform(track: Track, colliders: Collider[], dress: SeasonDressing): THREE.Group {
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const top = PLATFORM.height;

  // Deck planks running along x, with slightly varied tones.
  const plankDepth = (PLATFORM.maxZ - PLATFORM.minZ) / 9;
  for (let i = 0; i < 9; i++) {
    const z = PLATFORM.minZ + plankDepth * (i + 0.5);
    const tone = i % 3 === 0 ? WOOD_DARK : WOOD;
    parts.push(box(PLATFORM.maxX - PLATFORM.minX, top, plankDepth - 0.025, 0, top / 2, z, tone));
  }
  // Snow drift or grass tuft along the village-side edge.
  parts.push(box(PLATFORM.maxX - PLATFORM.minX + 0.2, 0.07, 0.22, 0, 0.035, PLATFORM.minZ - 0.06, dress.edgeColor));

  // Bench.
  const bx = 8.5;
  const bz = 0.75;
  parts.push(box(1.5, 0.07, 0.42, bx, top + 0.44, bz, WOOD));
  parts.push(box(1.5, 0.32, 0.06, bx, top + 0.68, bz - 0.2, WOOD));
  for (const lx of [-0.62, 0.62]) parts.push(box(0.07, 0.44, 0.36, bx + lx, top + 0.22, bz, WOOD_DARK));
  colliders.push({ x: bx - 0.45, z: bz, r: 0.35 }, { x: bx + 0.45, z: bz, r: 0.35 });

  // Station sign: two posts and a board.
  const sx = -8.5;
  const sz = 0.55;
  for (const px of [-0.75, 0.75]) {
    parts.push(cylinder(0.05, 2.1, sx + px, top + 1.05, sz, POLE));
    colliders.push({ x: sx + px, z: sz, r: 0.12 });
  }
  parts.push(box(1.8, 0.56, 0.08, sx, top + 1.85, sz, '#f1ead9'));
  parts.push(box(1.9, 0.08, 0.12, sx, top + 2.17, sz, '#5a6577'));

  // Lamp posts along the platform.
  const lamps = [
    { x: PLATFORM.minX + 0.5, z: 0.55 },
    { x: -3, z: 0.55 },
    { x: 3, z: 0.55 },
    { x: PLATFORM.maxX - 0.5, z: 0.55 },
  ];
  for (const l of lamps) {
    parts.push(cylinder(0.045, 2.5, l.x, top + 1.25, l.z, POLE));
    parts.push(box(0.26, 0.05, 0.26, l.x, top + 2.52, l.z, POLE));
    colliders.push({ x: l.x, z: l.z, r: 0.12 });
  }

  group.add(new THREE.Mesh(track(merge(parts)), propMaterial));

  // Sign text, drawn once to a small canvas.
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f1ead9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#3d4656';
  ctx.font = "600 44px -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${dress.name}역`, canvas.width / 2, canvas.height / 2 + 2);
  const tex = track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1.7, 0.5)),
    track(new THREE.MeshBasicMaterial({ map: tex })),
  );
  label.position.set(sx, top + 1.85, sz + 0.045);
  // Readable from the train (front) and from the village (back).
  const back = label.clone();
  back.rotation.y = Math.PI;
  back.position.z = sz - 0.045;
  group.add(label, back);

  // Lamp heads: warm, always-bright spheres with a soft additive glow (no real lights).
  const headGeo = track(new THREE.SphereGeometry(0.12, 10, 8));
  const headMat = track(new THREE.MeshBasicMaterial({ color: '#ffe3ad' }));
  const glowTex = track(radialTexture('rgba(255,224,170,0.55)', 'rgba(255,224,170,0)'));
  const glowMat = track(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  for (const l of lamps) {
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(l.x, top + 2.4, l.z);
    const glow = new THREE.Sprite(glowMat);
    glow.position.copy(head.position);
    glow.scale.setScalar(1.3);
    group.add(head, glow);
  }

  return group;
}

/** Keep the station, the rails and a path into the village clear of props. */
function isStationReserved(x: number, z: number, margin: number): boolean {
  const nearStation = x > PLATFORM.minX - 2 - margin && x < PLATFORM.maxX + 2 + margin && z > -2.5 - margin;
  const railBand = z > PLATFORM.maxZ - margin && z < RAIL_Z + 3.2 + margin;
  const path = Math.abs(x) < 2.2 + margin && z > -14 && z < 0;
  return nearStation || railBand || path;
}

function createNature(
  track: Track,
  rand: () => number,
  colliders: Collider[],
  dress: SeasonDressing,
  creek: Creek | null,
  zipline: Zipline | null,
  sea: Sea | null,
): THREE.Object3D[] {
  const isReserved = (x: number, z: number, margin: number) =>
    isStationReserved(x, z, margin) ||
    (creek !== null && creek.reserved(x, z, margin)) ||
    (zipline !== null && zipline.reserved(x, z, margin)) ||
    (sea !== null && sea.reserved(x, z, margin));
  const placed: { x: number; z: number; r: number }[] = [];
  const tryPlace = (minR: number, maxR: number, spacing: number, margin: number) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = rand() * Math.PI * 2;
      const dist = minR + Math.sqrt(rand()) * (maxR - minR);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      if (isReserved(x, z, margin)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + spacing)) continue;
      return { x, z };
    }
    return null;
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Trees inside the walkable area: small groves with open meadows between them,
  // plus a few lone trees.
  const treeSpots: { x: number; z: number; scale: number }[] = [];
  // Passing trains must clear every crown: half the car, a little air, and the crown's reach.
  const clearsTrain = (z: number, scale: number) => Math.abs(z - RAIL_Z) > TRAIN_CLEARANCE + TREE_REACH * scale;
  const addTree = (x: number, z: number, scale: number) => {
    if (!clearsTrain(z, scale)) return;
    placed.push({ x, z, r: 0.7 * scale });
    treeSpots.push({ x, z, scale });
    colliders.push({ x, z, r: 0.38 * scale });
  };
  for (let g = 0; g < 13; g++) {
    const center = tryPlace(10, WORLD_RADIUS - 6, 6, 3);
    if (!center) continue;
    const size = 3 + Math.floor(rand() * 5);
    for (let i = 0; i < size; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * 4.5;
        const x = center.x + Math.cos(a) * d;
        const z = center.z + Math.sin(a) * d;
        if (isReserved(x, z, 0.8) || placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 1.3)) continue;
        addTree(x, z, 0.8 + rand() * 0.7);
        break;
      }
    }
  }
  for (let i = 0; i < 18; i++) {
    const spot = tryPlace(6, WORLD_RADIUS - 2, 5, 1);
    if (spot) addTree(spot.x, spot.z, 0.8 + rand() * 0.6);
  }

  // Tree line along the boundary: two staggered rows, so the edge reads as a forest, not a wall.
  // A gap is left where the rails run out into the distance.
  for (const [row, radius] of [WORLD_RADIUS + 1.2, WORLD_RADIUS + 2.6].entries()) {
    const step = 1.7 / radius;
    for (let a = row * step * 0.5; a < Math.PI * 2; a += step) {
      const r = radius + (rand() - 0.5) * 0.8;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const scale = 1.1 + rand() * 0.6;
      if (!clearsTrain(z, scale) || isReserved(x, z, 0)) continue;
      placed.push({ x, z, r: 0.7 * scale });
      treeSpots.push({ x, z, scale });
    }
  }
  // Sparse forest beyond the tree line for depth.
  for (let i = 0; i < 60; i++) {
    const spot = tryPlace(WORLD_RADIUS + 4, WORLD_RADIUS + 18, 1.8, 0);
    if (!spot) continue;
    const scale = 1.2 + rand() * 0.9;
    if (!clearsTrain(spot.z, scale)) continue;
    placed.push({ ...spot, r: 0.7 * scale });
    treeSpots.push({ ...spot, scale });
  }

  // Split the spots between tree kinds by weight (one instanced mesh per kind).
  const total = dress.trees.reduce((sum, t) => sum + t.weight, 0);
  const buckets: { x: number; z: number; scale: number; rot: number }[][] = dress.trees.map(() => []);
  for (const t of treeSpots) {
    let pick = rand() * total;
    let k = 0;
    while (k < dress.trees.length - 1 && (pick -= dress.trees[k].weight) > 0) k++;
    buckets[k].push({ ...t, rot: rand() * Math.PI * 2 });
  }
  const treeMeshes = dress.trees.map((kind, k) => {
    const mesh = new THREE.InstancedMesh(track(kind.geo()), propMaterial, Math.max(1, buckets[k].length));
    mesh.count = buckets[k].length;
    buckets[k].forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      mesh.setMatrixAt(i, m.compose(p.set(t.x, 0, t.z), q, s.setScalar(t.scale)));
    });
    return mesh;
  });

  // Rocks.
  const rockSpots: { x: number; z: number; scale: number }[] = [];
  for (let i = 0; i < 45; i++) {
    const spot = tryPlace(4, WORLD_RADIUS - 1, 1.0, 0.5);
    if (!spot) continue;
    const scale = 0.25 + rand() * 0.45;
    placed.push({ ...spot, r: scale });
    rockSpots.push({ ...spot, scale });
    colliders.push({ x: spot.x, z: spot.z, r: scale * 0.85 });
  }
  const rocks = new THREE.InstancedMesh(
    track(createRockGeometry(rand, dress.rock.snow, dress.rock.color)),
    propMaterial,
    rockSpots.length,
  );
  rockSpots.forEach((r, i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    rocks.setMatrixAt(i, m.compose(p.set(r.x, 0, r.z), q, s.set(r.scale, r.scale, r.scale)));
  });

  // Low mounds (snow) or bushes (spring); the character walks around them.
  const moundSpots: { x: number; z: number; scale: number }[] = [];
  for (let i = 0; i < 28; i++) {
    const spot = tryPlace(6, WORLD_RADIUS - 2, 1.5, 1.0);
    if (!spot) continue;
    const scale = dress.mound.faceted ? 0.7 + rand() * 0.9 : 1.2 + rand() * 2.0;
    placed.push({ ...spot, r: scale * 0.8 });
    moundSpots.push({ ...spot, scale });
    colliders.push({ x: spot.x, z: spot.z, r: scale * 0.85 });
  }
  const mounds = new THREE.InstancedMesh(
    track(createMoundGeometry(dress.mound.color, dress.mound.faceted)),
    propMaterial,
    moundSpots.length,
  );
  moundSpots.forEach((d, i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    const h = dress.mound.faceted ? 1.6 : 0.8; // bushes stand taller than snow mounds
    mounds.setMatrixAt(i, m.compose(p.set(d.x, -0.05, d.z), q, s.set(d.scale, d.scale * h, d.scale)));
  });

  const out: THREE.Object3D[] = [...treeMeshes, rocks, mounds];

  // Wildflowers scattered in loose drifts; no collision, you walk through them.
  if (dress.flowers > 0) {
    const flowers = new THREE.InstancedMesh(track((dress.detail ?? createFlowerGeometry)()), propMaterial, dress.flowers);
    const tints = dress.flowerTints.map((c) => new THREE.Color(c));
    let n = 0;
    while (n < dress.flowers) {
      // Drift center, then a handful of flowers around it.
      const center = tryPlace(4, WORLD_RADIUS - 2, 0, 0.3);
      if (!center) break;
      let tint = tints[Math.floor(rand() * tints.length)];
      for (let i = 0; i < 12 && n < dress.flowers; i++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * 2.2;
        const x = center.x + Math.cos(a) * d;
        const z = center.z + Math.sin(a) * d;
        if (isReserved(x, z, 0)) continue;
        if (dress.mixTints) tint = tints[Math.floor(rand() * tints.length)];
        q.setFromAxisAngle(up, rand() * Math.PI);
        flowers.setMatrixAt(n, m.compose(p.set(x, 0, z), q, s.setScalar(0.8 + rand() * 0.6)));
        flowers.setColorAt(n, tint);
        n++;
      }
    }
    flowers.count = n;
    out.push(flowers);
  }

  return out;
}
