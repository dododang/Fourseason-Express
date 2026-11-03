// Entry point: renderer setup and game loop.
import * as THREE from 'three';
import { Character } from './character/Character';
import { randomLook } from './character/options';
import { Entrance } from './ui/entrance';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// Palette
const SKY_TOP = new THREE.Color('#9fbad6');
const HORIZON = new THREE.Color('#e3e9f0');
const SNOW = new THREE.Color('#f8fafd');
const MOUNTAIN_LIT = new THREE.Color('#b4c3d4');
const MOUNTAIN_SHADE = new THREE.Color('#8ea0b6');

const scene = new THREE.Scene();
scene.background = HORIZON;
scene.fog = new THREE.Fog(HORIZON, 20, 85);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
camera.position.set(0, 1.3, 6.5);
camera.lookAt(0, 0.5, 0);

// No dynamic lights: unlit materials only (per performance rules).

// Sky dome with a vertical gradient baked into vertex colors.
function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(150, 16, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 150, 0, 1);
    c.copy(HORIZON).lerp(SKY_TOP, Math.pow(t, 0.6));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

// Ring of low-poly mountains. Faces get a fake baked shade based on their normal.
function createMountains(): THREE.InstancedMesh {
  const geo = new THREE.ConeGeometry(1, 1, 5, 1).toNonIndexed();
  geo.computeVertexNormals();
  const normals = geo.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  const c = new THREE.Color();
  const lightDir = new THREE.Vector3(-0.6, 0.5, 0.4).normalize();
  for (let i = 0; i < normals.count; i += 3) {
    const n = new THREE.Vector3().fromBufferAttribute(normals, i);
    const shade = THREE.MathUtils.clamp(n.dot(lightDir) * 0.5 + 0.5, 0, 1);
    c.copy(MOUNTAIN_SHADE).lerp(MOUNTAIN_LIT, shade);
    for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const count = 18;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.2;
    const radius = 60 + Math.random() * 15;
    const height = 8 + Math.random() * 10;
    const width = 10 + Math.random() * 8;
    p.set(Math.cos(angle) * radius, height / 2 - 0.5, Math.sin(angle) * radius);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    s.set(width, height, width);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }
  return mesh;
}

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(100, 24),
  new THREE.MeshBasicMaterial({ color: SNOW }),
);
ground.rotation.x = -Math.PI / 2;

scene.add(createSky(), createMountains(), ground);

// Player character with a random look on every visit.
const player = new Character(randomLook());
scene.add(player.root);

// Camera framing: close-up while choosing, behind the character after boarding.
const ENTRANCE_CAM = { pos: new THREE.Vector3(0, 0.85, 3.0), target: new THREE.Vector3(0, 0.52, 0) };
const PLAY_CAM = { pos: new THREE.Vector3(0, 1.7, 3.6), target: new THREE.Vector3(0, 0.6, 0) };
let boarded = false;
let popTime = 1; // seconds since the last look change (drives a small bounce)

const camTarget = ENTRANCE_CAM.target.clone();
camera.position.copy(ENTRANCE_CAM.pos);
camera.lookAt(camTarget);

const entrance = new Entrance({
  initial: player.look,
  onChange: (look) => {
    player.setLook(look);
    popTime = 0;
  },
  onBoard: () => {
    boarded = true;
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
  viewShift.copy(targetViewShift());
  applyViewShift();
}
window.addEventListener('resize', resize);
resize();

/** Angle equivalent to `target` that is closest to `current`. */
function nearestAngle(current: number, target: number): number {
  const twoPi = Math.PI * 2;
  return target + Math.round((current - target) / twoPi) * twoPi;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (!boarded) {
    player.root.rotation.y += dt * 0.45;
  } else {
    // Turn to show the back, as in the third-person view.
    const goal = nearestAngle(player.root.rotation.y, Math.PI);
    player.root.rotation.y = THREE.MathUtils.damp(player.root.rotation.y, goal, 3, dt);
  }

  // Small bounce when the look changes.
  popTime += dt;
  const pop = popTime < 0.35 ? Math.sin((popTime / 0.35) * Math.PI) * 0.08 : 0;
  player.root.scale.setScalar(1 + pop);

  const cam = boarded ? PLAY_CAM : ENTRANCE_CAM;
  camera.position.lerp(cam.pos, 1 - Math.exp(-2.5 * dt));
  camTarget.lerp(cam.target, 1 - Math.exp(-2.5 * dt));
  camera.lookAt(camTarget);

  viewShift.lerp(targetViewShift(), 1 - Math.exp(-4 * dt));
  applyViewShift();

  player.update(dt, 0);
  renderer.render(scene, camera);
});
