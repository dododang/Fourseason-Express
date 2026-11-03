// Shared backdrop that never moves with the stations: sky dome, far mountains, and plain
// ground under everything. Its colors follow the season of wherever the view currently is.
import * as THREE from 'three';
import { seededRandom } from './lowpoly';
import { clonePalette, type SeasonPalette } from './seasons';
import type { Track } from './lowpoly';

const SKY_RADIUS = 150;

export class Backdrop {
  private skyGeo: THREE.SphereGeometry;
  private mountainMat: THREE.MeshBasicMaterial;
  private groundMat: THREE.MeshBasicMaterial;
  private fog: THREE.Fog;
  private current: SeasonPalette | null = null;

  constructor(
    private scene: THREE.Scene,
    track: Track,
    initial: SeasonPalette,
  ) {
    // Sky: vertical gradient in vertex colors, recolored when the season changes.
    this.skyGeo = track(new THREE.SphereGeometry(SKY_RADIUS, 16, 12));
    this.skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.skyGeo.attributes.position.count * 3), 3));
    const sky = new THREE.Mesh(
      this.skyGeo,
      track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })),
    );

    // Mountains: brightness baked per face, hue from the material color (so it can change).
    const rand = seededRandom(20261103);
    const geo = track(new THREE.ConeGeometry(1, 1, 5, 1).toNonIndexed());
    geo.computeVertexNormals();
    const normals = geo.attributes.normal;
    const colors = new Float32Array(normals.count * 3);
    const lightDir = new THREE.Vector3(-0.6, 0.5, 0.4).normalize();
    const n = new THREE.Vector3();
    for (let i = 0; i < normals.count; i += 3) {
      n.fromBufferAttribute(normals, i);
      const shade = 0.82 + 0.18 * THREE.MathUtils.clamp(n.dot(lightDir) * 0.5 + 0.5, 0, 1);
      for (let k = 0; k < 3; k++) colors.fill(shade, (i + k) * 3, (i + k) * 3 + 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.mountainMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    const count = 18;
    const mountains = new THREE.InstancedMesh(geo, this.mountainMat, count);
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
      mountains.setMatrixAt(i, m.compose(p, q, s));
    }

    // Plain ground that continues past every station's own ground.
    this.groundMat = track(new THREE.MeshBasicMaterial({ color: initial.ground }));
    const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(1500, 1500)), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;

    this.fog = new THREE.Fog(initial.horizon.clone(), 20, 85);
    scene.fog = this.fog;
    scene.add(sky, mountains, ground);
    this.setPalette(initial);
  }

  setPalette(p: SeasonPalette): void {
    if (this.current && paletteClose(this.current, p)) return;
    this.current = clonePalette(p);

    const pos = this.skyGeo.attributes.position;
    const col = this.skyGeo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / SKY_RADIUS, 0, 1);
      c.copy(p.horizon).lerp(p.skyTop, Math.pow(t, 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;

    // Far away, so the mountains lean toward the horizon color instead of relying on fog.
    this.mountainMat.color.copy(p.mountain).lerp(p.horizon, 0.3);
    this.groundMat.color.copy(p.ground);
    this.fog.color.copy(p.horizon);
    this.scene.background = this.fog.color;
  }
}

function paletteClose(a: SeasonPalette, b: SeasonPalette): boolean {
  const d = (x: THREE.Color, y: THREE.Color) => Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b);
  return d(a.horizon, b.horizon) + d(a.ground, b.ground) + d(a.skyTop, b.skyTop) < 0.004;
}
