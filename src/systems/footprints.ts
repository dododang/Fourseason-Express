// Footprints left in the snow. A fixed pool of instanced quads is reused oldest-first,
// and each print fades out over time via a per-instance opacity attribute.
import * as THREE from 'three';

const MAX_PRINTS = 120;
const HOLD_SECONDS = 20; // fully visible
const FADE_SECONDS = 25; // then fades away

// A soft oval that matches the character's round feet.
function createPrintTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class Footprints {
  readonly mesh: THREE.InstancedMesh;
  private ages = new Float32Array(MAX_PRINTS).fill(Infinity);
  private fade: THREE.InstancedBufferAttribute;
  private next = 0;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private texture = createPrintTexture();

  constructor() {
    // Slightly smaller than the foot (0.17 × 0.24 across) so it reads as a light press.
    const geo = new THREE.PlaneGeometry(0.15, 0.21);
    geo.rotateX(-Math.PI / 2);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);

    const mat = new THREE.MeshBasicMaterial({
      color: '#9fadbf',
      alphaMap: this.texture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    // Multiply the final alpha by the per-instance fade value.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute float aFade;\nvarying float vFade;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
      shader.fragmentShader =
        'varying float vFade;\n' +
        shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\ngl_FragColor.a *= vFade;',
        );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PRINTS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // instances are spread around the world
    this.mesh.renderOrder = 1;
    // Start with every slot collapsed and invisible.
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PRINTS; i++) this.mesh.setMatrixAt(i, this.matrix);
  }

  /** Stamp a print at a ground position, facing `yaw` (the character's heading). */
  add(x: number, z: number, yaw: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PRINTS;
    this.quat.setFromAxisAngle(this.up, yaw);
    this.pos.set(x, 0.012, z);
    this.mesh.setMatrixAt(i, this.matrix.compose(this.pos, this.quat, this.scale));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.ages[i] = 0;
  }

  update(dt: number): void {
    const arr = this.fade.array as Float32Array;
    for (let i = 0; i < MAX_PRINTS; i++) {
      const age = (this.ages[i] += dt);
      arr[i] = age < HOLD_SECONDS ? 1 : Math.max(0, 1 - (age - HOLD_SECONDS) / FADE_SECONDS);
    }
    this.fade.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }
}
