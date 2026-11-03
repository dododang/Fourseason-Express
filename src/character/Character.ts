// Round, simple character built from shared primitives.
// Walk animation is procedural; onStep fires when a foot touches the ground.
import * as THREE from 'three';
import { bakeShade, shadedMaterial } from './shading';
import { deformToFace, getHairGeometry, getHeadGeometry } from './faceShapes';
import { BODY_TYPES, COAT_COLORS, FACE_SHAPES, HAIR_COLORS, type CharacterLook } from './options';

const SKIN = '#f2d4ba';
const BOOTS = '#8c7b70';
const EYES = '#2f2a2a';
const CHEEKS = '#f0b3a6';

const HEAD_RADIUS = 0.3;
const FOOT_HEIGHT = 0.07;

// Shared geometries (unit sizes, scaled per mesh).
const sphereGeo = bakeShade(new THREE.SphereGeometry(1, 20, 14));
const smallSphereGeo = new THREE.SphereGeometry(1, 8, 6);
const eyeMat = new THREE.MeshBasicMaterial({ color: EYES });
const cheekMat = new THREE.MeshBasicMaterial({ color: CHEEKS, transparent: true, opacity: 0.85 });

let shadowGeo: THREE.CircleGeometry | null = null;
let shadowMat: THREE.MeshBasicMaterial | null = null;

// Soft blob shadow under the character (no real-time shadows).
function createShadow(): THREE.Mesh {
  if (!shadowGeo || !shadowMat) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(60,70,90,0.35)');
    grad.addColorStop(1, 'rgba(60,70,90,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    shadowGeo = new THREE.CircleGeometry(1, 16);
    shadowMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    });
  }
  const mesh = new THREE.Mesh(shadowGeo, shadowMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.005;
  return mesh;
}

export class Character {
  readonly root = new THREE.Group();
  onStep: ((foot: 0 | 1) => void) | null = null;

  private bodyPivot = new THREE.Group();
  private body = new THREE.Mesh(sphereGeo, shadedMaterial(COAT_COLORS[0].color));
  private headGroup = new THREE.Group();
  private head = new THREE.Mesh(getHeadGeometry('round'), shadedMaterial(SKIN));
  private hair = new THREE.Mesh(getHairGeometry('round'), shadedMaterial(HAIR_COLORS[0].color));
  private eyes = [new THREE.Mesh(smallSphereGeo, eyeMat), new THREE.Mesh(smallSphereGeo, eyeMat)];
  private cheeks = [new THREE.Mesh(smallSphereGeo, cheekMat), new THREE.Mesh(smallSphereGeo, cheekMat)];
  private feet = [new THREE.Mesh(sphereGeo, shadedMaterial(BOOTS)), new THREE.Mesh(sphereGeo, shadedMaterial(BOOTS))];
  private arms = [new THREE.Group(), new THREE.Group()];
  private sleeves: THREE.Mesh[] = [];
  private shadow = createShadow();

  private footSpacing = 0;
  private walkPhase = 0;
  private walkBlend = 0;
  private time = Math.random() * 10;

  constructor(look: CharacterLook) {
    this.headGroup.add(this.head, this.hair, ...this.eyes, ...this.cheeks);
    // Each arm is a pivot at the shoulder: a coat sleeve with a skin-colored hand at the tip.
    for (const arm of this.arms) {
      const sleeve = new THREE.Mesh(sphereGeo, shadedMaterial(COAT_COLORS[0].color));
      sleeve.scale.set(0.06, 0.1, 0.065);
      sleeve.position.y = -0.07;
      const hand = new THREE.Mesh(sphereGeo, shadedMaterial(SKIN));
      hand.scale.setScalar(0.045);
      hand.position.y = -0.17;
      arm.add(sleeve, hand);
      this.sleeves.push(sleeve);
    }
    this.bodyPivot.add(this.body, this.headGroup, ...this.arms);
    this.root.add(this.shadow, this.bodyPivot, ...this.feet);
    this.setLook(look);
  }

  private currentLook!: CharacterLook;

  get look(): CharacterLook {
    return { ...this.currentLook };
  }

