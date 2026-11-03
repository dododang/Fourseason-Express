// Gentle snowfall. Flakes live in a box that wraps around the camera, and all motion
// is computed in the vertex shader, so the CPU only updates two uniforms per frame.
import * as THREE from 'three';

const COUNT = 1000;
const BOX = new THREE.Vector3(28, 14, 28); // size of the wrapping volume around the camera

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform vec3 uCamera;
  uniform vec3 uBox;
  uniform float uIntensity;
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aSize;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    p.y -= uTime * aSpeed;
    p.x += sin(uTime * 0.6 + aPhase) * 0.35;
    p.z += cos(uTime * 0.5 + aPhase * 1.3) * 0.35;

    // Wrap into a box centered on the camera.
    vec3 origin = uCamera - uBox * 0.5;
    p = origin + mod(p - origin, uBox);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;

    // Fade near the edges of the box and very close to the camera.
    float dist = length(p - uCamera);
    vAlpha = smoothstep(0.6, 1.8, dist) * (1.0 - smoothstep(9.0, 13.5, dist));
    // Thin out toward spring: fewer flakes rather than fainter ones.
    vAlpha *= step(fract(aPhase * 7.31), uIntensity);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.15, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, a * 0.9);
  }
`;

export class Snowfall {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor() {
    const positions = new Float32Array(COUNT * 3);
    const speed = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);
    const size = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = Math.random() * BOX.x;
      positions[i * 3 + 1] = Math.random() * BOX.y;
      positions[i * 3 + 2] = Math.random() * BOX.z;
      speed[i] = 0.45 + Math.random() * 0.5;
      phase[i] = Math.random() * Math.PI * 2;
      size[i] = 0.035 + Math.random() * 0.04;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uCamera: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        uIntensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false; // positions are moved in the shader
    this.points.renderOrder = 2;
  }

  /** 0 = no snow, 1 = full snowfall. */
  setIntensity(t: number): void {
    this.material.uniforms.uIntensity.value = t;
  }

  /** Call on resize: converts world-size flakes to pixels. */
  setViewport(heightPx: number, fovDeg: number, pixelRatio: number): void {
    const fov = THREE.MathUtils.degToRad(fovDeg);
    this.material.uniforms.uScale.value = (heightPx * pixelRatio) / (2 * Math.tan(fov / 2));
  }

  update(dt: number, camera: THREE.Camera): void {
    // Wrap time now and then to keep float precision; the jump is invisible in random snow.
    this.material.uniforms.uTime.value = (this.material.uniforms.uTime.value + dt) % 600;
    this.material.uniforms.uCamera.value.copy(camera.position);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
