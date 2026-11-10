// Entry point: renderer setup and game loop.
import * as THREE from 'three';
import { Character, FOOT_HEIGHT } from './character/Character';
import { randomLook } from './character/options';
import { Entrance } from './ui/entrance';
import { ZoneBanner } from './ui/zoneBanner';
import { DoorTimer } from './ui/doorTimer';
import { ActionButton } from './ui/actionButton';
import { ScreenFade } from './ui/fade';
import { setupDebugStats } from './systems/debugStats';
import { Input } from './controls/input';
import { ThirdPersonCamera } from './controls/ThirdPersonCamera';
import { buildStation, RAIL_Z, stationInfo, type StationZone } from './scenes/station';
import { Backdrop } from './scenes/backdrop';
import type { Track } from './scenes/lowpoly';
import { Railway, TRAIN_FLOOR } from './systems/railway';
import { Footprints } from './systems/footprints';
import { Snowfall } from './systems/snowfall';
import { StationAudio } from './audio/StationAudio';
import { AdaptiveQuality } from './systems/adaptiveQuality';
import { BoatRide } from './systems/boatRide';
import { ZiplineRide } from './systems/ziplineRide';

const container = document.getElementById('app')!;

// iOS Safari ignores user-scalable=no: block pinch and double-tap zoom explicitly.
for (const type of ['gesturestart', 'gesturechange', 'dblclick']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

// No dynamic lights: unlit materials only (per performance rules).
const params = new URLSearchParams(location.search);
const disposables: { dispose: () => void }[] = [];
const track: Track = (d) => {
  disposables.push(d);
  return d;
};
// Stations in line order: winter -> spring -> summer -> back to winter for now. Autumn will
// sit between summer and winter: spring -> summer -> autumn -> winter -> spring (CLAUDE.md).
// The railway builds each station's scenery only when it is near (lazy loading).
const backdrop = new Backdrop(scene, track, stationInfo('winter').palette);
const railway = new Railway(scene, track, ['winter', 'spring', 'summer'], buildStation);
const footprints = new Footprints();
const snowfall = new Snowfall();
// Prints belong to the winter station's place on the line, so they outlast a reload of its scenery.
railway.rootOf('winter').add(footprints.mesh);
scene.add(snowfall.points);
let onBoardTrain = false; // player is inside the car

// The spring station's rowboat and zipline exist only while that station is loaded.
interface StreamRides {
  zone: StationZone;
  boat: BoatRide;
  zip: ZiplineRide;
}
let rides: StreamRides | null = null;
let inBoat = false;
let onZip = false;
railway.onLoad = (zone) => {
  if (!zone.creek || !zone.zipline) return;
  const boat = new BoatRide(zone.creek, zone.track);
  const zip = new ZiplineRide(zone.zipline, zone.track);
  zone.content.add(boat.mesh, zip.mesh);
  zip.onArrive = () => {
    // Step down from the seat: keep the spot, the ground follow below drops the feet down gently.
    onZip = false;
    player.seated = false;
    player.root.rotation.x = 0;
  };
  rides = { zone, boat, zip };
};
railway.onUnload = (zone) => {
  if (rides?.zone === zone) rides = null; // never while riding: the player's own station stays loaded
};
// Dev only: ?station=1 starts at the second station (spring) for quick checks.
if (import.meta.env.DEV && params.has('station')) railway.startAt(Number(params.get('station')));
const start = railway.station;
const SPAWN = start.spawn;
const BOARD_RANGE = 2.2; // m from the pier's standing spot
const SIGN_RANGE = 1.6; // m from a signpost
const fade = new ScreenFade();

// Season notice at the top when arriving somewhere.
const banner = new ZoneBanner();
const doorTimer = new DoorTimer();
const NOTICE_RANGE = 20; // only near the train's stop, so the village stays free of it

function formatWait(seconds: number): string {
  const s = Math.ceil(seconds);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}분 ${rest}초` : `${m}분`;
}

/** Name of the station the train is heading to. Only one station on the test loop for now. */
function nextStation(): string {
  return railway.nextStation.name;
}

/** What the small train note says right now, or null to hide it. */
function trainNotice(): string | null {
  if (!boarded) return null;
  const riding = railway.view === 'train';
  if (!riding && railway.distanceToStop(player.root.position) > NOTICE_RANGE) return null;
  switch (railway.phase) {
    case 'stopped':
      return `문이 닫히기까지 ${formatWait(railway.secondsUntilClose)}`;
    case 'closing':
      return '문이 닫히고 있어요';
    case 'opening':
      return null;
    case 'arriving':
      return riding ? `곧 ${nextStation()}역에 도착해요` : '열차가 들어오고 있어요';
    default:
      return riding
        ? `${nextStation()}역까지 ${formatWait(railway.secondsUntilArrival)}`
        : `다음 열차까지 ${formatWait(railway.secondsUntilArrival)}`;
  }
}
railway.onArrive = (station) => {
  // Only for riders: someone waiting on the platform hasn't entered a new zone.
  if (boarded && onBoardTrain) banner.show(station.name);
};

// Player character with a random look on every visit.
const player = new Character(randomLook());
player.root.position.copy(SPAWN);
player.root.rotation.order = 'YXZ'; // seat sway tilts around the facing direction
scene.add(player.root);

const audio = new StationAudio();

// The one context button: board or leave the boat, ride the zipline, follow a signpost.
const seatPos = new THREE.Vector3();
/** The stream rides, when the player is standing at their station (not riding a train). */
function ridesHere(): StreamRides | null {
  return rides && railway.view === 'station' && railway.station === rides.zone ? rides : null;
}
/** Player position in a station's own coordinates. */
function localPos(zone: StationZone): THREE.Vector2 {
  const p = player.root.position;
  return new THREE.Vector2(p.x - zone.root.position.x, p.z - zone.root.position.z);
}
function near(zone: StationZone, spot: THREE.Vector2, range: number): boolean {
  return localPos(zone).distanceTo(spot) < range;
}
/** Signpost the player stands next to, if any. */
function nearSign() {
  const here = ridesHere();
  if (!here || onBoardTrain) return undefined;
  return here.zone.signs.find((sign) => near(here.zone, sign.pos, SIGN_RANGE));
}
function actionLabel(): string | null {
  if (!boarded || fade.active || onZip) return null;
  if (inBoat) return rides?.boat.stopped ? '내리기' : null;
  const here = ridesHere();
  if (here && !onBoardTrain) {
    if (here.zip.canBoard && near(here.zone, here.zone.zipline!.boardSpot, BOARD_RANGE)) return '짚라인 타기';
    if (here.boat.canBoard && near(here.zone, here.boat.pier.stand, BOARD_RANGE)) return '보트 타기';
  }
  return nearSign()?.label ?? null;
}
const actionButton = new ActionButton(() => {
  const here = ridesHere();
  if (!here) return;
  const { zone, boat, zip } = here;
  if (inBoat) {
    if (!boat.stopped) return;
    const stand = boat.alight();
    inBoat = false;
    player.seated = false;
    player.root.position.set(stand.x + zone.root.position.x, player.root.position.y, stand.y + zone.root.position.z);
    const n = boat.pier.normal;
    facing = Math.atan2(n.x, n.y); // face the bank, ready to walk off
  } else if (actionLabel() === '짚라인 타기') {
    // No ladder climbing: a soft fade, and you are seated at the top of the tower.
    fade.through(() => {
      zip.board();
      onZip = true;
      player.seated = true;
      facing = zip.facing;
      player.root.rotation.y = facing;
      zip.seat(seatPos);
      player.root.position.set(seatPos.x, seatPos.y - FOOT_HEIGHT, seatPos.z);
      followCam.snap(player.root.position, facing);
    });
  } else if (actionLabel() === '보트 타기') {
    boat.board();
    inBoat = true;
    player.seated = true;
  } else {
    // Signpost: carried to its partner behind a soft fade.
    const to = nearSign()?.partner;
    if (!to) return;
    fade.through(() => {
      const root = zone.root.position;
      const p = player.root.position;
      p.set(to.arrive.x + root.x, zone.heightAt(to.arrive.x, to.arrive.y), to.arrive.y + root.z);
      facing = to.arriveFacing;
      player.root.rotation.y = facing;
      followCam.snap(p, facing);
    });
  }
});
let walkSpeed = 0;

// Each step plays a footstep sound and leaves a print in the snow (not on wood).
const footPos = new THREE.Vector3();
player.onStep = (foot) => {
  if (!boarded) return;
  player.footWorldPosition(foot, footPos);
  const here = railway.station;
  const surface = onBoardTrain ? 'wood' : here.surfaceAt(footPos.x, footPos.z);
  audio.step(walkSpeed, surface);
  if (surface === 'snow' && here.season === 'winter') {
    footprints.add(footPos.x - here.root.position.x, footPos.z, player.root.rotation.y);
  }
};

// The creek sound comes from the nearest stream: its distance, and which side of the view it is on.
const creekPoint = new THREE.Vector2();
const camRight = new THREE.Vector3();
function updateCreekSound(): void {
  let best = Infinity;
  let pan = 0;
  for (const st of railway.loaded) {
    if (!st.creek) continue;
    const x = player.root.position.x - st.root.position.x; // station-local
    const z = player.root.position.z - st.root.position.z;
    const d = st.creek.nearest(x, z, creekPoint);
    if (d >= best) continue;
    best = d;
    const dx = creekPoint.x - x;
    const dz = creekPoint.y - z;
    const len = Math.hypot(dx, dz) || 1;
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    // Centered when standing at the water or on the bridge, more to one side the farther away.
    pan = ((dx * camRight.x + dz * camRight.z) / len) * 0.6 * THREE.MathUtils.smoothstep(d, 0.3, 4);
  }
  audio.setCreek(best, pan);
}

// Camera framing: close-up while choosing, third-person follow after boarding.
const ENTRANCE_CAM = {
  pos: SPAWN.clone().add(new THREE.Vector3(Math.sin(start.viewYaw) * 3, 0.85, Math.cos(start.viewYaw) * 3)),
  target: SPAWN.clone().add(new THREE.Vector3(0, 0.52, 0)),
};
let boarded = false;
let popTime = 1; // seconds since the last look change (drives a small bounce)

const camTarget = ENTRANCE_CAM.target.clone();
camera.position.copy(ENTRANCE_CAM.pos);
camera.lookAt(camTarget);

const input = new Input(container);
const followCam = new ThirdPersonCamera(camera);
followCam.yaw = start.viewYaw;
followCam.collide = (target, desired) => railway.collideCamera(target, desired);

const entrance = new Entrance({
  initial: player.look,
  onChange: (look) => {
    player.setLook(look);
    popTime = 0;
  },
  onBoard: () => {
    boarded = true;
    input.enabled = true;
    audio.start(); // inside the tap handler, so mobile browsers allow sound
    followCam.begin(camTarget);
    window.setTimeout(() => banner.show(railway.station.name), 900); // after the entrance panel fades
  },
});

// While the entrance panel is open, center the character in the free area above it.
const viewShift = new THREE.Vector2();
function targetViewShift(): THREE.Vector2 {
  if (boarded) return new THREE.Vector2(0, 0);
  const h = container.clientHeight;
  const cy = entrance.panel.getBoundingClientRect().top / 2 + 16;
  return new THREE.Vector2(0, h / 2 - cy);
}

function applyViewShift(): void {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.setViewOffset(w, h, viewShift.x, viewShift.y, w, h);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  snowfall.setViewport(h, camera.fov, renderer.getPixelRatio());
  viewShift.copy(targetViewShift());
  applyViewShift();
}
window.addEventListener('resize', resize);

// Starts at min(devicePixelRatio, 2) and steps down only if the frame rate suffers.
const quality = new AdaptiveQuality(renderer, (ratio) => {
  snowfall.setViewport(container.clientHeight, camera.fov, ratio);
});
resize();

/** Angle equivalent to `target` that is closest to `current`. */
function nearestAngle(current: number, target: number): number {
  const twoPi = Math.PI * 2;
  return target + Math.round((current - target) / twoPi) * twoPi;
}

const WALK_SPEED = 2.0; // m/s at full stick
const PLAYER_RADIUS = 0.3;
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const moveDir = new THREE.Vector3();
let facing = start.viewYaw + Math.PI; // after boarding the character turns its back to the camera

// Dev only: ?overview shows the whole layout from above.
const OVERVIEW = import.meta.env.DEV && params.has('overview');
if (OVERVIEW) scene.fog = null;
// Dev only: ?cam=x,y,z,tx,ty,tz pins the camera (for screenshots).
const PINNED = import.meta.env.DEV && params.get('cam')?.split(',').map(Number);

const clock = new THREE.Clock();
const frame = await setupDebugStats(renderer);
renderer.setAnimationLoop(() => {
  frame.begin();
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.1);
  quality.update(rawDt);
  let speed = 0;

  if (!boarded) {
    player.root.rotation.y += dt * 0.45;
    camera.position.lerp(ENTRANCE_CAM.pos, 1 - Math.exp(-2.5 * dt));
    camTarget.lerp(ENTRANCE_CAM.target, 1 - Math.exp(-2.5 * dt));
    camera.lookAt(camTarget);
  } else {
    input.update();
    const look = input.consumeLook();
    followCam.rotate(look.dx, look.dy);
    followCam.zoom(input.consumeZoom());

    // Move relative to where the camera is looking (not while sitting in the boat).
    const { x, y } = input.move;
    speed = inBoat || onZip ? 0 : Math.hypot(x, y);
    if (speed > 0) {
      moveDir
        .copy(followCam.right(tmpRight).multiplyScalar(x))
        .add(followCam.forward(tmpForward).multiplyScalar(y));
      player.root.position.addScaledVector(moveDir, WALK_SPEED * dt);
      facing = Math.atan2(moveDir.x, moveDir.z);
    }

    const p = player.root.position;
    if (onZip && rides) {
      // Seated on the zipline: hang from the seat, swinging with it.
      rides.zip.seat(seatPos);
      p.set(seatPos.x, seatPos.y - FOOT_HEIGHT, seatPos.z);
      facing = rides.zip.facing;
      player.root.rotation.x = rides.zip.tilt;
      onBoardTrain = false;
    } else if (inBoat && rides) {
      // Seated in the boat: follow the seat, facing the bow.
      rides.boat.seat(seatPos);
      p.set(seatPos.x, seatPos.y - FOOT_HEIGHT, seatPos.z);
      facing = rides.boat.yaw;
      onBoardTrain = false;
    } else {
      // Every frame, not only while moving: closing doors must push a player out of the doorway.
      const car = railway.carAt(p);
      if (car >= 0) railway.constrainInside(car, p, PLAYER_RADIUS);
      else railway.station.constrain(p, PLAYER_RADIUS);
      onBoardTrain = railway.isInside(p);

      // Step up onto / down from the platform and the car floor smoothly.
      const ground = onBoardTrain ? TRAIN_FLOOR : railway.station.heightAt(p.x, p.z);
      p.y = THREE.MathUtils.damp(p.y, ground, 14, dt);
    }

    const goal = nearestAngle(player.root.rotation.y, facing);
    const turnRate = inBoat || onZip ? 20 : speed > 0 ? 10 : 3; // riding: turn with the seat
    player.root.rotation.y = THREE.MathUtils.damp(player.root.rotation.y, goal, turnRate, dt);
    followCam.update(dt, player.root.position);
  }

  // Small bounce when the look changes.
  popTime += dt;
  const pop = popTime < 0.35 ? Math.sin((popTime / 0.35) * Math.PI) * 0.08 : 0;
  player.root.scale.setScalar(1 + pop);

  viewShift.lerp(targetViewShift(), 1 - Math.exp(-4 * dt));
  applyViewShift();

  walkSpeed = speed;
  player.update(dt, speed);
  railway.update(dt, player.root.position);
  doorTimer.update(trainNotice());
  // Sky, ground, snowfall and the ambience follow the season of wherever the view is on the line.
  const season = railway.viewSeason;
  backdrop.setPalette(season.palette);
  const indoors = railway.isInside(camera.position);
  snowfall.setIntensity(season.weights.winter);
  snowfall.points.visible = !indoors && season.weights.winter > 0.01;
  audio.setSeasonMix(season.weights);
  updateCreekSound();
  audio.setZipSpeed(onZip && rides ? rides.zip.speedRatio : 0);
  audio.setIndoor(onBoardTrain, railway.doorOpen);
  audio.setTrain(railway.speedRatio, onBoardTrain, railway.nearestCarDistance(player.root.position));
  audio.update(dt);
  footprints.update(dt);
  for (const st of railway.loaded) st.update?.(dt);
  rides?.boat.update(dt);
  rides?.zip.update(dt);
  actionButton.set(actionLabel());
  snowfall.update(dt, camera);
  if (OVERVIEW) {
    camera.clearViewOffset();
    camera.position.set(0, 140, 40);
    camera.lookAt(0, 0, -4);
  } else if (PINNED && PINNED.length === 6) {
    camera.clearViewOffset();
    camera.position.set(PINNED[0], PINNED[1], PINNED[2]);
    camera.lookAt(PINNED[3], PINNED[4], PINNED[5]);
  }
  renderer.render(scene, camera);
  frame.end();
});

// Dev only: ?board skips the entrance (handy for screenshots and quick testing).
if (import.meta.env.DEV && new URLSearchParams(location.search).has('board')) {
  document.querySelector<HTMLButtonElement>('.button--primary')?.click();
}
// Dev only: ?ride (with ?board) starts inside the train car, to watch stations load along the way.
if (import.meta.env.DEV && params.has('ride') && boarded) {
  player.root.position.set(0, TRAIN_FLOOR, RAIL_Z);
}
// Dev only: ?boat=<meters> (with ?board&station=1) starts a boat ride that far below the dock.
const devRidesBoat = rides as StreamRides | null; // set by railway.onLoad
if (import.meta.env.DEV && params.has('boat') && boarded && devRidesBoat) {
  devRidesBoat.boat.debugStart(Number(params.get('boat')) || 0);
  inBoat = true;
  player.seated = true;
}
// Dev only: ?zip=<meters> (with ?board&station=1) starts a zipline ride that far down the cable.
const devRidesZip = rides as StreamRides | null; // set by railway.onLoad
if (import.meta.env.DEV && params.has('zip') && boarded && devRidesZip) {
  devRidesZip.zip.debugStart(Number(params.get('zip')) || 0);
  onZip = true;
  player.seated = true;
}
