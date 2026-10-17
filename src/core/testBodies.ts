import { readFileSync } from 'node:fs';
import type { BodyParams } from './bodyModel';
import type { Measurements } from './measure';

/** Golden reference bodies: parameters, measurements and geometry pinned by golden.test.ts. */
export const GOLDEN_PATH = 'src/core/__golden__/reference-bodies.json';

export interface GoldenBody {
  params: { z: number[]; local: Record<string, number> };
  measurements: Measurements;
  geometry: {
    boundsMin: number[];
    boundsMax: number[];
    centroid: number[];
    /** Every SAMPLE_STRIDE-th vertex, xyz. */
    samples: number[][];
    /** Joint (bone head) positions for a few key joints. */
    joints: Record<string, number[]>;
  };
}

export interface GoldenFile {
  data: { bodyBinSha256: string; bodyJsonSha256: string; vertexCount: number; jointCount: number; components: number; localControls: number };
  bodies: Record<string, GoldenBody>;
}

export const SAMPLE_STRIDE = 137;
export const KEY_JOINTS = ['root', 'upperarm01.L', 'lowerarm01.L', 'wrist.L', 'upperleg01.L', 'lowerleg01.L', 'foot.L', 'neck01', 'head'];

export function readGolden(): GoldenFile {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile;
}

export function goldenParams(name: string): BodyParams {
  const b = readGolden().bodies[name];
  return { z: b.params.z, local: b.params.local };
}