  setLook(look: CharacterLook): void {
    this.currentLook = { ...look };
    const coatMat = shadedMaterial(COAT_COLORS[look.coat].color);
    this.body.material = coatMat;
    for (const sleeve of this.sleeves) sleeve.material = coatMat;

    const [bx, by, bz] = BODY_TYPES[look.body].scale;
    const faceKind = FACE_SHAPES[look.face].kind;
    this.head.geometry = getHeadGeometry(faceKind);
    this.hair.geometry = getHairGeometry(faceKind);
    this.hair.material = shadedMaterial(HAIR_COLORS[look.hair].color);

    // Body sits on top of the feet.
    this.body.scale.set(bx, by, bz);
    this.body.position.y = by;

    // Head overlaps the top of the body a little.
    const r = HEAD_RADIUS;
    this.head.scale.setScalar(r);
    this.hair.scale.setScalar(r);
    this.headGroup.position.y = by * 2 + r * 0.5;

    // Shoulders sit on the upper sides of the body.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.arms[i].position.set(side * bx * 0.9, by * 1.35, 0);
      this.arms[i].rotation.z = side * 0.35;
    }

    // Place a facial feature on the head surface along a direction.
    const onFace = (mesh: THREE.Mesh, dx: number, dy: number, size: [number, number, number]) => {
      const dz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      const p = deformToFace(faceKind, new THREE.Vector3(dx, dy, dz));
      mesh.position.copy(p).multiplyScalar(r * 0.99);
      mesh.scale.set(...size);
      mesh.lookAt(mesh.position.clone().multiplyScalar(2));
    };
    onFace(this.eyes[0], -0.32, -0.04, [0.034, 0.044, 0.014]);
    onFace(this.eyes[1], 0.32, -0.04, [0.034, 0.044, 0.014]);
    onFace(this.cheeks[0], -0.5, -0.28, [0.05, 0.032, 0.008]);
    onFace(this.cheeks[1], 0.5, -0.28, [0.05, 0.032, 0.008]);

    // Feet peek out under the body.
    this.footSpacing = bx * 0.5;
    for (const foot of this.feet) foot.scale.set(0.085, FOOT_HEIGHT, 0.12);

    this.shadow.scale.setScalar(Math.max(bx, bz) * 1.5);
  }

  /** speed: 0 = standing, 1 = normal walk. */
  update(dt: number, speed: number): void {
    this.time += dt;
    const walking = speed > 0.05;
    this.walkBlend = THREE.MathUtils.damp(this.walkBlend, walking ? 1 : 0, 8, dt);

    // Walk cycle: one full phase = two steps.
    const prevSin = Math.sin(this.walkPhase);
    if (walking) this.walkPhase += dt * (6 + speed * 4);
    const s = Math.sin(this.walkPhase);
    if (this.walkBlend > 0.5 && Math.sign(prevSin) !== Math.sign(s)) {
      this.onStep?.(s > 0 ? 0 : 1);
    }

    const w = this.walkBlend;
    const stride = 0.11 * w;
    const lift = 0.05 * w;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const phase = i === 0 ? s : -s;
      const foot = this.feet[i];
      const up = Math.max(0, Math.cos(this.walkPhase + (i === 0 ? 0 : Math.PI))) * lift;
      foot.position.set(side * this.footSpacing, FOOT_HEIGHT + up, phase * stride + 0.03);
    }

    // Body: bob and sway while walking, slow breathing while standing.
    const breathe = Math.sin(this.time * 1.7) * 0.015 * (1 - w);
    this.bodyPivot.position.y = FOOT_HEIGHT + Math.abs(s) * 0.035 * w;
    this.bodyPivot.rotation.z = s * 0.07 * w;
    this.bodyPivot.rotation.x = 0.06 * w;
    this.bodyPivot.scale.set(1 - breathe * 0.5, 1 + breathe, 1 - breathe * 0.5);
    this.headGroup.rotation.z = -s * 0.04 * w;

    // Arms swing opposite to the feet.
    this.arms[0].rotation.x = -s * 0.6 * w;
    this.arms[1].rotation.x = s * 0.6 * w;
  }
}
