// Fake baked lighting: stores a per-vertex brightness factor in vertex colors.
// Materials multiply their base color by it, so one geometry serves every color.
import * as THREE from 'three';

const LIGHT_DIR = new THREE.Vector3(-0.5, 0.8, 0.6).normalize();

export function bakeShade(geo: THREE.BufferGeometry, min = 0.68, max = 1.0): THREE.BufferGeometry {
  const normals = geo.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < normals.count; i++) {
    n.fromBufferAttribute(normals, i);
    const t = THREE.MathUtils.clamp(n.dot(LIGHT_DIR) * 0.5 + 0.5, 0, 1);
    const v = THREE.MathUtils.lerp(min, max, t * t * (3 - 2 * t));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const materialCache = new Map<string, THREE.MeshBasicMaterial>();

export function shadedMaterial(color: string): THREE.MeshBasicMaterial {
  let mat = materialCache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, vertexColors: true });
    materialCache.set(color, mat);
  }
  return mat;
}
