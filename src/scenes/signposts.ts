// Signposts that carry you between places in a station behind a soft fade: two beside the
// platform path (to the dock and to the zipline tower), and one back to the station at each end.
import * as THREE from 'three';
import { box, merge, propMaterial, type Track } from './lowpoly';
import type { Creek } from './creek';
import type { Zipline } from './zipline';

export interface Signpost {
  pos: THREE.Vector2;
  /** Button label when standing near it. */
  label: string;
  /** Where you arrive at this sign when coming from its partner, and which way you face. */
  arrive: THREE.Vector2;
  arriveFacing: number;
  partner: Signpost | null;
}

/** Signs beside the path just behind the platform: dock to the west (left), zipline to the east. */
const STATION_DOCK_SIGN = new THREE.Vector2(-3.2, -1.3);
const STATION_ZIP_SIGN = new THREE.Vector2(3.2, -1.3);
const FACING_TRAIN = 0; // arriving at the station, you face the platform and the train

export function createSignposts(
  track: Track,
  creek: Creek,
  zipline: Zipline,
): { signs: Signpost[]; objects: THREE.Object3D[]; colliders: { x: number; z: number; r: number }[] } {
  const pair = (station: Signpost, far: Signpost) => {
    station.partner = far;
    far.partner = station;
  };

  // Station <-> dock: arrive on the bank at the end of the pier, looking out along it.
  const dock = creek.dock;
  const toDock: Signpost = {
    pos: STATION_DOCK_SIGN.clone(),
    label: '선착장으로 가기',
    arrive: new THREE.Vector2(-1.4, -1.5),
    arriveFacing: FACING_TRAIN,
    partner: null,
  };
  const atDock: Signpost = {
    pos: dock.bankEnd.clone().addScaledVector(dock.tangent, 2.1),
    label: '역으로 가기',
    arrive: dock.bankEnd.clone(),
    arriveFacing: Math.atan2(-dock.normal.x, -dock.normal.y),
    partner: null,
  };
  pair(toDock, atDock);

  // Station <-> zipline: arrive right where "짚라인 타기" shows, facing the tower.
  const dir = zipline.direction;
  const side = new THREE.Vector2(dir.y, -dir.x);
  const toZip: Signpost = {
    pos: STATION_ZIP_SIGN.clone(),
    label: '짚라인으로 가기',
    arrive: new THREE.Vector2(1.4, -1.5),
    arriveFacing: FACING_TRAIN,
    partner: null,
  };
  const atZip: Signpost = {
    pos: zipline.boardSpot.clone().addScaledVector(side, 2.0),
    label: '역으로 가기',
    arrive: zipline.boardSpot.clone(),
    arriveFacing: Math.atan2(dir.x, dir.y),
    partner: null,
  };
  pair(toZip, atZip);

  const signs = [toDock, atDock, toZip, atZip];
  const objects = [
    createSignpost(track, toDock.pos, 0, '선착장'),
    createSignpost(track, atDock.pos, Math.atan2(dock.normal.x, dock.normal.y), '역'),
    createSignpost(track, toZip.pos, 0, '짚라인'),
    createSignpost(track, atZip.pos, Math.atan2(dir.x, dir.y), '역'),
  ];
  const colliders = signs.map((sign) => ({ x: sign.pos.x, z: sign.pos.y, r: 0.15 }));
  return { signs, objects, colliders };
}

/** A small wooden signpost with a name board, readable from both sides. `yaw` turns the board. */
function createSignpost(track: Track, pos: THREE.Vector2, yaw: number, text: string): THREE.Group {
  const group = new THREE.Group();
  group.position.set(pos.x, 0, pos.y);
  group.rotation.y = yaw;
  group.add(
    new THREE.Mesh(
      track(
        merge([
          // Two thin posts at the board's ends, so neither face is covered.
          box(0.07, 1.25, 0.07, -0.39, 0.62, 0, '#7d6655'),
          box(0.07, 1.25, 0.07, 0.39, 0.62, 0, '#7d6655'),
          box(0.72, 0.36, 0.06, 0, 1.08, 0, '#e8dcc4'),
          box(0.92, 0.05, 0.09, 0, 1.28, 0, '#8f735d'),
        ]),
      ),
      propMaterial,
    ),
  );

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 104;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8dcc4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#5a4a3e';
  ctx.font = "600 46px -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const tex = track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = track(new THREE.MeshBasicMaterial({ map: tex }));
  const geo = track(new THREE.PlaneGeometry(0.68, 0.3));
  for (const side of [1, -1]) {
    const label = new THREE.Mesh(geo, mat);
    label.position.set(0, 1.08, side * 0.045); // clear of the board face, even far away
    if (side < 0) label.rotation.y = Math.PI;
    group.add(label);
  }
  return group;
}
