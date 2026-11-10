// Station sound for every season: a looping ambience bed per season, an occasional passing
// sound (winter gusts, spring raindrops), and footsteps that play exactly on each step.
// Between stations the beds crossfade with the same season mix the sky and trees use.
// Files are built by scripts/build_audio.py from the originals listed in ASSETS.md.
import { Howl, Howler } from 'howler';
import sprites from './sprites.json';
import type { SeasonWeights } from '../scenes/seasons';

const BASE = `${import.meta.env.BASE_URL}audio/`;

const AMBIENCE_VOLUME = 0.68;
const SPRING_BED = 0.65; // birdsong sits a little lower than the winter wind (about -3.7 dB)
const SUMMER_BED = 0.8; // waves
const CREEK_VOLUME = 0.7; // right next to the stream
const CREEK_FLOOR = 0.35; // share still heard from far away
const CREEK_REACH = 5; // meters; beyond this the creek fades toward the floor
const ZIP_WIND_VOLUME = 1.0; // at full zipline speed
const ZIP_WIND_RESPONSE = 4; // how quickly the wind follows the speed (1/s)
const TRAIN_INTERIOR_VOLUME = 1.0; // riding at cruising speed
const TRAIN_RUMBLE_VOLUME = 1.0; // a moving train right beside you
const TRAIN_RUMBLE_REACH = 12; // m; farther away the rumble fades out
const STEP_VOLUME = 0.48;
const INSIDE_OPEN = 0.6; // outside sound level inside the car with the doors open
const INSIDE_CLOSED = 0.15; // ... and with the doors shut
const FADE_IN = 4; // seconds, when the sound first starts
const INDOOR_FADE = 1.5; // seconds, doors closing or opening

// JSON arrays are typed as number[]; the build script always writes [offset, duration].
type SpriteMap = Record<string, [number, number]>;
const spriteMap = (s: Record<string, number[]>) => s as unknown as SpriteMap;

export type { Surface } from '../scenes/zone';
import type { Surface } from '../scenes/zone';
type BedSeason = 'winter' | 'spring' | 'summer';
/** How much each season is heard, 0..1. Weights should add up to 1. Seasons without sounds yet stay quiet. */
export type SeasonMix = SeasonWeights;

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
    private pitch = 1,
  ) {
    this.names = Object.keys(sprite);
  }

  play(level: number): void {
    const i = pickOther(this.names.length, this.last, (k) => (this.last = k));
    const id = this.howl.play(this.names[i]);
    this.howl.volume(level * this.relative * randomBetween(0.85, 1.0), id);
    this.howl.rate(this.pitch * randomBetween(0.92, 1.08), id);
  }
}

interface Bed {
  ambience: Howl;
  level: number; // bed volume relative to AMBIENCE_VOLUME
  id: number;
  occasional: Occasional | null;
  volume: number; // last volume set, to skip redundant calls
}

