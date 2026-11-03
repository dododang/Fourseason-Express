// Scenery along the railway: rails, sleepers, pines and telegraph poles, built in 120 m chunks.
// Three chunks are placed around the current view position along the track. The line is a loop
// of LOOP meters, a multiple of three chunks, so the scenery repeats seamlessly.
// Trees near a station are hidden so they don't clash with the station's own layout.
import * as THREE from 'three';
import { box, cylinder, merge, propMaterial, seededRandom } from './lowpoly';
import type { Track } from './winter';

export const CHUNK = 120;
const STATION_CLEARANCE = 80; // no scenery trees within this distance of a station along the track

interface ChunkMesh {
  group: THREE.Group;
  trees: THREE.InstancedMesh;
  treeLocal: { x: number; z: number; rot: number; scale: number }[];
  index: number | null; // which chunk of the track it currently shows
}

export class TrackScenery {
  readonly root = new THREE.Group();
  private chunks: ChunkMesh[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  /** `stations`: track positions of the stations; `loop`: track length (multiple of 3 chunks). */
  constructor(
    track: Track,
    pineGeo: THREE.BufferGeometry,
    private loop: number,
    private stations: number[],
  ) {
    const rand = seededRandom(41);

    const railGeo = track(
      merge([
        box(CHUNK, 0.02, 2.2, 0, 0.01, 0, '#c9d0d9'), // gravel bed
        box(CHUNK, 0.04, 0.07, 0, 0.04, -0.6, '#6f7782'),
        box(CHUNK, 0.04, 0.07, 0, 0.04, 0.6, '#6f7782'),
      ]),
    );
    const sleeperGeo = track(box(0.28, 0.025, 1.6, 0, 0.0125, 0, '#6d5a4c'));
    const poleGeo = track(
      merge([cylinder(0.08, 6.5, 0, 3.25, 0, '#6b5848'), box(0.08, 0.08, 1.2, 0, 5.2, 0, '#6b5848')]),
    );

    for (let c = 0; c < 3; c++) {
      const group = new THREE.Group();
      const rails = new THREE.Mesh(railGeo, propMaterial);
      rails.position.x = CHUNK / 2;
      group.add(rails);

      const sleeperCount = CHUNK / 0.8;
      const sleepers = new THREE.InstancedMesh(sleeperGeo, propMaterial, sleeperCount);
      for (let i = 0; i < sleeperCount; i++) sleepers.setMatrixAt(i, this.m.makeTranslation(i * 0.8, 0, 0));
      group.add(sleepers);

      const poles = new THREE.InstancedMesh(poleGeo, propMaterial, CHUNK / 30);
      for (let i = 0; i < CHUNK / 30; i++) poles.setMatrixAt(i, this.m.makeTranslation(i * 30 + 15, 0, 5.5));
      group.add(poles);

      // Pines on both sides, more far away than close.
      const treeLocal = [];
      for (let i = 0; i < 90; i++) {
        const side = rand() < 0.5 ? -1 : 1;
        treeLocal.push({
          x: rand() * CHUNK,
          z: side * (9 + Math.pow(rand(), 0.7) * 55),
          rot: rand() * Math.PI * 2,
          scale: 1.0 + rand() * 1.0,
        });
      }
      const trees = new THREE.InstancedMesh(pineGeo, propMaterial, treeLocal.length);
      trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(trees);

      this.root.add(group);
      this.chunks.push({ group, trees, treeLocal, index: null });
    }
  }

  /** Places the chunks so the track position `viewS` is at x = 0 of this root. */
  update(viewS: number): void {
    const current = Math.floor(viewS / CHUNK);
    for (let k = current - 1; k <= current + 1; k++) {
      const chunk = this.chunks[((k % 3) + 3) % 3];
      chunk.group.position.x = k * CHUNK - viewS;
      if (chunk.index !== k) {
        chunk.index = k;
        this.layoutTrees(chunk, k * CHUNK);
      }
    }
  }

  private layoutTrees(chunk: ChunkMesh, start: number): void {
    chunk.treeLocal.forEach((t, i) => {
      const u = start + t.x;
      const nearStation = this.stations.some((st) => {
        const d = ((((u - st) % this.loop) + this.loop * 1.5) % this.loop) - this.loop / 2;
        return Math.abs(d) < STATION_CLEARANCE;
      });
      this.q.setFromAxisAngle(this.up, t.rot);
      this.s.setScalar(nearStation ? 0 : t.scale);
      chunk.trees.setMatrixAt(i, this.m.compose(this.p.set(t.x, 0, t.z), this.q, this.s));
    });
    chunk.trees.instanceMatrix.needsUpdate = true;
  }
}
