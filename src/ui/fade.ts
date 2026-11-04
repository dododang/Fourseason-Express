// A soft full-screen fade for short moves (teleporting between signposts): the view brightens,
// the move happens unseen, and it clears again.
const STYLE = `
.screen-fade {
  position: fixed;
  inset: 0;
  background: #f6f4ef;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease;
  z-index: 40;
}
.screen-fade.is-on {
  opacity: 1;
  pointer-events: auto;
}
`;

const OUT_MS = 400;
const HOLD_MS = 150;

export class ScreenFade {
  private el: HTMLDivElement;
  private busy = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'screen-fade';
    document.body.appendChild(this.el);
  }

  get active(): boolean {
    return this.busy;
  }

  /** Fades out, runs `whileHidden`, then fades back in. Ignored while a fade is running. */
  through(whileHidden: () => void): void {
    if (this.busy) return;
    this.busy = true;
    this.el.classList.add('is-on');
    window.setTimeout(() => {
      whileHidden();
      window.setTimeout(() => {
        this.el.classList.remove('is-on');
        window.setTimeout(() => (this.busy = false), OUT_MS);
      }, HOLD_MS);
    }, OUT_MS);
  }
}
