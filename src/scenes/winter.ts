// Winter station: snowfield, small station platform, rails, pine trees, rocks and snow mounds.
// Everything is code-built, unlit, and instanced where it repeats.
import * as THREE from 'three';
import { jitter, merge, paint, propMaterial, seededRandom } from './lowpoly';

// Palette
const SKY_TOP = new THREE.Color('#9fbad6');
const HORIZON = new THREE.Color('#e3e9f0');
const SNOW = new THREE.Color('#f8fafd');
const MOUNTAIN_LIT = new THREE.Color('#b4c3d4');
const MOUNTAIN_SHADE = new THREE.Color('#8ea0b6');
const PINE = '#4d7670';
const TRUNK = '#7a6152';
const ROCK = '#8f98a5';
const WOOD = '#a98d74';
const WOOD_DARK = '#7d6655';
const STEEL = '#6f7782';
const POLE = '#4a4f58';

const SEED = 20261103;
export const WORLD_RADIUS = 60;

// Station layout (the player starts on the platform, the village lies toward -z).
const PLATFORM = { minX: -4.5, maxX: 4.5, minZ: 0.2, maxZ: 2.8, height: 0.12 };
const RAIL_Z = 4.1;
export const SPAWN = new THREE.Vector3(0, PLATFORM.height, 1.4);

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface WinterScene {
  colliders: Collider[];
  /** Ground height at a point (the platform is slightly raised). */
  heightAt: (x: number, z: number) => number;
  /** Keeps a position inside the walkable area and outside colliders. */
  constrain: (p: THREE.Vector3, radius: number) => void;
  dispose: () => void;
}

export function buildWinterScene(scene: THREE.Scene): WinterScene {
  const rand = seededRandom(SEED);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(d: T): T => {
    disposables.push(d);
    return d;
  };
  const colliders: Collider[] = [];

  scene.background = HORIZON;
  scene.fog = new THREE.Fog(HORIZON, 20, 85);

  scene.add(createSky(track), createMountains(track, rand), createGround(track));
  scene.add(createStation(track, colliders), createRails(track));
  scene.add(...createNature(track, rand, colliders));

  const heightAt = (x: number, z: number): number =>
    x > PLATFORM.minX && x < PLATFORM.maxX && z > PLATFORM.minZ && z < PLATFORM.maxZ ? PLATFORM.height : 0;

  const constrain = (p: THREE.Vector3, radius: number): void => {
    // Soft circular world boundary.
    const r = Math.hypot(p.x, p.z);
    if (r > WORLD_RADIUS) {
      p.x *= WORLD_RADIUS / r;
      p.z *= WORLD_RADIUS / r;
    }
    // Don't step onto the rails.
    p.z = Math.min(p.z, PLATFORM.maxZ - radius);
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
  };

  return {
    colliders,
    heightAt,
    constrain,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

type Track = <T extends { dispose: () => void }>(d: T) => T;

// Sky dome with a vertical gradient baked into vertex colors.
function createSky(track: Track): THREE.Mesh {
  const geo = track(new THREE.SphereGeometry(150, 16, 12));
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 150, 0, 1);
    c.copy(HORIZON).lerp(SKY_TOP, Math.pow(t, 0.6));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  return new THREE.Mesh(geo, mat);
}

// Ring of low-poly mountains on the horizon.
function createMountains(track: Track, rand: () => number): THREE.InstancedMesh {
  const geo = track(new THREE.ConeGeometry(1, 1, 5, 1).toNonIndexed());
  geo.computeVertexNormals();
  const normals = geo.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  const c = new THREE.Color();
  const lightDir = new THREE.Vector3(-0.6, 0.5, 0.4).normalize();
  const n = new THREE.Vector3();
  for (let i = 0; i < normals.count; i += 3) {
    n.fromBufferAttribute(normals, i);
    const shade = THREE.MathUtils.clamp(n.dot(lightDir) * 0.5 + 0.5, 0, 1);
    // Far away, so blend toward the horizon instead of relying on fog.
    c.copy(MOUNTAIN_SHADE).lerp(MOUNTAIN_LIT, shade).lerp(HORIZON, 0.35);
    for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const count = 18;
  const mat = track(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.2;
    const radius = 105 + rand() * 20;
    const height = 14 + rand() * 16;
    const width = 18 + rand() * 12;
    p.set(Math.cos(angle) * radius, height / 2 - 0.5, Math.sin(angle) * radius);
    q.setFromAxisAngle(up, rand() * Math.PI);
    s.set(width, height, width);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }
  return mesh;
}

// Snowfield with soft, large-scale color variation so movement reads on the white ground.
function createGround(track: Track): THREE.Mesh {
  const geo = track(new THREE.PlaneGeometry(200, 200, 60, 60));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const shadow = new THREE.Color('#dfe6ef');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 0.17 + 1.3) * Math.sin(z * 0.13 - 0.7) * 0.5 +
      Math.sin(x * 0.07 - z * 0.05 + 2.1) * 0.5;
    c.copy(SNOW).lerp(shadow, THREE.MathUtils.clamp(n * 0.5 + 0.5, 0, 1) * 0.6);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, track(new THREE.MeshBasicMaterial({ vertexColors: true })));
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color, { min: 0.72 });
}

