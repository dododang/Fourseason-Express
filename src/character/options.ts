// Character customization options shown on the entrance screen.

export type FaceKind = 'round' | 'triangle' | 'square';

export interface FaceShape {
  label: string;
  kind: FaceKind;
}

export interface HairColor {
  label: string;
  color: string;
}

export interface BodyType {
  label: string;
  scale: [number, number, number];
}

export const FACE_SHAPES: FaceShape[] = [
  { label: '동그란형', kind: 'round' },
  { label: '역삼각형', kind: 'triangle' },
  { label: '네모형', kind: 'square' },
];

export const HAIR_COLORS: HairColor[] = [
  { label: '짙은 밤색', color: '#3d3230' },
  { label: '갈색', color: '#8a5f43' },
  { label: '연한 잿빛', color: '#b9b2ab' },
];

export const BODY_TYPES: BodyType[] = [
  { label: '작은', scale: [0.26, 0.28, 0.24] },
  { label: '보통', scale: [0.3, 0.34, 0.27] },
  { label: '통통한', scale: [0.38, 0.33, 0.34] },
];

export interface CoatColor {
  label: string;
  color: string;
}

export const COAT_COLORS: CoatColor[] = [
  { label: '남색', color: '#56677f' },
  { label: '겨자색', color: '#d2a854' },
  { label: '분홍색', color: '#e9a6b5' },
  { label: '말린 장미색', color: '#b97f7c' },
  { label: '라벤더', color: '#9b90b8' },
];

export interface CharacterLook {
  face: number;
  hair: number;
  body: number;
  coat: number;
}

const pick = (n: number) => Math.floor(Math.random() * n);

/** A random look. If `current` is given, the result is guaranteed to differ from it. */
export function randomLook(current?: CharacterLook): CharacterLook {
  for (;;) {
    const look: CharacterLook = {
      face: pick(FACE_SHAPES.length),
      hair: pick(HAIR_COLORS.length),
      body: pick(BODY_TYPES.length),
      coat: pick(COAT_COLORS.length),
    };
    if (
      !current ||
      look.face !== current.face ||
      look.hair !== current.hair ||
      look.body !== current.body ||
      look.coat !== current.coat
    ) {
      return look;
    }
  }
}
