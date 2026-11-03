// Touch + keyboard/mouse input.
// - Joystick zone (rectangle at the bottom-left): a floating joystick appears where the thumb lands.
// - One finger outside the zone (or any mouse drag): rotate the camera.
// - Two fingers outside the zone: pinch to zoom, even while walking. Mouse wheel zooms on desktop.
// - WASD / arrow keys move on desktop.
import './input.css';

const JOYSTICK_RADIUS = 48; // px the knob can travel from the center
const DEAD_ZONE = 0.12;

type Point = { x: number; y: number };

export class Input {
  /** Movement intent: x = right, y = forward, length 0..1. */
  readonly move = { x: 0, y: 0 };

  private _enabled = false;
  private lookDX = 0;
  private lookDY = 0;
  private zoom = 1;

  private stickId: number | null = null;
  private stick = { x: 0, y: 0 };
  private stickOrigin: Point = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast: Point = { x: 0, y: 0 };
  private pinch: { pos: Map<number, Point>; lastDist: number } | null = null;
  private keys = new Set<string>();

  private zone: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;

  constructor(private surface: HTMLElement) {
    this.zone = document.createElement('div');
    this.zone.className = 'joystick-zone';
    // First-time hint: a faint joystick and a short label, until the zone is first touched.
    this.zone.innerHTML =
      '<div class="joystick-zone__ghost"><div class="joystick-zone__ghost-knob"></div></div>' +
      '<p class="joystick-zone__label">조이스틱을 움직여 걸어요</p>';
    document.body.appendChild(this.zone);

    this.base = document.createElement('div');
    this.base.className = 'joystick';
    this.knob = document.createElement('div');
    this.knob.className = 'joystick__knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener(
      'wheel',
      (e) => {
        if (!this._enabled) return;
        e.preventDefault();
        this.zoom *= Math.exp(e.deltaY * 0.001);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.zone.classList.toggle('is-visible', value);
    if (!value) this.reset();
  }

  /** Camera rotation in pixels since the last call. */
  consumeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return out;
  }

  /** Zoom factor since the last call: < 1 moves the camera closer, > 1 farther. */
  consumeZoom(): number {
    const z = this.zoom;
    this.zoom = 1;
    return z;
  }

  /** Call once per frame before reading `move`. */
  update(): void {
    let x = this.stick.x;
    let y = this.stick.y;

    // Keyboard overrides the stick when any movement key is held.
    const kx = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    const ky = (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
    if (kx || ky) {
      const len = Math.hypot(kx, ky);
      x = kx / len;
      y = ky / len;
    }

    if (!this._enabled) x = y = 0;
    this.move.x = x;
    this.move.y = y;
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private inZone(p: Point): boolean {
    const r = this.zone.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this._enabled) return;
    const here = { x: e.clientX, y: e.clientY };
    const isTouch = e.pointerType !== 'mouse';

    if (isTouch && this.stickId === null && this.inZone(here)) {
      this.stickId = e.pointerId;
      this.stickOrigin = here;
      this.zone.classList.add('is-learned');
      this.base.style.transform = `translate(${here.x}px, ${here.y}px)`;
      this.base.classList.add('is-active');
      this.updateStick(here);
      this.surface.setPointerCapture(e.pointerId);
      return;
    }

    if (this.pinch) return;

    if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = here;
    } else if (isTouch) {
      // Second finger outside the stick: both fingers become a pinch.
      this.pinch = {
        pos: new Map([
          [this.lookId, { ...this.lookLast }],
          [e.pointerId, here],
        ]),
        lastDist: 0,
      };
      this.pinch.lastDist = this.pinchDistance();
      this.lookId = null;
    } else {
      return;
    }
    this.surface.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    const here = { x: e.clientX, y: e.clientY };
    if (e.pointerId === this.stickId) {
      this.updateStick(here);
    } else if (this.pinch?.pos.has(e.pointerId)) {
      this.pinch.pos.set(e.pointerId, here);
      const dist = this.pinchDistance();
      if (dist > 0 && this.pinch.lastDist > 0) this.zoom *= this.pinch.lastDist / dist;
      this.pinch.lastDist = dist;
    } else if (e.pointerId === this.lookId) {
      this.lookDX += here.x - this.lookLast.x;
      this.lookDY += here.y - this.lookLast.y;
      this.lookLast = here;
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stick = { x: 0, y: 0 };
      this.knob.style.transform = 'translate(0px, 0px)';
      this.base.classList.remove('is-active');
    } else if (this.pinch?.pos.has(e.pointerId)) {
      // The remaining finger is ignored until it lifts.
      this.pinch = null;
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  };

  private updateStick(p: Point): void {
    let dx = p.x - this.stickOrigin.x;
    let dy = p.y - this.stickOrigin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

    // Normalize with a dead zone so tiny thumb wobble doesn't move the character.
    const n = Math.min(dist / JOYSTICK_RADIUS, 1);
    const scaled = n < DEAD_ZONE ? 0 : (n - DEAD_ZONE) / (1 - DEAD_ZONE);

    const len = Math.hypot(dx, dy) || 1;
    this.stick = { x: (dx / len) * scaled, y: (-dy / len) * scaled };
  }

  private pinchDistance(): number {
    if (!this.pinch) return 0;
    const [a, b] = [...this.pinch.pos.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private reset(): void {
    this.pinch = null;
    this.keys.clear();
    this.stickId = this.lookId = null;
    this.stick = { x: 0, y: 0 };
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.remove('is-active');
  }
}
