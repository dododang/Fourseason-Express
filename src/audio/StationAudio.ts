// Station sound for every season: a looping ambience bed per season, an occasional passing
// sound (winter gusts, spring raindrops), and footsteps that play exactly on each step.
// Between stations the beds crossfade with the same season mix the sky and trees use.
// Files are built by scripts/build_audio.py from the originals listed in ASSETS.md.
import { Howl, Howler } from 'howler';
import sprites from './sprites.json';

const BASE = `${import.meta.env.BASE_URL}audio/`;

const AMBIENCE_VOLUME = 0.68;
const SPRING_BED = 0.65; // birdsong sits a little lower than the winter wind (about -3.7 dB)
const CREEK_VOLUME = 0.7; // right next to the stream
const CREEK_FLOOR = 0.35; // share still heard from far away
const CREEK_REACH = 5; // meters; beyond this the creek fades toward the floor
const STEP_VOLUME = 0.48;
const INDOOR_FACTOR = 0.35; // outside sound level inside the closed car
const FADE_IN = 4; // seconds, when the sound first starts
const INDOOR_FADE = 1.5; // seconds, doors closing or opening

// JSON arrays are typed as number[]; the build script always writes [offset, duration].
type SpriteMap = Record<string, [number, number]>;
const spriteMap = (s: Record<string, number[]>) => s as unknown as SpriteMap;

export type Surface = 'snow' | 'grass' | 'wood';
type BedSeason = 'winter' | 'spring';
/** How much each season is heard, 0..1. Weights should add up to 1. */
export type SeasonMix = Record<BedSeason, number>;

/** A sound played now and then from a random side, never the same clip twice in a row. */
class Occasional {
  private names: string[];
  private last = -1;
  private timer: number;

  constructor(
    private howl: Howl,
    sprite: SpriteMap,
    private volume: number,
    private interval: [number, number],
  ) {
    this.names = Object.keys(sprite);
    this.timer = randomBetween(interval[0] * 0.5, interval[1] * 0.5); // the first one comes sooner
  }

  /** `level` scales the volume (season weight, indoor muffling). Only plays while it is clearly audible. */
  update(dt: number, level: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = randomBetween(this.interval[0], this.interval[1]);
    if (level < 0.3) return;
    const i = pickOther(this.names.length, this.last, (k) => (this.last = k));
    const id = this.howl.play(this.names[i]);
    this.howl.volume(this.volume * level, id);
    this.howl.stereo(randomBetween(-0.5, 0.5), id);
  }
}

/** Single-step samples: never the same one twice in a row, with a little pitch and level variation. */
class Steps {
  private names: string[];
  private last = -1;

  constructor(
    private howl: Howl,
    sprite: SpriteMap,
    private relative: number,
  ) {
    this.names = Object.keys(sprite);
  }

  play(level: number): void {
    const i = pickOther(this.names.length, this.last, (k) => (this.last = k));
    const id = this.howl.play(this.names[i]);
    this.howl.volume(level * this.relative * randomBetween(0.85, 1.0), id);
    this.howl.rate(randomBetween(0.92, 1.08), id);
  }
}

interface Bed {
  ambience: Howl;
  level: number; // bed volume relative to AMBIENCE_VOLUME
  id: number;
  occasional: Occasional;
  volume: number; // last volume set, to skip redundant calls
}

export class StationAudio {
  private beds: Record<BedSeason, Bed>;
  private steps: Record<Surface, Steps>;
  private howls: Howl[] = [];
  private mix: SeasonMix = { winter: 1, spring: 0 };
  private started = false;
  private startLevel = 0; // 0..1 fade-in after the first tap
  private indoor = false;
  private indoorLevel = 1; // 1 outside, INDOOR_FACTOR inside the closed car
  private creek: Howl;
  private creekId = 0;
  private creekDistance = Infinity;
  private creekPan = 0;
  private creekSet = { volume: -1, pan: 0 };

