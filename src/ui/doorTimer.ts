// A small, calm note about the train: when the doors close, or when the next train comes.
const STYLE = `
.door-timer {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 66px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 16px;
  border-radius: 999px;
  background: rgba(16, 16, 18, 0.55);
  color: #ffffff;
  font-family: var(--ui-font);
  font-size: 13px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.6s ease;
  z-index: 29;
}
.door-timer.is-shown {
  opacity: 1;
}
`;

export class DoorTimer {
  private el: HTMLDivElement;
  private text = '';

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'door-timer';
    this.el.setAttribute('role', 'status');
    document.body.appendChild(this.el);
  }

  /** Shows the text, or hides the note when null. */
  update(text: string | null): void {
    if (text === null) {
      this.el.classList.remove('is-shown');
      return;
    }
    if (text !== this.text) {
      this.text = text;
      this.el.textContent = text;
    }
    this.el.classList.add('is-shown');
  }
}
