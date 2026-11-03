// Season palettes. The backdrop and the track scenery blend between them along the line.
import * as THREE from 'three';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SeasonPalette {
  skyTop: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  groundShade: THREE.Color;
  mountain: THREE.Color;
}

const palette = (p: Record<keyof SeasonPalette, string>): SeasonPalette => ({
  skyTop: new THREE.Color(p.skyTop),
  horizon: new THREE.Color(p.horizon),
  ground: new THREE.Color(p.ground),
  groundShade: new THREE.Color(p.groundShade),
  mountain: new THREE.Color(p.mountain),
});

export const PALETTES: Record<'winter' | 'spring', SeasonPalette> = {
  winter: palette({
    skyTop: '#9fbad6',
    horizon: '#e3e9f0',
    ground: '#f8fafd',
    groundShade: '#dfe6ef',
    mountain: '#b2c0d0',
  }),
  spring: palette({
    skyTop: '#a3cbe6',
    horizon: '#eef2e6',
    ground: '#b7d49a',
    groundShade: '#a3c486',
    mountain: '#aac3b8',
  }),
};

export function lerpPalette(a: SeasonPalette, b: SeasonPalette, t: number, out: SeasonPalette): SeasonPalette {
  for (const key of Object.keys(out) as (keyof SeasonPalette)[]) out[key].copy(a[key]).lerp(b[key], t);
  return out;
}

export function clonePalette(p: SeasonPalette): SeasonPalette {
  return {
    skyTop: p.skyTop.clone(),
    horizon: p.horizon.clone(),
    ground: p.ground.clone(),
    groundShade: p.groundShade.clone(),
    mountain: p.mountain.clone(),
  };
}
