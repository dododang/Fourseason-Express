// Code-built low-poly props shared by stations and track scenery.
import * as THREE from 'three';
import { jitter, merge, paint } from './lowpoly';

const TRUNK = '#7a6152';

// Pine tree: trunk, three tiers of foliage, each topped with a snow cap (winter).
export function createPineGeometry(): THREE.BufferGeometry {
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
    parts.push(paint(cone, '#4d7670', { min: 0.62 }));
    const cap = new THREE.ConeGeometry(t.r * 0.62, t.h * 0.42, 7);
    cap.translate(0, t.y + t.h - (t.h * 0.42) / 2 + 0.01, 0);
    parts.push(paint(cap, '#f3f6fa', { min: 0.82 }));
  }
  return merge(parts);
}

/** Round-canopy tree: a trunk with a few faceted blobs. Pink for blossoms, green for leaves. */
export function createRoundTreeGeometry(canopy: string, seed: number): THREE.BufferGeometry {
  let a = seed;
  const rand = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 1.4, 5);
  trunk.translate(0, 0.7, 0);
  parts.push(paint(trunk, TRUNK));
  const blobs = [
    { x: 0, y: 2.0, z: 0, r: 1.0 },
    { x: 0.55, y: 1.75, z: 0.2, r: 0.7 },
    { x: -0.5, y: 1.8, z: -0.25, r: 0.72 },
    { x: 0.1, y: 2.55, z: -0.1, r: 0.62 },
  ];
  for (const b of blobs) {
    const g = jitter(new THREE.IcosahedronGeometry(b.r, 0), 0.25, rand);
    g.translate(b.x, b.y, b.z);
    parts.push(paint(g, canopy, { min: 0.68 }));
  }
  return merge(parts);
}

export function createRockGeometry(rand: () => number, snowCap: boolean, color = '#8f98a5'): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, 0), 0.45, rand);
  g.scale(1, 0.62, 1);
  g.translate(0, 0.2, 0);
  return paint(g, color, { snowAbove: snowCap ? 0.55 : undefined, min: 0.66 });
}

/** Low dome: a snow mound in winter, a bush in spring. */
export function createMoundGeometry(color: string, faceted: boolean): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, faceted ? 8 : 12, faceted ? 5 : 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, 0.38, 1);
  return paint(g, color, { flat: faceted, min: faceted ? 0.7 : 0.86 });
}

/** A tiny flower head sitting on the grass; tinted per instance. */
export function createFlowerGeometry(): THREE.BufferGeometry {
  const head = new THREE.OctahedronGeometry(0.07, 0);
  head.scale(1, 0.55, 1);
  head.translate(0, 0.09, 0);
  const stem = new THREE.CylinderGeometry(0.008, 0.008, 0.09, 3);
  stem.translate(0, 0.045, 0);
  // White head so the instance color shows true; the stem is darkened so it reads as green-ish.
  return merge([paint(head, '#ffffff', { min: 0.82 }), paint(stem, '#5f8a4f', { min: 0.9 })]);
}

export function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
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
