// Snowballs and snowmen at the winter station (CLAUDE.md: "눈덩이 굴려 눈사람 만들기").
// Press "눈 굴리기" on the snow and a small ball appears in front of you; walking rolls it and it
// grows. "내려놓기" leaves it there. Holding a smaller ball next to a bigger one, "올리기" stacks it
// and the pair becomes a snowman with coal eyes, a carrot nose and twig arms.
// A small fixed pool of instanced balls is reused oldest-first, so a few snowmen stay around as
// traces. Positions are in the winter station's local coordinates (the mesh lives under its root,
// like the footprints), so they outlast a reload of the station's scenery.
import * as THREE from 'three';
import { cylinder, jitter, merge, paint, propMaterial } from '../scenes/lowpoly';

const MAX_BALLS = 12;
const START_RADIUS = 0.12;
export const MAX_RADIUS = 0.75; // 1.5 m across, a little taller than the character
/** Rolling area gain: r² grows by this much per meter rolled, so growth slows as the ball gets big. */
const GROW = 0.014;
const HOLD_GAP = 0.3; // between the character's center and the ball's surface
const SINK = 0.92; // the ball sits a little into the snow
const STACK_REACH = 0.45; // m of air allowed between the two balls when stacking
const RESUME_REACH = 0.55; // m from a lying ball's surface to pick it up and roll on
const STACK_RATIO = 1; // the bottom ball must be at least as big as the one lifted onto it

interface Ball {
  x: number;
  z: number;
  y: number;
  r: number;
  rot: THREE.Quaternion;
  below: Ball | null;
  above: Ball | null;
  /** Facing of the snowman (radians), set when a head is stacked. */
  yaw: number;
  born: number;
  alive: boolean;
}