  constructor() {
    const howl = (file: string, sprite?: SpriteMap) => {
      const h = new Howl({ src: [`${BASE}${file}`], sprite });
      this.howls.push(h);
      return h;
    };
    const loop = (file: string) => {
      const h = new Howl({ src: [`${BASE}${file}`], loop: true, volume: 0 });
      this.howls.push(h);
      return h;
    };

    this.beds = {
      winter: {
        ambience: loop('winter/ambience.m4a'),
        level: 1,
        id: 0,
        occasional: new Occasional(howl('winter/gusts.m4a', spriteMap(sprites.gusts)), spriteMap(sprites.gusts), 0.22, [30, 90]),
        volume: -1,
      },
      spring: {
        ambience: loop('spring/ambience.m4a'),
        level: SPRING_BED,
        id: 0,
        occasional: new Occasional(howl('spring/rain.m4a', spriteMap(sprites.rain)), spriteMap(sprites.rain), 0.5, [40, 100]),
        volume: -1,
      },
    };
    this.creek = loop('spring/creek.m4a');
    this.steps = {
      snow: new Steps(howl('winter/steps.m4a', spriteMap(sprites.steps)), spriteMap(sprites.steps), 1),
      wood: new Steps(howl('winter/wood.m4a', spriteMap(sprites.wood)), spriteMap(sprites.wood), 0.7), // wood is sharper
      grass: new Steps(howl('spring/grass.m4a', spriteMap(sprites.grass)), spriteMap(sprites.grass), 0.8),
    };

    // Go quiet while the tab or app is in the background.
    document.addEventListener('visibilitychange', () => Howler.mute(document.hidden));
  }

  /** Call from a user gesture (the "열차에 타기" tap) so mobile browsers allow audio. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const bed of Object.values(this.beds)) bed.id = bed.ambience.play();
    this.creekId = this.creek.play();
  }

  /** Inside the closed train car the outside is muffled. */
  setIndoor(indoor: boolean): void {
    this.indoor = indoor;
  }

  /** Which seasons are heard, following where the view is on the line. */
  setSeasonMix(mix: SeasonMix): void {
    this.mix = mix;
  }

  /**
   * Where the nearest stream is: distance from its edge (m) and its side, -1 left .. 1 right
   * of the camera. Infinity when there is none nearby.
   */
  setCreek(distance: number, pan: number): void {
    this.creekDistance = distance;
    this.creekPan = pan;
  }

  /** One footstep. `speed` is 0..1 from the joystick, so a gentle push sounds softer. */
  step(speed: number, surface: Surface): void {
    if (!this.started) return;
    this.steps[surface].play(STEP_VOLUME * (0.55 + 0.45 * speed));
  }

  update(dt: number): void {
    if (!this.started) return;
    this.startLevel = Math.min(1, this.startLevel + dt / FADE_IN);
    const target = this.indoor ? INDOOR_FACTOR : 1;
    const step = ((1 - INDOOR_FACTOR) * dt) / INDOOR_FADE;
    this.indoorLevel += clamp(target - this.indoorLevel, -step, step);

    for (const season of Object.keys(this.beds) as BedSeason[]) {
      const bed = this.beds[season];
      // Equal-power crossfade so the middle of the line is not quieter than the stations.
      const weight = Math.sin((this.mix[season] * Math.PI) / 2);
      const volume = AMBIENCE_VOLUME * bed.level * weight * this.startLevel * this.indoorLevel;
      if (Math.abs(volume - bed.volume) > 0.002) {
        bed.ambience.volume(volume, bed.id);
        bed.volume = volume;
      }
      bed.occasional.update(dt, weight * this.indoorLevel);
    }

    // The creek belongs to spring: louder close to the water, a faint murmur from afar.
    const d = Math.max(0, this.creekDistance) / CREEK_REACH;
    const near = Number.isFinite(d) ? CREEK_FLOOR + (1 - CREEK_FLOOR) / (1 + d * d) : 0;
    const spring = Math.sin((this.mix.spring * Math.PI) / 2);
    const volume = CREEK_VOLUME * near * spring * this.startLevel * this.indoorLevel;
    if (Math.abs(volume - this.creekSet.volume) > 0.002) {
      this.creek.volume(volume, this.creekId);
      this.creekSet.volume = volume;
    }
    if (Math.abs(this.creekPan - this.creekSet.pan) > 0.02) {
      this.creek.stereo(this.creekPan, this.creekId);
      this.creekSet.pan = this.creekPan;
    }
  }

  dispose(): void {
    this.howls.forEach((h) => h.unload());
  }
}

function pickOther(count: number, last: number, remember: (i: number) => void): number {
  let i = Math.floor(Math.random() * count);
  if (i === last && count > 1) i = (i + 1) % count;
  remember(i);
  return i;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function randomBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
