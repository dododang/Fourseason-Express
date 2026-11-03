// Entrance screen: pick a character look, then board the train.
// The "열차에 타기" tap also serves as the user gesture that unlocks audio later.
import './entrance.css';
import {
  BODY_TYPES,
  COAT_COLORS,
  FACE_SHAPES,
  HAIR_COLORS,
  randomLook,
  type CharacterLook,
} from '../character/options';

type LookKey = keyof CharacterLook;

interface EntranceOptions {
  initial: CharacterLook;
  onChange: (look: CharacterLook) => void;
  onBoard: () => void;
}

export class Entrance {
  /** The panel element, used to keep the character visible beside or above it. */
  readonly panel: HTMLElement;
  private root: HTMLElement;
  private look: CharacterLook;
  private buttons = new Map<LookKey, HTMLButtonElement[]>();

  constructor(private opts: EntranceOptions) {
    this.look = { ...opts.initial };

    this.root = document.createElement('div');
    this.root.className = 'entrance';

    const title = document.createElement('div');
    title.className = 'entrance__title';
    title.innerHTML = '<h1>포시즌 열차</h1><p>잠시 쉬어 가는 곳</p>';

    this.panel = document.createElement('div');
    this.panel.className = 'entrance__panel';
    this.panel.append(
      this.textRow('얼굴형', 'face', FACE_SHAPES.map((f) => f.label)),
      this.textRow('체형', 'body', BODY_TYPES.map((b) => b.label)),
      this.swatchRow('머리색', 'hair', HAIR_COLORS),
      this.swatchRow('옷 색', 'coat', COAT_COLORS),
      this.actions(),
    );

    this.root.append(title, this.panel);
    document.body.appendChild(this.root);
    this.refresh();
  }

  private row(label: string, options: HTMLElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'entrance__row';
    const labelEl = document.createElement('span');
    labelEl.className = 'entrance__label';
    labelEl.textContent = label;
    const wrap = document.createElement('div');
    wrap.className = 'entrance__options';
    wrap.append(...options);
    row.append(labelEl, wrap);
    return row;
  }

  private textRow(label: string, key: LookKey, labels: string[]): HTMLElement {
    const buttons = labels.map((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = text;
      b.addEventListener('click', () => this.set(key, i));
      return b;
    });
    this.buttons.set(key, buttons);
    return this.row(label, buttons);
  }

  private swatchRow(label: string, key: LookKey, colors: { label: string; color: string }[]): HTMLElement {
    const buttons = colors.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c.color;
      b.setAttribute('aria-label', c.label);
      b.title = c.label;
      b.addEventListener('click', () => this.set(key, i));
      return b;
    });
    this.buttons.set(key, buttons);
    return this.row(label, buttons);
  }

  private actions(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'entrance__actions';

    const random = document.createElement('button');
    random.type = 'button';
    random.className = 'button button--secondary';
    random.textContent = '랜덤';
    random.addEventListener('click', () => {
      this.look = randomLook(this.look);
      this.refresh();
      this.opts.onChange({ ...this.look });
    });

    const board = document.createElement('button');
    board.type = 'button';
    board.className = 'button button--primary';
    board.textContent = '열차에 타기';
    board.addEventListener('click', () => this.leave(), { once: true });

    wrap.append(random, board);
    return wrap;
  }

  private set(key: LookKey, index: number): void {
    if (this.look[key] === index) return;
    this.look[key] = index;
    this.refresh();
    this.opts.onChange({ ...this.look });
  }

  private refresh(): void {
    for (const [key, buttons] of this.buttons) {
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(this.look[key] === i)));
    }
  }

  private leave(): void {
    this.root.classList.add('is-leaving');
    this.opts.onBoard();
    this.root.addEventListener('transitionend', () => this.root.remove(), { once: true });
  }
}