/** Ball geometry: a slightly lumpy icosphere with faint per-face tint so rolling is visible. */
function createBallGeometry(): THREE.BufferGeometry {
  let a = 7;
  const rand = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const geo = jitter(new THREE.IcosahedronGeometry(1, 1), 0.06, rand).toNonIndexed();
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const white = new THREE.Color('#f7f9fc');
  const blue = new THREE.Color('#dfe7f1');
  const c = new THREE.Color();
  for (let f = 0; f < count / 3; f++) {
    c.copy(white).lerp(blue, rand() < 0.25 ? 0.6 + rand() * 0.4 : rand() * 0.25);
    for (let v = 0; v < 3; v++) c.toArray(colors, (f * 3 + v) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Unlit material whose fake light follows the world, not the mesh: a rolling ball keeps its bright
 * top instead of carrying baked shading around with it.
 */
function createBallMaterial(): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying float vShade;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 shadeN = normal;
        #ifdef USE_INSTANCING
          shadeN = mat3(instanceMatrix) * shadeN;
        #endif
        shadeN = normalize(mat3(modelMatrix) * shadeN);
        vShade = mix(0.82, 1.0, clamp(dot(shadeN, normalize(vec3(-0.5, 0.8, 0.6))) * 0.5 + 0.5, 0.0, 1.0));`,
      );
    shader.fragmentShader =
      'varying float vShade;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        'gl_FragColor.rgb *= vShade;\n#include <dithering_fragment>',
      );
  };
  return mat;
}

/** Coal eyes, a carrot nose and a little coal smile, in head-radius units, facing +z. */
function createFaceGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const onHead = (yaw: number, pitch: number, size: number, color: string) => {
    const g = new THREE.IcosahedronGeometry(size, 0);
    g.translate(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    parts.push(paint(g, color, { min: 0.8 }));
  };
  onHead(-0.33, 0.28, 0.09, '#3a3a40');
  onHead(0.33, 0.28, 0.09, '#3a3a40');
  for (let k = 0; k < 5; k++) onHead(-0.36 + k * 0.18, -0.3 - Math.sin((k / 4) * Math.PI) * 0.1, 0.05, '#4a4a52');
  const nose = new THREE.ConeGeometry(0.11, 0.5, 6);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0.02, 1.15);
  parts.push(paint(nose, '#f08a3c', { min: 0.75 }));
  return merge(parts);
}

/** Two twig arms with a small fork each, in body-radius units, sticking out sideways. */
function createArmsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const arm = cylinder(0.035, 0.9, 0, 0.45, 0, '#6e5648');
    arm.rotateZ(side * -1.0); // out and up
    arm.translate(side * 0.75, 0.42, 0);
    parts.push(arm);
    const twig = cylinder(0.025, 0.28, 0, 0.14, 0, '#6e5648');
    twig.rotateZ(side * -0.2);
    twig.translate(side * 1.22, 0.78, 0);
    parts.push(twig);
  }
  return merge(parts);
}

export class Snowballs {
  readonly root = new THREE.Group();
  private balls: Ball[] = [];
  private held: Ball | null = null;
  private ballMesh: THREE.InstancedMesh;
  private faceMesh: THREE.InstancedMesh;
  private armMesh: THREE.InstancedMesh;
  private disposables: { dispose: () => void }[] = [];
  private clock = 0;
  private dirty = true;
  private m = new THREE.Matrix4();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private axis = new THREE.Vector3();

  constructor() {
    const ballGeo = createBallGeometry();
    const ballMat = createBallMaterial();
    const faceGeo = createFaceGeometry();
    const armGeo = createArmsGeometry();
    this.disposables.push(ballGeo, ballMat, faceGeo, armGeo);
    this.ballMesh = new THREE.InstancedMesh(ballGeo, ballMat, MAX_BALLS);
    this.faceMesh = new THREE.InstancedMesh(faceGeo, propMaterial, MAX_BALLS);
    this.armMesh = new THREE.InstancedMesh(armGeo, propMaterial, MAX_BALLS);
    for (const mesh of [this.ballMesh, this.faceMesh, this.armMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // instances are spread around the station
      this.root.add(mesh);
      this.disposables.push(mesh);
    }
    for (let i = 0; i < MAX_BALLS; i++) {
      this.balls.push({
        x: 0, z: 0, y: 0, r: 0, rot: new THREE.Quaternion(),
        below: null, above: null, yaw: 0, born: 0, alive: false,
      });
    }
  }

  get holding(): boolean {
    return this.held !== null;
  }

  /** Radius of the ball being rolled, 0 when none. */
  get heldRadius(): number {
    return this.held?.r ?? 0;
  }

  /** Starts rolling: picks up a lying ball within reach, or makes a fresh one in front of you. */
  start(px: number, pz: number, yaw: number): void {
    if (this.held) return;
    const lying = this.lyingBallNear(px, pz);
    if (lying) {
      this.held = lying;
    } else {
      const ball = this.allocate();
      ball.r = START_RADIUS;
      ball.rot.identity();
      ball.x = px + Math.sin(yaw) * (HOLD_GAP + ball.r);
      ball.z = pz + Math.cos(yaw) * (HOLD_GAP + ball.r);
      ball.y = ball.r * SINK;
      this.held = ball;
    }
    this.held.born = this.clock;
    this.dirty = true;
  }

  /**
   * Moves the held ball in front of the character. It rolls by however far it actually moved, and
   * grows only on snow. `constrain` keeps it out of obstacles (station-local, like the player).
   */
  carry(px: number, pz: number, yaw: number, onSnow: boolean, constrain: (p: THREE.Vector3, r: number) => void): void {
    const ball = this.held;
    if (!ball) return;
    const reach = HOLD_GAP + ball.r;
    const p = this.v.set(px + Math.sin(yaw) * reach, 0, pz + Math.cos(yaw) * reach);
    constrain(p, ball.r);
    this.pushOutOfBalls(p, ball.r, ball);
    const dx = p.x - ball.x;
    const dz = p.z - ball.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-5) return;
    ball.x = p.x;
    ball.z = p.z;
    // Roll: turn about the horizontal axis across the motion, by arc length / radius.
    this.axis.set(dz, 0, -dx).normalize();
    ball.rot.premultiply(this.q.setFromAxisAngle(this.axis, dist / ball.r));
    if (onSnow && ball.r < MAX_RADIUS) ball.r = Math.min(MAX_RADIUS, Math.sqrt(ball.r * ball.r + GROW * dist));
    ball.y = ball.r * SINK;
    this.dirty = true;
  }

  /** Leaves the held ball where it is. */
  release(): void {
    if (!this.held) return;
    this.held.born = this.clock;
    this.held = null;
    this.dirty = true;
  }

  /** A lying ball the held one could be stacked on, if any. */
  stackTarget(): Ball | null {
    const held = this.held;
    if (!held) return null;
    let best: Ball | null = null;
    let bestGap = STACK_REACH;
    for (const b of this.balls) {
      if (!b.alive || b === held || b.below || b.above || b.r < held.r * STACK_RATIO) continue;
      const gap = Math.hypot(b.x - held.x, b.z - held.z) - b.r - held.r;
      if (gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
    return best;
  }

  /** Lifts the held ball onto `base`; the snowman faces toward (px, pz), where you stand. */
  stack(base: Ball, px: number, pz: number): void {
    const head = this.held;
    if (!head) return;
    head.x = base.x;
    head.z = base.z;
    head.y = base.y + base.r * 0.78 + head.r * 0.78;
    head.below = base;
    base.above = head;
    head.yaw = base.yaw = Math.atan2(px - base.x, pz - base.z);
    head.born = base.born = this.clock;
    this.held = null;
    this.dirty = true;
  }

  /** Whether there is a lying ball close enough to pick up and roll on. */
  canResume(px: number, pz: number): boolean {
    return this.lyingBallNear(px, pz) !== null;
  }

  /** Keeps the player (station-local position) out of lying balls and snowmen. */
  constrain(p: THREE.Vector3, radius: number): void {
    this.pushOutOfBalls(p, radius, this.held);
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.dirty) return;
    this.dirty = false;
    const hidden = this.hidden;
    this.balls.forEach((b, i) => {
      if (!b.alive) {
        this.ballMesh.setMatrixAt(i, hidden);
        this.faceMesh.setMatrixAt(i, hidden);
        this.armMesh.setMatrixAt(i, hidden);
        return;
      }
      this.ballMesh.setMatrixAt(i, this.m.compose(this.v.set(b.x, b.y, b.z), b.rot, this.s.setScalar(b.r)));
      this.q.setFromAxisAngle(this.up, b.yaw);
      // A head (with a ball below) gets a face; a body (with a ball above) gets the arms.
      this.faceMesh.setMatrixAt(i, b.below ? this.m.compose(this.v.set(b.x, b.y, b.z), this.q, this.s.setScalar(b.r)) : hidden);
      this.armMesh.setMatrixAt(i, b.above ? this.m.compose(this.v.set(b.x, b.y, b.z), this.q, this.s.setScalar(b.r)) : hidden);
    });
    for (const mesh of [this.ballMesh, this.faceMesh, this.armMesh]) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.disposables.forEach((d) => d.dispose());
  }

  private lyingBallNear(px: number, pz: number): Ball | null {
    let best: Ball | null = null;
    let bestGap = RESUME_REACH;
    for (const b of this.balls) {
      if (!b.alive || b === this.held || b.below || b.above) continue;
      const gap = Math.hypot(b.x - px, b.z - pz) - b.r;
      if (gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
    return best;
  }

  /** A free slot, or the oldest lying ball or snowman (never the one being rolled). */
  private allocate(): Ball {
    const free = this.balls.find((b) => !b.alive);
    const ball =
      free ??
      this.balls
        .filter((b) => b !== this.held && !b.below)
        .reduce((oldest, b) => (b.born < oldest.born ? b : oldest));
    if (ball.above) this.free(ball.above);
    this.free(ball);
    ball.alive = true;
    return ball;
  }

  private free(b: Ball): void {
    b.alive = false;
    b.above = null;
    b.below = null;
    b.yaw = 0;
  }

  private pushOutOfBalls(p: THREE.Vector3, radius: number, skip: Ball | null): void {
    for (const b of this.balls) {
      if (!b.alive || b === skip || b.below) continue; // a head rests on its body: the body is enough
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const min = b.r * 0.9 + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = b.x + (dx / d) * min;
        p.z = b.z + (dz / d) * min;
      }
    }
  }
}
