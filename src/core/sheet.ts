import { type Pt, offsetOutline, signedArea } from './allowance';

/** Seams sewn together should be this close in length (cm); more than that is ease to be eased in, or a mistake. */
export const SEAM_TOLERANCE = 0.3;
/** How far a notch is cut out from the seam line (cm). */
export const NOTCH_LENGTH = 0.5;
/** A seam run shorter than this gets no notch (cm). */
export const MIN_NOTCHED = 3;
/** One notch for the first 25 cm of a seam run, and one more for each 25 cm after that (cm). */
export const NOTCH_SPACING = 25;
/** Side of the square drawn on the sheet to check the print is at full size (cm). */
export const SCALE_SQUARE = 5;

/** A side of a flat piece: a run of its outline that follows one seam (or none). */
export interface SideInput {
  /** Which seam this side follows; undefined where the outline is not a seam. */
  seam: number | undefined;
  /** Ids of the vertices along the run; the same vertex has the same id on every piece, so pieces sewn together share them. */
  vertices: number[];
  /** Flat positions (cm) of those vertices. */
  points: Pt[];
}
/** A flat piece. Its sides run in order round `loop`. */
export interface PieceInput {
  name: string;
  /** Outline in flat coordinates (cm, y up), either way round. */
  loop: Pt[];
  sides: SideInput[];
}

export const pathLength = (p: readonly Pt[]): number => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

/** The point `d` cm along a path (clamped to its ends) and the unit direction of travel there. */
export function pointAlong(p: readonly Pt[], d: number): { point: Pt; direction: Pt } {
  let left = Math.max(0, d);
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (left <= l || i === p.length - 1) {
      const t = l === 0 ? 0 : Math.min(1, left / l);
      return { point: [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])], direction: l === 0 ? [1, 0] : [(p[i][0] - p[i - 1][0]) / l, (p[i][1] - p[i - 1][1]) / l] };
    }
    left -= l;
  }
  return { point: p[0], direction: [1, 0] };
}

/** One seam run that two pieces share: where the pieces overlap on it, as a run of each piece's flat outline. */
interface Match {
  seam: number;
  a: { piece: number; side: number; from: number; to: number };
  b: { piece: number; side: number; from: number; to: number };
}

/** The part of side `x` (indices of its vertices) whose vertices are also on `y`, or undefined if they share fewer than two. */
function overlap(x: SideInput, y: SideInput): { from: number; to: number } | undefined {
  const on = new Set(y.vertices);
  const idx = x.vertices.flatMap((v, i) => (on.has(v) ? [i] : []));
  return idx.length >= 2 ? { from: idx[0], to: idx[idx.length - 1] } : undefined;
}

function matches(pieces: readonly PieceInput[]): Match[] {
  const out: Match[] = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      pieces[i].sides.forEach((sa, ia) => {
        pieces[j].sides.forEach((sb, ib) => {
          if (sa.seam === undefined || sa.seam !== sb.seam) return;
          const [oa, ob] = [overlap(sa, sb), overlap(sb, sa)];
          if (oa && ob) out.push({ seam: sa.seam, a: { piece: i, side: ia, ...oa }, b: { piece: j, side: ib, ...ob } });
        });
      });
    }
  }
  return out;
}
const runOf = (pieces: readonly PieceInput[], s: Match['a']): Pt[] => pieces[s.piece].sides[s.side].points.slice(s.from, s.to + 1);

/** One seam as two pieces see it. */
export interface SeamPair {
  seam: number;
  a: { piece: number; length: number };
  b: { piece: number; length: number };
  /** `a.length - b.length` (cm): positive when piece a is the longer and has to be eased onto b. */
  difference: number;
  /** The difference as a share of the shorter side. */
  percent: number;
  /** Within SEAM_TOLERANCE. */
  ok: boolean;
}

/** For every run of seam that two pieces share, the two flat lengths side by side. A seam on one piece only has no partner and is not listed. */
export function compareSeams(pieces: readonly PieceInput[], tolerance = SEAM_TOLERANCE): SeamPair[] {
  return matches(pieces).map((m) => {
    const [la, lb] = [pathLength(runOf(pieces, m.a)), pathLength(runOf(pieces, m.b))];
    const difference = la - lb;
    const shorter = Math.min(la, lb);
    return {
      seam: m.seam, a: { piece: m.a.piece, length: la }, b: { piece: m.b.piece, length: lb },
      difference, percent: shorter > 0 ? (100 * Math.abs(difference)) / shorter : 0, ok: Math.abs(difference) <= tolerance,
    };
  });
}

