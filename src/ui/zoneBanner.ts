// A short notice at the top center when entering a zone, e.g. "겨울".
const STYLE = `
.zone-banner {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 20px);
  left: 50%;
  transform: translate(-50%, -6px);
  padding: 8px 22px;
  border-radius: 999px;
  background: rgba(16, 16, 18, 0.82);
  color: #ffffff;
  font-family: var(--ui-font);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.12em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.6s ease, transform 0.6s ease;
  z-index: 30;
}
.zone-banner.is-shown {
  opacity: 1;
  transform: translate(-50%, 0);
}
.zone-banner.is-hiding {
  transition-duration: 0.8s;
}
`;

const HOLD_MS = 2500;

export class ZoneBanner {
  private el: HTMLDivElement;
  private timer = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'zone-banner';
    this.el.setAttribute('role', 'status');
    document.body.appendChild(this.el);
  }

  show(text: string): void {
    window.clearTimeout(this.timer);
    this.el.textContent = text;
    this.el.classList.remove('is-hiding');
    // Restart the fade-in even if a banner is already up.
    this.el.classList.remove('is-shown');
    void this.el.offsetWidth;
    this.el.classList.add('is-shown');
    this.timer = window.setTimeout(() => {
      this.el.classList.add('is-hiding');
      this.el.classList.remove('is-shown');
    }, 600 + HOLD_MS);
  }
}
