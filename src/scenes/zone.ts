// Common shape for every place the player can be: a station zone or the train interior.
import type * as THREE from 'three';

export type Surface = 'snow' | 'grass' | 'sand' | 'wood';

export interface Zone {
  /** Where the player appears. */
  spawn: THREE.Vector3;
  /** Camera direction at spawn: the camera sits on this side of the player (radians, 0 = +z). */
  viewYaw: number;
  /** Whether snow falls here (camera-wrapped particles would look wrong indoors). */
  snowfall: boolean;
  /** Optional box the camera must stay inside (for interiors). */
  cameraBounds?: THREE.Box3;

  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): Surface;
  /** Keeps a position inside the walkable area and outside obstacles. */
  constrain(p: THREE.Vector3, radius: number): void;
  update?(dt: number): void;
  dispose(): void;
}
