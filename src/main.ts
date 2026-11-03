// Entry point: renderer setup and game loop.
import * as THREE from 'three';
import { Character } from './character/Character';
import { randomLook } from './character/options';
import { Entrance } from './ui/entrance';
import { setupDebugStats } from './systems/debugStats';
import { Input } from './controls/input';
import { ThirdPersonCamera } from './controls/ThirdPersonCamera';
import { buildWinterScene } from './scenes/winter';
import { buildTrainScene } from './scenes/train';
import { Footprints } from './systems/footprints';
import { Snowfall } from './systems/snowfall';
import { WinterAudio } from './audio/WinterAudio';
import { AdaptiveQuality } from './systems/adaptiveQuality';

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
// Dev only: ?scene=train opens the train interior instead of the winter station.
const params = new URLSearchParams(location.search);
const inTrain = import.meta.env.DEV && params.get('scene') === 'train';
const world = inTrain ? buildTrainScene(scene) : buildWinterScene(scene);
const SPAWN = world.spawn;
const footprints = new Footprints();
const snowfall = new Snowfall();
scene.add(footprints.mesh);
if (world.snowfall) scene.add(snowfall.points);

// Player character with a random look on every visit.
const player = new Character(randomLook());
player.root.position.copy(SPAWN);
scene.add(player.root);

const audio = new WinterAudio();
let walkSpeed = 0;

// Each step plays a footstep sound and leaves a print in the snow (not on wood).
const footPos = new THREE.Vector3();
player.onStep = (foot) => {
  if (!boarded) return;
  player.footWorldPosition(foot, footPos);
  const onWood = world.surfaceAt(footPos.x, footPos.z) === 'wood';
  audio.step(walkSpeed, onWood);
  if (!onWood) footprints.add(footPos.x, footPos.z, player.root.rotation.y);
};

// Camera framing: close-up while choosing, third-person follow after boarding.
const ENTRANCE_CAM = {
  pos: SPAWN.clone().add(new THREE.Vector3(Math.sin(world.viewYaw) * 3, 0.85, Math.cos(world.viewYaw) * 3)),
  target: SPAWN.clone().add(new THREE.Vector3(0, 0.52, 0)),
};
let boarded = false;
let popTime = 1; // seconds since the last look change (drives a small bounce)

const camTarget = ENTRANCE_CAM.target.clone();
camera.position.copy(ENTRANCE_CAM.pos);
camera.lookAt(camTarget);

const input = new Input(container);
const followCam = new ThirdPersonCamera(camera);
followCam.yaw = world.viewYaw;
followCam.bounds = world.cameraBounds ?? null;

const entrance = new Entrance({
  initial: player.look,
  onChange: (look) => {
    player.setLook(look);
    popTime = 0;
  },
  onBoard: () => {
    boarded = true;
    input.enabled = true;
    audio.start(world.snowfall); // inside the tap handler, so mobile browsers allow sound
    followCam.begin(camTarget);
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
let facing = world.viewYaw + Math.PI; // after boarding the character turns its back to the camera

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

    // Move relative to where the camera is looking.
    const { x, y } = input.move;
    speed = Math.hypot(x, y);
    if (speed > 0) {
      moveDir
        .copy(followCam.right(tmpRight).multiplyScalar(x))
        .add(followCam.forward(tmpForward).multiplyScalar(y));
      player.root.position.addScaledVector(moveDir, WALK_SPEED * dt);
      facing = Math.atan2(moveDir.x, moveDir.z);

      world.constrain(player.root.position, PLAYER_RADIUS);
    }

    // Step up onto / down from the platform smoothly.
    const p = player.root.position;
    p.y = THREE.MathUtils.damp(p.y, world.heightAt(p.x, p.z), 14, dt);

    const goal = nearestAngle(player.root.rotation.y, facing);
    player.root.rotation.y = THREE.MathUtils.damp(player.root.rotation.y, goal, speed > 0 ? 10 : 3, dt);
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
  world.update?.(dt);
  audio.update(dt);
  footprints.update(dt);
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