export class StationAudio {
  private beds: Record<BedSeason, Bed>;
  private steps: Record<Surface, Steps>;
  private howls: Howl[] = [];
  private mix: SeasonMix = { winter: 1, spring: 0, summer: 0, autumn: 0 };
  private started = false;
  private startLevel = 0; // 0..1 fade-in after the first tap
  private indoorTarget = 1; // 1 outside, lower inside the car
  private indoorLevel = 1; // eased toward indoorTarget
  private creek: Howl;
  private creekId = 0;
  private creekDistance = Infinity;
  private creekPan = 0;
  private creekSet = { volume: -1, pan: 0 };
  private zipWind: Howl;
  private zipWindId = 0;
  private zipTarget = 0; // 0..1 zipline speed
  private zipLevel = 0; // smoothed
  private zipSet = -1;
  private trainInterior: Howl;
  private trainInteriorId = 0;
  private trainRumble: Howl;
  private trainRumbleId = 0;
  private train = { speed: 0, inside: false, distance: Infinity };
  private trainSet = { interior: -1, rumble: -1 };

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
      summer: {
        ambience: loop('summer/ambience.m4a'),
        level: SUMMER_BED,
        id: 0,
        occasional: new Occasional(howl('summer/gulls.m4a', spriteMap(sprites.gulls)), spriteMap(sprites.gulls), 0.4, [25, 60]),
        volume: -1,
      },
    };
    this.creek = loop('spring/creek.m4a');
    this.zipWind = loop('spring/zipwind.m4a');
    this.trainInterior = loop('train/interior.m4a');
    this.trainRumble = loop('train/rumble.m4a');
    this.steps = {
      snow: new Steps(howl('winter/steps.m4a', spriteMap(sprites.steps)), spriteMap(sprites.steps), 1),
      wood: new Steps(howl('winter/wood.m4a', spriteMap(sprites.wood)), spriteMap(sprites.wood), 0.7), // wood is sharper
      grass: new Steps(howl('spring/grass.m4a', spriteMap(sprites.grass)), spriteMap(sprites.grass), 0.8),
      sand: new Steps(howl('summer/sand.m4a', spriteMap(sprites.sand)), spriteMap(sprites.sand), 0.55), // soft underfoot
      // Placeholder until a dry-leaf recording is chosen: grass steps, a little brighter.
      leaves: new Steps(howl('spring/grass.m4a', spriteMap(sprites.grass)), spriteMap(sprites.grass), 0.8, 1.12),
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
    this.zipWindId = this.zipWind.play();
    this.trainInteriorId = this.trainInterior.play();
    this.trainRumbleId = this.trainRumble.play();
  }

  /** Inside the train car the outside is muffled: a little with the doors open (0..1), a lot once shut. */
  setIndoor(inside: boolean, doorsOpen: number): void {
    this.indoorTarget = inside ? INSIDE_CLOSED + (INSIDE_OPEN - INSIDE_CLOSED) * doorsOpen : 1;
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

  /**
   * The trains: speed 0..1, whether the listener is inside a car, and the distance to the nearest
   * car when outside. Inside you hear the carriage; outside, a soft rumble while a train moves.
   */
  setTrain(speed: number, inside: boolean, distance: number): void {
    this.train.speed = speed;
    this.train.inside = inside;
    this.train.distance = distance;
  }

  /** Zipline speed, 0 (still or not riding) .. 1 (full speed): wind past the ears follows it. */
  setZipSpeed(ratio: number): void {
    this.zipTarget = ratio;
  }

  /** One footstep. `speed` is 0..1 from the joystick, so a gentle push sounds softer. */
  step(speed: number, surface: Surface): void {
    if (!this.started) return;
    this.steps[surface].play(STEP_VOLUME * (0.55 + 0.45 * speed));
  }

  update(dt: number): void {
    if (!this.started) return;
    this.startLevel = Math.min(1, this.startLevel + dt / FADE_IN);
    const step = ((1 - INSIDE_CLOSED) * dt) / INDOOR_FADE;
    this.indoorLevel += clamp(this.indoorTarget - this.indoorLevel, -step, step);

    for (const season of Object.keys(this.beds) as BedSeason[]) {
      const bed = this.beds[season];
      // Equal-power crossfade so the middle of the line is not quieter than the stations.
      const weight = Math.sin((this.mix[season] * Math.PI) / 2);
      const volume = AMBIENCE_VOLUME * bed.level * weight * this.startLevel * this.indoorLevel;
      if (Math.abs(volume - bed.volume) > 0.002) {
        bed.ambience.volume(volume, bed.id);
        bed.volume = volume;
      }
      bed.occasional?.update(dt, weight * this.indoorLevel);
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

    // Trains: the carriage sound grows with speed; outside, a moving train rumbles softly nearby.
    const { speed, inside, distance } = this.train;
    const interior = inside ? TRAIN_INTERIOR_VOLUME * speed ** 0.8 * this.startLevel : 0;
    const trainNear = 1 / (1 + (distance / TRAIN_RUMBLE_REACH) ** 2);
    const rumble = inside ? 0 : TRAIN_RUMBLE_VOLUME * speed * trainNear * this.startLevel;
    if (Math.abs(interior - this.trainSet.interior) > 0.002) {
      this.trainInterior.volume(interior, this.trainInteriorId);
      this.trainInterior.rate(0.8 + 0.2 * speed, this.trainInteriorId);
      this.trainSet.interior = interior;
    }
    if (Math.abs(rumble - this.trainSet.rumble) > 0.002) {
      this.trainRumble.volume(rumble, this.trainRumbleId);
      this.trainRumble.rate(0.75 + 0.25 * speed, this.trainRumbleId);
      this.trainSet.rumble = rumble;
    }

    // Wind on the zipline: louder and a little higher the faster you go.
    this.zipLevel += (this.zipTarget - this.zipLevel) * (1 - Math.exp(-ZIP_WIND_RESPONSE * dt));
    const zipVolume = ZIP_WIND_VOLUME * this.zipLevel ** 1.3 * this.startLevel;
    if (Math.abs(zipVolume - this.zipSet) > 0.002) {
      this.zipWind.volume(zipVolume, this.zipWindId);
      this.zipWind.rate(0.85 + 0.35 * this.zipLevel, this.zipWindId);
      this.zipSet = zipVolume;
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