/** A cut into the seam allowance: from the seam line out to `to`. */
export interface Notch { from: Pt; to: Pt; seam: number }

/**
 * Notches for every shared seam run, at the same shares of the run's length on both pieces, so matching notches meet when
 * the pieces are sewn (a longer side is eased in between them). The shares are symmetric about the middle of the run, so it
 * does not matter that the two pieces travel the seam in opposite directions. The allowance is on the right of the direction of
 * travel for an anticlockwise outline, on the left for a clockwise one.
 */
function notchesFor(pieces: readonly PieceInput[], length = NOTCH_LENGTH): Notch[][] {
  const out: Notch[][] = pieces.map(() => []);
  const outward = pieces.map((p) => (signedArea(p.loop) >= 0 ? 1 : -1));
  for (const m of matches(pieces)) {
    const total = (pathLength(runOf(pieces, m.a)) + pathLength(runOf(pieces, m.b))) / 2;
    if (total < MIN_NOTCHED) continue;
    const count = 1 + Math.floor(total / NOTCH_SPACING);
    for (const s of [m.a, m.b]) {
      const run = runOf(pieces, s);
      const len = pathLength(run);
      for (let k = 1; k <= count; k++) {
        const { point, direction } = pointAlong(run, (len * k) / (count + 1));
        const n: Pt = [outward[s.piece] * direction[1], -outward[s.piece] * direction[0]];
        out[s.piece].push({ from: point, to: [point[0] + length * n[0], point[1] + length * n[1]], seam: m.seam });
      }
    }
  }
  return out;
}

export interface SheetPiece {
  name: string;
  /** The seam line (sewing line), a closed outline in sheet coordinates (cm, y down). */
  seamLine: Pt[];
  /** The cutting line, the seam line moved out by the allowance; undefined when there is no allowance. */
  cutLine: Pt[] | undefined;
  notches: Notch[];
  /** Seam numbers (1-based) with the flat length, written beside the middle of each side. */
  labels: { at: Pt; text: string }[];
  /** Where the piece's name is written. */
  nameAt: Pt;
}
export interface Sheet {
  width: number;
  height: number;
  pieces: SheetPiece[];
  /** A square to measure on the print: it must be SCALE_SQUARE cm across. */
  scaleSquare: { x: number; y: number; size: number };
  pairs: SeamPair[];
}
export interface SheetOptions {
  /** Seam allowance (cm); 0 for none. */
  allowance: number;
  /** Space between pieces (cm). */
  gap?: number;
  /** Pieces are put side by side until a row would be wider than this (cm). */
  maxRowWidth?: number;
}

/**
 * Lays the pieces out on one sheet at full size (1 unit = 1 cm, y down, so it prints the right way up): seam lines,
 * cutting lines, notches and labels, with the seam comparison for the same pieces.
 */
export function buildSheet(pieces: readonly PieceInput[], options: SheetOptions): Sheet {
  const { allowance, gap = 2, maxRowWidth = 120 } = options;
  const margin = Math.max(1, allowance) + gap / 2;
  const notches = notchesFor(pieces);
  const placed: SheetPiece[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  pieces.forEach((piece, index) => {
    const xs = piece.loop.map((p) => p[0]);
    const ys = piece.loop.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const [w, h] = [x1 - x0 + 2 * margin, y1 - y0 + 2 * margin];
    if (x > 0 && x + w > maxRowWidth) { y += rowHeight; x = 0; rowHeight = 0; }
    const place = (p: Pt): Pt => [p[0] - x0 + x + margin, y1 - p[1] + y + margin];
    const seamLine = piece.loop.map(place);
    placed.push({
      name: piece.name,
      seamLine,
      cutLine: allowance > 0 ? offsetOutline(seamLine, allowance) : undefined,
      notches: notches[index].map((n) => ({ ...n, from: place(n.from), to: place(n.to) })),
      labels: piece.sides.flatMap((s) => (s.seam === undefined ? [] : [{ at: place(pointAlong(s.points, pathLength(s.points) / 2).point), text: `${s.seam + 1}: ${pathLength(s.points).toFixed(1)}` }])),
      nameAt: place([(x0 + x1) / 2, (y0 + y1) / 2]),
    });
    x += w;
    width = Math.max(width, x);
    rowHeight = Math.max(rowHeight, h);
  });
  const height = y + rowHeight;
  const square = { x: gap, y: height + gap, size: SCALE_SQUARE };
  return { width: Math.max(width, square.x + square.size + 3), height: square.y + square.size + gap, pieces: placed, scaleSquare: square, pairs: compareSeams(pieces) };
}
