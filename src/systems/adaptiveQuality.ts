// Automatic quality: lowers the render resolution step by step when the frame rate stays
// below target (slow phone, or a good phone that got hot), and carefully raises it again
// when there is plenty of headroom. Fast phones never notice it.
import type * as THREE from 'three';

const WINDOW = 2; // seconds per measurement
const WARMUP = 3; // ignore the first seconds after start or a change (shader compile, loading)
const LOW_FPS = 27; // below this for two windows in a row -> step down
const HIGH_FPS = 55; // above this for UPGRADE_AFTER seconds -> try one step up
const UPGRADE_AFTER = 30;

export class AdaptiveQuality {
  private levels: number[];
  private index = 0;
  /** Levels we had to leave because they were too slow; never returned to, so it won't flip-flop. */
  private tooSlow = new Set<number>();

  private elapsed = 0;
  private frames = 0;
  private warmup = WARMUP;
  private lowWindows = 0;
  private highTime = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private onChange: (pixelRatio: number) => void,
  ) {
    const max = Math.min(window.devicePixelRatio, 2);
    this.levels = [...new Set([max, 1.5, 1.25, 1].filter((r) => r <= max))].sort((a, b) => b - a);
    this.apply();

    // Background tabs throttle frames; don't count that as slowness.
    document.addEventListener('visibilitychange', () => this.reset());
  }

  get pixelRatio(): number {
    return this.levels[this.index];
  }

  /** Call every frame with the real (unclamped) frame time in seconds. */
  update(rawDt: number): void {
    if (document.hidden) return;
    if (this.warmup > 0) {
      this.warmup -= rawDt;
      return;
    }
    this.elapsed += rawDt;
    this.frames++;
    if (this.elapsed < WINDOW) return;

    const fps = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;

    if (fps < LOW_FPS) {
      this.highTime = 0;
      if (++this.lowWindows >= 2 && this.index < this.levels.length - 1) {
        this.tooSlow.add(this.index);
        this.index++;
        this.apply();
      }
      return;
    }
    this.lowWindows = 0;

    if (fps > HIGH_FPS) {
      this.highTime += WINDOW;
      const up = this.index - 1;
      if (this.highTime >= UPGRADE_AFTER && up >= 0 && !this.tooSlow.has(up)) {
        this.index = up;
        this.apply();
      }
    } else {
      this.highTime = 0;
    }
  }

  private apply(): void {
    this.renderer.setPixelRatio(this.pixelRatio); // also resizes the drawing buffer
    this.onChange(this.pixelRatio);
    this.reset();
  }

  private reset(): void {
    this.elapsed = 0;
    this.frames = 0;
    this.warmup = WARMUP;
    this.lowWindows = 0;
    this.highTime = 0;
  }
}
