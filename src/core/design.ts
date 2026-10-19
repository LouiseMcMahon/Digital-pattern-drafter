import type { Seam, SurfacePoint } from './seam';

/** A panel that hangs free from a seam (a skirt from a waist seam) instead of lying on the body: see hanging.ts. */
export interface Hang { seam: number; length: number; flare: number; /** A fitted (pencil) skirt: follows the body to its widest, then falls to the hem. */ fitted?: boolean;
  /**
   * Only for a hanging panel on a closed seam: which half of it this is. The seam is cut at the side seam (the panel's seed) and
   * at the opposite side, giving a front half (0, from the seed round to the opposite side) and a back half (1, the rest).
   */
  half?: 0 | 1;
  /** The hem is at the floor: `length` is then worked out from the seam's height and ignored. */
  toFloor?: boolean }

/**
 * A panel is remembered by a point inside it (so it follows the seams and the body) and its own ease, in percent.
 * A hanging panel has `hang` as well: it is built under that seam, and its seed is only the seam's first point.
 */
export interface PanelSeed { seed: SurfacePoint; horizontal: number; vertical: number; hang?: Hang }

/** Everything the user draws on the body: the seams (the last is the one being drawn) and the panels. */
export interface Design { seams: Seam[]; panels: PanelSeed[] }

const FORMAT = 'digital-pattern-drafter-design';
export const DESIGN_VERSION = 1;
/** Barycentric weights must sum to 1 and not be negative, to this much (rounding in a saved file). */
const BARY_TOLERANCE = 1e-6;

const copyPoint = (p: SurfacePoint): SurfacePoint => ({ tri: p.tri, bary: [p.bary[0], p.bary[1], p.bary[2]] });

export function cloneDesign(d: Design): Design {
  return {
    seams: d.seams.map((s) => ({ points: s.points.map(copyPoint), closed: s.closed })),
    panels: d.panels.map((p) => ({ seed: copyPoint(p.seed), horizontal: p.horizontal, vertical: p.vertical, ...(p.hang ? { hang: { ...p.hang } } : {}) })),
  };
}

/** The design as a text file. `triangleCount` is the body mesh's, so a file is never applied to a different mesh. */
export function serializeDesign(d: Design, triangleCount: number): string {
  return JSON.stringify({ format: FORMAT, version: DESIGN_VERSION, triangleCount, ...cloneDesign(d) }, null, 1);
}

function fail(message: string): never {
  throw new Error(`Not a usable design file: ${message}`);
}

function readPoint(value: unknown, triangleCount: number, where: string): SurfacePoint {
  const p = value as { tri?: unknown; bary?: unknown } | null;
  if (typeof p !== 'object' || p === null) fail(`${where} is not a point`);
  const { tri, bary } = p;
  if (typeof tri !== 'number' || !Number.isInteger(tri) || tri < 0 || tri >= triangleCount) fail(`${where} is on a triangle the body does not have`);
  if (!Array.isArray(bary) || bary.length !== 3 || bary.some((w) => typeof w !== 'number' || !Number.isFinite(w) || w < -BARY_TOLERANCE)) fail(`${where} has invalid weights`);
  if (Math.abs(bary[0] + bary[1] + bary[2] - 1) > BARY_TOLERANCE) fail(`${where} has weights that do not add up to 1`);
  return { tri, bary: [bary[0], bary[1], bary[2]] };
}

/** Reads a saved design, checking everything: a bad or foreign file throws an Error saying what is wrong and changes nothing. */
export function parseDesign(text: string, triangleCount: number): Design {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('it is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || raw.format !== FORMAT) fail('it is not a design saved by this app');
  if (raw.version !== DESIGN_VERSION) fail(`it is version ${String(raw.version)}, this app reads version ${DESIGN_VERSION}`);
  if (raw.triangleCount !== triangleCount) fail('it was saved for a different body mesh');
  if (!Array.isArray(raw.seams) || !Array.isArray(raw.panels)) fail('it has no seams or panels list');
  const seams = raw.seams.map((s: { points?: unknown; closed?: unknown }, i: number): Seam => {
    if (typeof s !== 'object' || s === null || !Array.isArray(s.points)) fail(`seam ${i + 1} has no points`);
    if (typeof s.closed !== 'boolean') fail(`seam ${i + 1} does not say whether it is closed`);
    if (s.closed && s.points.length < 3) fail(`seam ${i + 1} is closed but has fewer than 3 points`);
    return { points: s.points.map((p: unknown, k: number) => readPoint(p, triangleCount, `seam ${i + 1} point ${k + 1}`)), closed: s.closed };
  });
  const panels = raw.panels.map((p: { seed?: unknown; horizontal?: unknown; vertical?: unknown; hang?: unknown }, i: number): PanelSeed => {
    if (typeof p !== 'object' || p === null) fail(`panel ${i + 1} is not an object`);
    if (typeof p.horizontal !== 'number' || !Number.isFinite(p.horizontal) || typeof p.vertical !== 'number' || !Number.isFinite(p.vertical)) fail(`panel ${i + 1} has no valid ease`);
    const seed = readPoint(p.seed, triangleCount, `panel ${i + 1} seed`);
    if (p.hang === undefined) return { seed, horizontal: p.horizontal, vertical: p.vertical };
    const h = p.hang as { seam?: unknown; length?: unknown; flare?: unknown; fitted?: unknown; half?: unknown; toFloor?: unknown } | null;
    if (typeof h !== 'object' || h === null || typeof h.seam !== 'number' || !Number.isInteger(h.seam) || h.seam < 0 || h.seam >= (raw.seams as unknown[]).length) fail(`panel ${i + 1} hangs from a seam that does not exist`);
    if (typeof h.length !== 'number' || !(h.length > 0) || !Number.isFinite(h.length) || typeof h.flare !== 'number' || !Number.isFinite(h.flare)) fail(`panel ${i + 1} has no valid length or flare`);
    if (h.fitted !== undefined && typeof h.fitted !== 'boolean') fail(`panel ${i + 1} does not say whether it is fitted`);
    if (h.toFloor !== undefined && typeof h.toFloor !== 'boolean') fail(`panel ${i + 1} does not say whether it reaches the floor`);
    if (h.half !== undefined && h.half !== 0 && h.half !== 1) fail(`panel ${i + 1} is not half 0 or half 1`);
    return { seed, horizontal: p.horizontal, vertical: p.vertical, hang: { seam: h.seam, length: h.length, flare: h.flare, ...(h.fitted ? { fitted: true } : {}), ...(h.half !== undefined ? { half: h.half } : {}), ...(h.toFloor ? { toFloor: true } : {}) } };
  });
  return { seams, panels };
}
