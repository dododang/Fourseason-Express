// Winter station sound: a looping ambience bed, an occasional passing gust,
// and footsteps that play exactly on each step of the walk cycle.
// Files are built by scripts/build_audio.py from the originals listed in ASSETS.md.
import { Howl, Howler } from 'howler';
import sprites from './winterSprites.json';

const BASE = `${import.meta.env.BASE_URL}audio/winter/`;

const AMBIENCE_VOLUME = 0.68;
const GUST_VOLUME = 0.22;
const STEP_VOLUME = 0.48;
const WOOD_RELATIVE = 0.7; // wood is sharper than snow, so it sits a little lower
const GUST_INTERVAL = [30, 90]; // seconds between gusts

// JSON arrays are typed as number[]; the build script always writes [offset, duration].
type SpriteMap = Record<string, [number, number]>;

export class WinterAudio {
  private ambience = new Howl({ src: [`${BASE}ambience.m4a`], loop: true, volume: 0, html5: false });
  private gusts = new Howl({ src: [`${BASE}gusts.m4a`], sprite: sprites.gusts as unknown as SpriteMap, volume: GUST_VOLUME });
  private steps = new Howl({ src: [`${BASE}steps.m4a`], sprite: sprites.steps as unknown as SpriteMap });
  private wood = new Howl({ src: [`${BASE}wood.m4a`], sprite: sprites.wood as unknown as SpriteMap });

  private gustNames = Object.keys(sprites.gusts);
  private stepNames = Object.keys(sprites.steps);
  private woodNames = Object.keys(sprites.wood);
  private lastStep = -1;
  private lastWood = -1;
  private lastGust = -1;
  private gustTimer = randomBetween(GUST_INTERVAL[0] * 0.5, GUST_INTERVAL[1] * 0.5);
  private started = false;
  private ambienceOn = false;

  constructor() {
    // Go quiet while the tab or app is in the background.
    document.addEventListener('visibilitychange', () => Howler.mute(document.hidden));
  }

  /** Call from a user gesture (the "열차에 타기" tap) so mobile browsers allow audio. */
  start(withAmbience = true): void {
    if (this.started) return;
    this.started = true;
    this.ambienceOn = withAmbience;
    if (!withAmbience) return;
    const id = this.ambience.play();
    this.ambience.fade(0, AMBIENCE_VOLUME, 4000, id);
  }

  /** One footstep. `speed` is 0..1 from the joystick, so a gentle push sounds softer. */
  step(speed: number, onWood: boolean): void {
    if (!this.started) return;
    const sound = onWood ? this.wood : this.steps;
    const names = onWood ? this.woodNames : this.stepNames;

    // Never the same sample twice in a row, with a little pitch and level variation.
    const last = onWood ? this.lastWood : this.lastStep;
    let i = Math.floor(Math.random() * names.length);
    if (i === last) i = (i + 1) % names.length;
    if (onWood) this.lastWood = i;
    else this.lastStep = i;

    const id = sound.play(names[i]);
    const level = STEP_VOLUME * (0.55 + 0.45 * speed) * randomBetween(0.85, 1.0);
    sound.volume(onWood ? level * WOOD_RELATIVE : level, id);
    sound.rate(randomBetween(0.92, 1.08), id);
  }

  update(dt: number): void {
    if (!this.ambienceOn) return;
    this.gustTimer -= dt;
    if (this.gustTimer > 0) return;
    this.gustTimer = randomBetween(GUST_INTERVAL[0], GUST_INTERVAL[1]);

    let i = Math.floor(Math.random() * this.gustNames.length);
    if (i === this.lastGust) i = (i + 1) % this.gustNames.length;
    this.lastGust = i;
    const id = this.gusts.play(this.gustNames[i]);
    this.gusts.stereo(randomBetween(-0.5, 0.5), id); // from a random side
  }

  dispose(): void {
    this.ambience.unload();
    this.gusts.unload();
    this.steps.unload();
    this.wood.unload();
  }
}

function randomBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
