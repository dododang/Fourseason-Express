// The one context button at the bottom right (CLAUDE.md): its label changes with what can be
// done here, e.g. "보트 타기" or "내리기", and it is hidden when there is nothing to do.
const STYLE = `
.action-button {
  position: fixed;
  right: calc(env(safe-area-inset-right) + 18px);
  bottom: calc(env(safe-area-inset-bottom) + 28px);
  min-width: 108px;
  padding: 15px 24px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 4px 16px rgba(61, 70, 86, 0.16);
  color: #3d4656;
  font-family: var(--ui-font);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
  transition: opacity 0.35s ease, transform 0.35s ease;
  z-index: 25;
}
.action-button.is-shown {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.action-button:active {
  transform: scale(0.96);
}
`;

export class ActionButton {
  private el: HTMLButtonElement;
  private label: string | null = null;

  constructor(onPress: () => void) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.el = document.createElement('button');
    this.el.className = 'action-button';
    this.el.type = 'button';
    document.body.appendChild(this.el);

    const press = () => {
      if (this.label) onPress();
    };
    // Act on pointerdown, not click: iOS Safari drops the click for a second finger while the
    // thumb is still on the joystick, so the button only worked with the stick released.
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press();
    });
    // Keyboard activation (Enter/Space) still arrives as a click with detail 0.
    this.el.addEventListener('click', (e) => {
      if (e.detail === 0) press();
    });
    // Desktop testing: E does the same.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && !e.repeat) press();
    });
  }

  /** Shows the button with this label, or hides it with null. Cheap to call every frame. */
  set(label: string | null): void {
    if (label === this.label) return;
    this.label = label;
    if (label) this.el.textContent = label; // keep the old text while fading out
    this.el.classList.toggle('is-shown', label !== null);
  }
}
