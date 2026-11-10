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

/** Palm: a gently leaning, banded trunk with drooping fronds and a few coconuts. About 4 m tall. */
export function createPalmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segments = 6;
  const segLen = 0.66;
  const lean = (y: number) => 0.06 * y * y; // trunk drifts sideways as it rises
  for (let i = 0; i < segments; i++) {
    const y0 = i * segLen;
    const y1 = y0 + segLen;
    const g = new THREE.CylinderGeometry(0.16 - i * 0.008, 0.17 - i * 0.008, segLen * 1.02, 6);
    g.rotateZ(-Math.atan2(lean(y1) - lean(y0), segLen));
    g.translate((lean(y0) + lean(y1)) / 2, (y0 + y1) / 2, 0);
    parts.push(paint(g, i % 2 ? '#a9845e' : '#b9946b', { min: 0.72 }));
  }
  const topY = segments * segLen;
  const topX = lean(topY);
  const fronds = 7;
  for (let k = 0; k < fronds; k++) {
    const leaf = new THREE.ConeGeometry(0.3, 2.0, 4);
    leaf.scale(1, 1, 0.22); // flat blade
    leaf.translate(0, 1.0, 0); // base at the crown
    leaf.rotateZ(-Math.PI / 2 - 0.22 - (k % 2) * 0.18); // out, drooping a little below level
    leaf.rotateY((k / fronds) * Math.PI * 2 + 0.3);
    leaf.translate(topX, topY, 0);
    parts.push(paint(leaf, k % 2 ? '#7fb87a' : '#8cc286', { min: 0.68 }));
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const nut = new THREE.IcosahedronGeometry(0.12, 0);
    nut.translate(topX + Math.cos(a) * 0.16, topY - 0.15, Math.sin(a) * 0.16);
    parts.push(paint(nut, '#8a6a4a', { min: 0.7 }));
  }
  return merge(parts);
}

/** Ginkgo: a tall, narrow tree with stacked yellow blobs, like a soft flame. About 4.5 m tall. */
export function createGinkgoGeometry(): THREE.BufferGeometry {
  let a = 53;
  const rand = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.15, 1.6, 5);
  trunk.translate(0, 0.8, 0);
  parts.push(paint(trunk, TRUNK));
  const blobs = [
    { x: 0, y: 1.9, z: 0, r: 0.85 },
    { x: 0.15, y: 2.75, z: -0.1, r: 0.72 },
    { x: -0.1, y: 3.5, z: 0.08, r: 0.55 },
    { x: 0.05, y: 4.1, z: 0, r: 0.36 },
  ];
  for (const b of blobs) {
    const g = jitter(new THREE.IcosahedronGeometry(b.r, 0), 0.22, rand);
    g.translate(b.x, b.y, b.z);
    parts.push(paint(g, '#f2cf5b', { min: 0.72 }));
  }
  return merge(parts);
}

/** Persimmon tree: a crooked trunk, a thin olive-and-rust canopy and orange fruit hanging outside it. */
export function createPersimmonGeometry(): THREE.BufferGeometry {
  let a = 71;
  const rand = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 1.3, 5);
  trunk.rotateZ(0.12);
  trunk.translate(-0.06, 0.65, 0);
  parts.push(paint(trunk, '#6e5648'));
  const blobs = [
    { x: 0, y: 1.85, z: 0, r: 0.85, c: '#b9a05a' },
    { x: 0.6, y: 1.65, z: 0.15, r: 0.6, c: '#c98a52' },
    { x: -0.55, y: 1.75, z: -0.2, r: 0.62, c: '#a8a05c' },
    { x: 0.1, y: 2.4, z: -0.1, r: 0.52, c: '#c98a52' },
  ];
  for (const b of blobs) {
    const g = jitter(new THREE.IcosahedronGeometry(b.r, 0), 0.25, rand);
    g.translate(b.x, b.y, b.z);
    parts.push(paint(g, b.c, { min: 0.7 }));
  }
  // Fruit just outside the canopy, so it reads from afar.
  for (let k = 0; k < 9; k++) {
    const ang = (k / 9) * Math.PI * 2 + rand() * 0.4;
    const y = 1.45 + rand() * 1.0;
    const r = 0.95 - (y - 1.45) * 0.25;
    const fruit = new THREE.IcosahedronGeometry(0.11, 0);
    fruit.scale(1, 0.85, 1);
    fruit.translate(Math.cos(ang) * r, y, Math.sin(ang) * r);
    parts.push(paint(fruit, '#f08a3c', { min: 0.8 }));
  }
  return merge(parts);
}

/** A fallen leaf lying flat on the ground; tinted per instance. */
export function createLeafGeometry(): THREE.BufferGeometry {
  const leaf = new THREE.CircleGeometry(0.14, 5);
  leaf.rotateX(-Math.PI / 2);
  leaf.scale(1, 1, 0.6);
  leaf.translate(0, 0.012, 0);
  return paint(leaf, '#ffffff', { min: 0.85 });
}

/** A small flat shell lying on the sand; tinted per instance. */
export function createShellGeometry(): THREE.BufferGeometry {
  const shell = new THREE.ConeGeometry(0.07, 0.03, 6);
  shell.scale(1, 1, 0.8);
  shell.translate(0, 0.015, 0);
  return paint(shell, '#ffffff', { min: 0.8 });
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
