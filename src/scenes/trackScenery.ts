// Scenery along the railway: ground, rails, sleepers, trees and telegraph poles in 120 m chunks.
// Three chunks are placed around the current view position along the track. The line is a loop
// whose length is a multiple of three chunks, so the scenery repeats seamlessly.
// The season blends between stations: ground color and the mix of tree kinds follow `seasonAt`.
// Trees near a station are hidden so they don't clash with the station's own layout.
import * as THREE from 'three';
import { box, cylinder, merge, propMaterial, seededRandom, type Track } from './lowpoly';
import { createPineGeometry, createRoundTreeGeometry } from './props';
import type { SeasonPalette } from './seasons';

/** Distance between the two rails (m). */
const RAIL_GAUGE = 2.0;

export const CHUNK = 120;
const STATION_CLEARANCE = 80; // no scenery trees within this distance of a station along the track
const GROUND_WIDTH = 200;
const GROUND_STEPS = 12; // color samples along a chunk

/** Season mix at a track position: palette plus how wintry (pines) vs springlike (round trees) it is. */
export interface SeasonSample {
  palette: SeasonPalette;
  winter: number; // 0..1, the rest is spring
}

interface TreeSlot {
  x: number;
  z: number;
  rot: number;
  scale: number;
  pick: number; // fixed random 0..1 deciding the kind for a given season mix
}

interface ChunkMesh {
  group: THREE.Group;
  ground: THREE.Mesh;
  kinds: THREE.InstancedMesh[]; // pine, green round tree, blossom tree
  slots: TreeSlot[];
  index: number | null; // which chunk of the track it currently shows
}

export class TrackScenery {
  readonly root = new THREE.Group();
  private chunks: ChunkMesh[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zero = new THREE.Vector3(0, 0, 0);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    track: Track,
    private loop: number,
    private stations: number[],
    private seasonAt: (u: number) => SeasonSample,
  ) {
    const rand = seededRandom(41);
    const railGeo = track(
      merge([
        // Gauge wide enough for the 4.2 m car to look like it rides on it (car about twice the gauge).
        box(CHUNK, 0.02, 3.4, CHUNK / 2, 0.01, 0, '#c9d0d9'), // gravel bed
        box(CHUNK, 0.05, 0.09, CHUNK / 2, 0.045, -RAIL_GAUGE / 2, '#6f7782'),
        box(CHUNK, 0.05, 0.09, CHUNK / 2, 0.045, RAIL_GAUGE / 2, '#6f7782'),
      ]),
    );
    const sleeperGeo = track(box(0.32, 0.025, RAIL_GAUGE + 0.6, 0, 0.0125, 0, '#6d5a4c'));
    const poleGeo = track(
      merge([cylinder(0.08, 6.5, 0, 3.25, 0, '#6b5848'), box(0.08, 0.08, 1.2, 0, 5.2, 0, '#6b5848')]),
    );
    const treeGeos = [
      track(createPineGeometry()),
      track(createRoundTreeGeometry('#8fbf72', 29)),
      track(createRoundTreeGeometry('#f2bfcd', 11)),
    ];

    for (let c = 0; c < 3; c++) {
      const group = new THREE.Group();

      // Ground strip under this chunk, colored per season along its length.
      const groundGeo = track(new THREE.PlaneGeometry(CHUNK, GROUND_WIDTH, GROUND_STEPS, 1));
      groundGeo.rotateX(-Math.PI / 2);
      groundGeo.translate(CHUNK / 2, 0, 0);
      groundGeo.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(groundGeo.attributes.position.count * 3), 3),
      );
      const ground = new THREE.Mesh(groundGeo, track(new THREE.MeshBasicMaterial({ vertexColors: true })));
      ground.position.y = -0.03; // above the plain backdrop, below every station's own ground
      group.add(ground, new THREE.Mesh(railGeo, propMaterial));

      const sleeperCount = CHUNK / 0.8;
      const sleepers = new THREE.InstancedMesh(sleeperGeo, propMaterial, sleeperCount);
      for (let i = 0; i < sleeperCount; i++) sleepers.setMatrixAt(i, this.m.makeTranslation(i * 0.8, 0, 0));
      group.add(sleepers);

      const poles = new THREE.InstancedMesh(poleGeo, propMaterial, CHUNK / 30);
      for (let i = 0; i < CHUNK / 30; i++) poles.setMatrixAt(i, this.m.makeTranslation(i * 30 + 15, 0, 5.5));
      group.add(poles);

      // Tree slots on both sides, more far away than close. Each slot shows one kind at a time.
      const slots: TreeSlot[] = [];
      for (let i = 0; i < 90; i++) {
        const side = rand() < 0.5 ? -1 : 1;
        slots.push({
          x: rand() * CHUNK,
          z: side * (9 + Math.pow(rand(), 0.7) * 55),
          rot: rand() * Math.PI * 2,
          scale: 1.0 + rand() * 1.0,
          pick: rand(),
        });
      }
      const kinds = treeGeos.map((geo) => {
        const mesh = new THREE.InstancedMesh(geo, propMaterial, slots.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        group.add(mesh);
        return mesh;
      });

      this.root.add(group);
      this.chunks.push({ group, ground, kinds, slots, index: null });
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
        this.layout(chunk, k * CHUNK);
      }
    }
  }

  private wrap(u: number): number {
    return ((u % this.loop) + this.loop) % this.loop;
  }

  private layout(chunk: ChunkMesh, start: number): void {
    // Ground colors along the chunk.
    const pos = chunk.ground.geometry.attributes.position;
    const col = chunk.ground.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const c = this.seasonAt(this.wrap(start + pos.getX(i))).palette.ground;
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;

    // Trees: hide near stations; otherwise pick the kind from the local season mix.
    chunk.slots.forEach((t, i) => {
      const u = this.wrap(start + t.x);
      const nearStation = this.stations.some((st) => {
        const d = ((((u - st) % this.loop) + this.loop * 1.5) % this.loop) - this.loop / 2;
        return Math.abs(d) < STATION_CLEARANCE;
      });
      const { winter } = this.seasonAt(u);
      // Pines where it is wintry; in spring, mostly green trees with some blossoms.
      const kind = t.pick < winter ? 0 : t.pick < winter + (1 - winter) * 0.6 ? 1 : 2;
      this.q.setFromAxisAngle(this.up, t.rot);
      chunk.kinds.forEach((mesh, k) => {
        const show = !nearStation && k === kind;
        this.s.setScalar(show ? t.scale : 0);
        mesh.setMatrixAt(i, this.m.compose(show ? this.p.set(t.x, 0, t.z) : this.zero, this.q, this.s));
      });
    });
    for (const mesh of chunk.kinds) mesh.instanceMatrix.needsUpdate = true;
  }
}