function cylinder(r: number, h: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, 6);
  g.translate(x, y, z);
  return paint(g, color, { min: 0.72 });
}

// Platform deck, bench, sign and lamp posts merged into one mesh, plus the sign text and lamp glows.
function createStation(track: Track, colliders: Collider[]): THREE.Group {
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
  // Snow drifts along the front edge.
  parts.push(box(PLATFORM.maxX - PLATFORM.minX + 0.2, 0.07, 0.22, 0, 0.035, PLATFORM.minZ - 0.06, '#f1f4f8'));

  // Bench.
  const bx = 2.2;
  const bz = 0.75;
  parts.push(box(1.5, 0.07, 0.42, bx, top + 0.44, bz, WOOD));
  parts.push(box(1.5, 0.32, 0.06, bx, top + 0.68, bz - 0.2, WOOD));
  for (const lx of [-0.62, 0.62]) parts.push(box(0.07, 0.44, 0.36, bx + lx, top + 0.22, bz, WOOD_DARK));
  colliders.push({ x: bx - 0.45, z: bz, r: 0.35 }, { x: bx + 0.45, z: bz, r: 0.35 });

  // Station sign: two posts and a board.
  const sx = -2.2;
  const sz = 0.55;
  for (const px of [-0.75, 0.75]) {
    parts.push(cylinder(0.05, 2.1, sx + px, top + 1.05, sz, POLE));
    colliders.push({ x: sx + px, z: sz, r: 0.12 });
  }
  parts.push(box(1.8, 0.56, 0.08, sx, top + 1.85, sz, '#f1ead9'));
  parts.push(box(1.9, 0.08, 0.12, sx, top + 2.17, sz, '#5a6577'));

  // Lamp posts at both ends.
  const lamps = [
    { x: PLATFORM.minX + 0.5, z: 0.55 },
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
  ctx.fillText('겨울역', canvas.width / 2, canvas.height / 2 + 2);
  const tex = track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1.7, 0.5)),
    track(new THREE.MeshBasicMaterial({ map: tex })),
  );
  label.position.set(sx, top + 1.85, sz + 0.045);
  group.add(label);

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

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Rails running along x behind the platform; the fog hides both ends.
function createRails(track: Track): THREE.Group {
  const group = new THREE.Group();
  const length = 160;
  const parts = [
    box(length, 0.05, 2.0, 0, 0.025, RAIL_Z, '#c9d0d9'), // gravel bed
    box(length, 0.1, 0.07, 0, 0.13, RAIL_Z - 0.6, STEEL),
    box(length, 0.1, 0.07, 0, 0.13, RAIL_Z + 0.6, STEEL),
  ];
  group.add(new THREE.Mesh(track(merge(parts)), propMaterial));

  const sleeperGeo = track(box(0.28, 0.07, 1.6, 0, 0.08, 0, '#6d5a4c'));
  const spacing = 0.8;
  const count = Math.floor(length / spacing);
  const sleepers = new THREE.InstancedMesh(sleeperGeo, propMaterial, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    sleepers.setMatrixAt(i, m.makeTranslation(-length / 2 + i * spacing, 0, RAIL_Z));
  }
  group.add(sleepers);
  return group;
}

