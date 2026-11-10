// The sea beside the summer station: the far side of the village is a beach, then water out to
// the hazy horizon. A band of wet sand and a line of foam lap gently at the shore. No lights:
// vertex colors (shallow turquoise to deeper blue) and one animated foam strip.
import * as THREE from 'three';
import type { Track } from './lowpoly';

const SHORE_BASE = -30; // average shoreline z (the platform is at z ≈ 0..3)
const X_RANGE = 130; // half-width of the water; fog hides the ends
const DEPTHS = [0, 1.2, 3, 6, 12, 22, 40, 70, 110]; // rows of the water mesh, meters out from the shore
const LAP_PERIOD = 7; // seconds for the foam to come in and slip back
const LAP_REACH = 0.9; // meters the foam travels up the sand

/** Shoreline z at x: a gently curving beach. */
export function shoreZ(x: number): number {
  return SHORE_BASE + 3 * Math.sin(x * 0.045 + 0.6) + 1.5 * Math.sin(x * 0.11 - 1.2);
}

export interface Sea {
  objects: THREE.Object3D[];
  /** How far (x, z) is from the water's edge toward land (negative = in the water). */
  inland(x: number, z: number): number;
  /** Nothing is planted near the water. */
  reserved(x: number, z: number, margin: number): boolean;
  update(dt: number): void;
}

export function createSea(track: Track): Sea {
  const shallow = new THREE.Color('#9fdcd8');
  const mid = new THREE.Color('#79c0cf');
  const deep = new THREE.Color('#6aa6c4');

  // Water: rows following the shoreline, colored by distance out.
  const step = 4;
  const cols = Math.round((X_RANGE * 2) / step) + 1;
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const c = new THREE.Color();
  DEPTHS.forEach((d, j) => {
    const t = d / DEPTHS[DEPTHS.length - 1];
    if (t < 0.15) c.copy(shallow).lerp(mid, t / 0.15);
    else c.copy(mid).lerp(deep, Math.min(1, (t - 0.15) / 0.5));
    for (let i = 0; i < cols; i++) {
      const x = -X_RANGE + i * step;
      pos.push(x, 0.02, shoreZ(x) - d);
      col.push(c.r, c.g, c.b);
      if (i > 0 && j > 0) {
        const a = (j - 1) * cols + i - 1;
        const b = j * cols + i - 1;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  });
  const waterGeo = track(new THREE.BufferGeometry());
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  waterGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  waterGeo.setIndex(index);
  const waterMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  lift(waterMat, -4);
  const water = new THREE.Mesh(waterGeo, waterMat);

  // Wet sand: a darker band just above the waterline, where the foam reaches.
  const wet = new THREE.Mesh(
    track(shoreStrip(-0.2, LAP_REACH + 0.9, 0.012)),
    track(new THREE.MeshBasicMaterial({ color: '#d9c7a0', side: THREE.DoubleSide })),
  );
  lift(wet.material as THREE.Material, -2);

  // Foam: a soft white line that slides up the sand and back.
  const foamMat = track(
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
  );
  lift(foamMat, -6);
  const foam = new THREE.Mesh(track(shoreStrip(-0.35, 0.25, 0.03)), foamMat);
  foam.renderOrder = 2;

  let time = Math.random() * LAP_PERIOD;
  return {
    objects: [water, wet, foam],
    inland: (x, z) => z - shoreZ(x),
    reserved: (x, z, margin) => z - shoreZ(x) < 4 + margin,
    update: (dt) => {
      time += dt;
      // Comes in quickly, eases back slowly, and thins out as it retreats.
      const phase = (time % LAP_PERIOD) / LAP_PERIOD;
      const reach = phase < 0.35 ? Math.sin((phase / 0.35) * (Math.PI / 2)) : Math.cos(((phase - 0.35) / 0.65) * (Math.PI / 2));
      foam.position.z = reach * LAP_REACH;
      foamMat.opacity = 0.25 + 0.55 * reach;
    },
  };
}

/** A strip along the shoreline from `near` to `far` meters inland (negative = over the water). */
function shoreStrip(near: number, far: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  const step = 2;
  const cols = Math.round((X_RANGE * 2) / step) + 1;
  for (let i = 0; i < cols; i++) {
    const x = -X_RANGE + i * step;
    pos.push(x, y, shoreZ(x) + near, x, y, shoreZ(x) + far);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  return geo;
}

/** Flat layers lie almost on the ground; pull them toward the camera in depth so they never flicker. */
function lift(mat: THREE.Material, units: number): void {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = units;
  mat.polygonOffsetUnits = units;
}
