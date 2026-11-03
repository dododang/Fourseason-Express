// Helpers for code-built low-poly props with baked (fake) lighting in vertex colors.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const LIGHT_DIR = new THREE.Vector3(-0.5, 0.8, 0.6).normalize();

/** Deterministic RNG so every visitor gets the same layout. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PaintOptions {
  /** Faceted look: every triangle gets its own flat normal. */
  flat?: boolean;
  min?: number;
  max?: number;
  /** Faces whose normal points up more than this get the snow color. */
  snowAbove?: number;
  snowColor?: THREE.ColorRepresentation;
}

/** Bakes color × directional shade into vertex colors. Returns a non-indexed geometry when flat. */
export function paint(
  source: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  opts: PaintOptions = {},
): THREE.BufferGeometry {
  const { flat = true, min = 0.7, max = 1.0, snowAbove, snowColor = '#f3f6fa' } = opts;
  let geo = source;
  geo.deleteAttribute('uv');
  if (flat) {
    geo = geo.index ? geo.toNonIndexed() : geo;
  }
  geo.computeVertexNormals();

  const base = new THREE.Color(color);
  const snow = new THREE.Color(snowColor);
  const normals = geo.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < normals.count; i++) {
    n.fromBufferAttribute(normals, i);
    const t = THREE.MathUtils.clamp(n.dot(LIGHT_DIR) * 0.5 + 0.5, 0, 1);
    const shade = THREE.MathUtils.lerp(min, max, t);
    c.copy(snowAbove !== undefined && n.y > snowAbove ? snow : base).multiplyScalar(shade);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Merges painted parts into one geometry (one draw call). Drops indices so parts can mix. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const plain = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(plain, false);
  if (!merged) throw new Error('mergeGeometries failed');
  return merged;
}

/** Randomly nudges vertices for an irregular rock-like shape, keeping it watertight. */
export function jitter(geo: THREE.BufferGeometry, amount: number, rand: () => number): THREE.BufferGeometry {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const welded = mergeVertices(geo);
  const pos = welded.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) * (1 + (rand() - 0.5) * amount),
      pos.getY(i) * (1 + (rand() - 0.5) * amount),
      pos.getZ(i) * (1 + (rand() - 0.5) * amount),
    );
  }
  return welded;
}

/** Painted box, positioned by its center. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color, { min: 0.72 });
}

/** Painted six-sided cylinder, positioned by its center. */
export function cylinder(r: number, h: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, 6);
  g.translate(x, y, z);
  return paint(g, color, { min: 0.72 });
}

/** One material for every painted prop. */
export const propMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