// Pine tree: trunk, three tiers of foliage, each topped with a snow cap.
function createPineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.11, 0.15, 0.6, 5);
  trunk.translate(0, 0.3, 0);
  parts.push(paint(trunk, TRUNK));

  const tiers = [
    { r: 1.0, h: 1.3, y: 0.45 },
    { r: 0.78, h: 1.1, y: 1.15 },
    { r: 0.52, h: 0.95, y: 1.8 },
  ];
  for (const t of tiers) {
    const cone = new THREE.ConeGeometry(t.r, t.h, 7);
    cone.translate(0, t.y + t.h / 2, 0);
    parts.push(paint(cone, PINE, { min: 0.62 }));
    const cap = new THREE.ConeGeometry(t.r * 0.62, t.h * 0.42, 7);
    cap.translate(0, t.y + t.h - (t.h * 0.42) / 2 + 0.01, 0);
    parts.push(paint(cap, '#f3f6fa', { min: 0.82 }));
  }
  return merge(parts);
}

function createRockGeometry(rand: () => number): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, 0), 0.45, rand);
  g.scale(1, 0.62, 1);
  g.translate(0, 0.2, 0);
  return paint(g, ROCK, { snowAbove: 0.55, min: 0.66 });
}

function createMoundGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, 0.38, 1);
  return paint(g, '#f4f7fb', { flat: false, min: 0.86 });
}

/** Keep the station, the rails and a path into the village clear of props. */
function isReserved(x: number, z: number, margin: number): boolean {
  const nearStation = x > PLATFORM.minX - 2 - margin && x < PLATFORM.maxX + 2 + margin && z > -2.5 - margin;
  const railBand = z > PLATFORM.maxZ - margin && z < RAIL_Z + 1.6 + margin;
  const path = Math.abs(x) < 2.2 + margin && z > -14 && z < 0;
  return nearStation || railBand || path;
}

function createNature(track: Track, rand: () => number, colliders: Collider[]): THREE.Object3D[] {
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

  // Pine trees inside the walkable area: small groves with open meadows between them,
  // plus a few lone trees.
  const treeSpots: { x: number; z: number; scale: number }[] = [];
  const addTree = (x: number, z: number, scale: number) => {
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
      if (Math.abs(z - RAIL_Z) < 2.6) continue;
      const scale = 1.1 + rand() * 0.6;
      placed.push({ x, z, r: 0.7 * scale });
      treeSpots.push({ x, z, scale });
    }
  }
  // Sparse forest beyond the tree line for depth.
  for (let i = 0; i < 60; i++) {
    const spot = tryPlace(WORLD_RADIUS + 4, WORLD_RADIUS + 18, 1.8, 0);
    if (!spot) continue;
    const scale = 1.2 + rand() * 0.9;
    placed.push({ ...spot, r: 0.7 * scale });
    treeSpots.push({ ...spot, scale });
  }
  const trees = new THREE.InstancedMesh(track(createPineGeometry()), propMaterial, treeSpots.length);
  treeSpots.forEach((t, i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    trees.setMatrixAt(i, m.compose(p.set(t.x, 0, t.z), q, s.setScalar(t.scale)));
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
  const rocks = new THREE.InstancedMesh(track(createRockGeometry(rand)), propMaterial, rockSpots.length);
  rockSpots.forEach((r, i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    rocks.setMatrixAt(i, m.compose(p.set(r.x, 0, r.z), q, s.set(r.scale, r.scale, r.scale)));
  });

  // Low snow mounds that shape the ground; the character walks around them.
  const moundSpots: { x: number; z: number; scale: number }[] = [];
  for (let i = 0; i < 28; i++) {
    const spot = tryPlace(6, WORLD_RADIUS - 2, 1.5, 1.0);
    if (!spot) continue;
    const scale = 1.2 + rand() * 2.0;
    placed.push({ ...spot, r: scale * 0.8 });
    moundSpots.push({ ...spot, scale });
    colliders.push({ x: spot.x, z: spot.z, r: scale * 0.85 });
  }
  const mounds = new THREE.InstancedMesh(track(createMoundGeometry()), propMaterial, moundSpots.length);
  moundSpots.forEach((d, i) => {
    q.identity();
    mounds.setMatrixAt(i, m.compose(p.set(d.x, -0.05, d.z), q, s.set(d.scale, d.scale * 0.8, d.scale)));
  });

  return [trees, rocks, mounds];
}
