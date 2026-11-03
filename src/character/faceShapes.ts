// Head shapes made by deforming a unit sphere. Geometries are cached per shape
// and shared by every character with that face.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bakeShade } from './shading';
import type { FaceKind } from './options';

const HAIR_TILT = -0.32;
const HAIR_SCALE = 1.07;

/** Moves a point on the unit sphere onto the surface of the given head shape (in place). */
export function deformToFace(kind: FaceKind, v: THREE.Vector3): THREE.Vector3 {
  switch (kind) {
    case 'round':
      return v;
    case 'triangle': {
      // Wide at the temples, narrowing toward the chin.
      const t = (v.y + 1) / 2;
      v.x *= THREE.MathUtils.lerp(0.68, 1.12, t);
      v.z *= THREE.MathUtils.lerp(0.82, 1.02, t);
      return v;
    }
    case 'square': {
      // Rounded cube: points satisfy |x|^4 + |y|^4 + |z|^4 = 1.
      const p = Math.pow(v.x ** 4 + v.y ** 4 + v.z ** 4, 0.25);
      v.divideScalar(p);
      v.x *= 1.02;
      v.z *= 0.9;
      return v;
    }
  }
}

function deformGeometry(geo: THREE.BufferGeometry, kind: FaceKind, scale = 1): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    deformToFace(kind, v).multiplyScalar(scale);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Weld the UV seam so recomputed normals stay smooth.
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const merged = mergeVertices(geo);
  merged.computeVertexNormals();
  return merged;
}

const headCache = new Map<FaceKind, THREE.BufferGeometry>();
const hairCache = new Map<FaceKind, THREE.BufferGeometry>();

export function getHeadGeometry(kind: FaceKind): THREE.BufferGeometry {
  let geo = headCache.get(kind);
  if (!geo) {
    geo = bakeShade(deformGeometry(new THREE.SphereGeometry(1, 24, 16), kind));
    headCache.set(kind, geo);
  }
  return geo;
}

export function getHairGeometry(kind: FaceKind): THREE.BufferGeometry {
  let geo = hairCache.get(kind);
  if (!geo) {
    // Cap of the sphere, tilted back to show the forehead, then shaped like the head.
    const cap = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
    cap.rotateX(HAIR_TILT);
    cap.translate(0, 0.04, -0.03);
    geo = bakeShade(deformGeometry(cap, kind, HAIR_SCALE), 0.6, 1.0);
    hairCache.set(kind, geo);
  }
  return geo;
}
