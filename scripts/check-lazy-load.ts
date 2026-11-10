// Checks station lazy loading without a browser: rides the train for a few legs with a fake
// station builder and prints when stations are built and dropped, and how many are loaded.
// Run: npx rolldown scripts/check-lazy-load.ts --platform node --format esm --transform.define "import.meta.env.DEV:false" -o .lazy-check.mjs && node .lazy-check.mjs
import * as THREE from 'three';
import { Railway, TRAIN_FLOOR } from '../src/systems/railway';
import { RAIL_Z, stationInfo, type StationSeason, type StationZone } from '../src/scenes/station';

const events: string[] = [];
let built = 0;
let disposed = 0;

function fakeBuild(root: THREE.Group, season: StationSeason): StationZone {
  built++;
  const content = new THREE.Group();
  root.add(content);
  return {
    ...stationInfo(season),
    root,
    content,
    track: (d) => d,
    railGate: null,
    creek: null,
    zipline: null,
    signs: [],
    spawn: new THREE.Vector3(),
    viewYaw: 0,
    snowfall: false,
    heightAt: () => 0,
    surfaceAt: () => 'grass',
    constrain: () => {},
    dispose: () => {
      disposed++;
      root.remove(content);
    },
  };
}

const scene = new THREE.Scene();
const railway = new Railway(scene, (d) => d, ['winter', 'spring', 'summer'], fakeBuild);
let t = 0;
railway.onLoad = (z) => events.push(`${t.toFixed(1)}s  build   ${z.season}`);
railway.onUnload = (z) => events.push(`${t.toFixed(1)}s  dispose ${z.season}`);

void railway.station; // main reads this at startup
const player = new THREE.Vector3(0, TRAIN_FLOOR, RAIL_Z); // standing inside the car
let maxLoaded = 0;
const dt = 1 / 30;
for (; t < 400; t += dt) {
  railway.update(dt, player);
  maxLoaded = Math.max(maxLoaded, railway.loaded.length);
  if (railway.view === 'station' && railway.loaded.every((z) => z !== railway.station)) {
    events.push(`${t.toFixed(1)}s  ERROR: the player's station is not loaded`);
  }
}
console.log(events.join('\n'));
console.log(`built ${built}, disposed ${disposed}, most loaded at once: ${maxLoaded}`);
