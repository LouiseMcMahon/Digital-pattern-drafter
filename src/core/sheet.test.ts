import { describe, expect, it } from 'vitest';
import type { Pt } from './allowance';
import { MIN_NOTCHED, NOTCH_LENGTH, type PieceInput, SCALE_SQUARE, SEAM_TOLERANCE, buildSheet, compareSeams, pathLength, pointAlong } from './sheet';

/**
 * Two rectangles sewn along one long side: left is [0,w]x[0,h] and right is [w,2w]x[0,h] (anticlockwise), sharing the line x = w.
 * Vertex ids along the shared line are 10..10+n; each piece lists the line in its own direction of travel (opposite ways).
 */
function pair(h = 40, rightHeight = h, steps = 4): PieceInput[] {
  const ids = Array.from({ length: steps + 1 }, (_, i) => 10 + i);
  const up = (top: number): Pt[] => ids.map((_, i) => [10, (top * i) / steps]);
  const leftSeam = { seam: 0, vertices: [...ids].reverse(), points: up(h).reverse().map(([x, y]) => [x, y] as Pt) }; // travels down the right edge of the left piece? see loop below
  const left: PieceInput = {
    name: 'Left',
    loop: [[0, 0], [10, 0], [10, h], [0, h]],
    sides: [{ seam: 0, vertices: ids, points: up(h) }, { seam: undefined, vertices: [1, 2], points: [[10, h], [0, h]] }, { seam: undefined, vertices: [2, 3], points: [[0, h], [0, 0]] }, { seam: undefined, vertices: [3, 1], points: [[0, 0], [10, 0]] }],
  };
  const right: PieceInput = {
    name: 'Right',
    loop: [[10, 0], [20, 0], [20, rightHeight], [10, rightHeight]],
    sides: [{ seam: 0, vertices: leftSeam.vertices, points: up(rightHeight).reverse() }],
  };
  return [left, right];
}

describe('pathLength and pointAlong', () => {
  const p: Pt[] = [[0, 0], [3, 0], [3, 4]];
  it('adds up the segments', () => {
    expect(pathLength(p)).toBe(7);
    expect(pathLength([])).toBe(0);
    expect(pathLength([[1, 1]])).toBe(0);
  });
  it('finds the point and direction a distance along', () => {
    expect(pointAlong(p, 1.5)).toEqual({ point: [1.5, 0], direction: [1, 0] });
    expect(pointAlong(p, 5)).toEqual({ point: [3, 2], direction: [0, 1] });
  });
  it('clamps to the ends', () => {
    expect(pointAlong(p, -2).point).toEqual([0, 0]);
    expect(pointAlong(p, 99)).toEqual({ point: [3, 4], direction: [0, 1] });
  });
  it('copes with repeated points', () => {
    expect(pointAlong([[0, 0], [0, 0], [2, 0]], 1).point).toEqual([1, 0]);
    expect(pointAlong([[5, 5]], 1).point).toEqual([5, 5]);
  });
});

describe('compareSeams', () => {
  it('reports equal lengths for a seam of the same length on both pieces', () => {
    const [r] = compareSeams(pair(40));
    expect(r.seam).toBe(0);
    expect(r.a).toEqual({ piece: 0, length: 40 });
    expect(r.b).toEqual({ piece: 1, length: 40 });
    expect(r.difference).toBe(0);
    expect(r.percent).toBe(0);
    expect(r.ok).toBe(true);
  });
  it('reports how much longer one side is, as cm and as a share of the shorter, and flags it past the tolerance', () => {
    const [r] = compareSeams(pair(40, 38));
    expect(r.difference).toBeCloseTo(2, 9);
    expect(r.percent).toBeCloseTo((100 * 2) / 38, 9);
    expect(r.ok).toBe(false);
    expect(compareSeams(pair(40, 40 - SEAM_TOLERANCE / 2))[0].ok).toBe(true);
    expect(compareSeams(pair(40, 40 + 2))[0].difference).toBeCloseTo(-2, 9);
  });
  it('honours a given tolerance', () => {
    expect(compareSeams(pair(40, 39), 2)[0].ok).toBe(true);
    expect(compareSeams(pair(40, 39), 0.5)[0].ok).toBe(false);
  });
  it('compares only the part of a seam that two pieces share (a seam met by two pieces on the other side)', () => {
    const [whole, , ] = pair(40);
    const upper: PieceInput = { name: 'Upper', loop: [[10, 20], [20, 20], [20, 40], [10, 40]], sides: [{ seam: 0, vertices: [12, 13, 14], points: [[10, 40], [10, 30], [10, 20]] }] };
    const lower: PieceInput = { name: 'Lower', loop: [[10, 0], [20, 0], [20, 20], [10, 20]], sides: [{ seam: 0, vertices: [10, 11, 12], points: [[10, 20], [10, 10], [10, 0]] }] };
    const r = compareSeams([whole, upper, lower]);
    expect(r).toHaveLength(2);
    expect(r.map((p) => [p.a.piece, p.b.piece, p.a.length, p.b.length])).toEqual([[0, 1, 20, 20], [0, 2, 20, 20]]);
  });
  it('ignores a seam on one piece only, sides that are not seams, and different seams', () => {
    const [a, b] = pair(40);
    expect(compareSeams([a])).toEqual([]);
    expect(compareSeams([a, { ...b, sides: [{ ...b.sides[0], seam: 1 }] }])).toEqual([]);
    expect(compareSeams([a, { ...b, sides: [{ ...b.sides[0], seam: undefined }] }])).toEqual([]);
    expect(compareSeams([a, { ...b, sides: [{ ...b.sides[0], vertices: [90, 91, 92, 93, 94] }] }])).toEqual([]); // no vertex in common
    expect(compareSeams([a, { ...b, sides: [{ ...b.sides[0], vertices: [90, 91, 92, 93, 12] }] }])).toEqual([]); // one vertex is not a run
  });
  it('gives 0% for a seam of no length', () => {
    const [a, b] = pair(0);
    expect(compareSeams([a, b])[0].percent).toBe(0);
  });
});

describe('buildSheet', () => {
  it('lays out pieces at full size, y down, and measures the sheet', () => {
    const s = buildSheet(pair(40), { allowance: 0, gap: 2 });
    expect(s.pieces.map((p) => p.name)).toEqual(['Left', 'Right']);
    const ys = s.pieces[0].seamLine.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(40, 9);
    const xs = s.pieces[0].seamLine.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 9);
    // The piece's top (largest y in flat coordinates) is the top of the sheet.
    expect(s.pieces[0].seamLine[3][1]).toBeLessThan(s.pieces[0].seamLine[0][1]);
    expect(s.pieces[0].cutLine).toBeUndefined();
    expect(s.width).toBeGreaterThanOrEqual(2 * (10 + 1 + 2 / 2 * 2) - 1);
    expect(s.pairs).toHaveLength(1);
  });
  it('draws the cutting line the allowance outside the seam line', () => {
    const s = buildSheet(pair(40), { allowance: 1.5 });
    const [a] = s.pieces;
    const cut = a.cutLine!;
    const w = (p: Pt[]) => Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]));
    expect(w(cut) - w(a.seamLine)).toBeCloseTo(3, 9);
  });
  it('keeps pieces from overlapping and wraps to a new row past the row width', () => {
    const wide = buildSheet(pair(40), { allowance: 1, maxRowWidth: 1000 });
    const wrapped = buildSheet(pair(40), { allowance: 1, maxRowWidth: 20 });
    const minX = (p: { seamLine: Pt[] }) => Math.min(...p.seamLine.map((q) => q[0]));
    const maxX = (p: { seamLine: Pt[] }) => Math.max(...p.seamLine.map((q) => q[0]));
    expect(minX(wide.pieces[1])).toBeGreaterThan(maxX(wide.pieces[0]) + 2 * 1); // room for both allowances
    expect(minX(wrapped.pieces[1])).toBeCloseTo(minX(wrapped.pieces[0]), 9);
    expect(Math.min(...wrapped.pieces[1].seamLine.map((q) => q[1]))).toBeGreaterThan(Math.max(...wrapped.pieces[0].seamLine.map((q) => q[1])));
    expect(wrapped.height).toBeGreaterThan(wide.height);
    expect(wrapped.width).toBeLessThan(wide.width);
  });
  it('puts the scale square below the pieces', () => {
    const s = buildSheet(pair(40), { allowance: 1 });
    expect(s.scaleSquare.size).toBe(SCALE_SQUARE);
    const bottom = Math.max(...s.pieces.flatMap((p) => (p.cutLine ?? p.seamLine).map((q) => q[1])));
    expect(s.scaleSquare.y).toBeGreaterThan(bottom);
    expect(s.height).toBeGreaterThanOrEqual(s.scaleSquare.y + SCALE_SQUARE);
  });
  it('labels each seam side with its number and flat length, and names the piece in its middle', () => {
    const s = buildSheet(pair(40), { allowance: 0 });
    expect(s.pieces[0].labels).toHaveLength(1);
    expect(s.pieces[0].labels[0].text).toBe('1: 40.0');
    expect(s.pieces[1].labels[0].text).toBe('1: 40.0');
    expect(s.pieces[0].nameAt[1]).toBeCloseTo(s.pieces[0].seamLine[0][1] - 20, 9);
  });
});

describe('layout arithmetic', () => {
  const piece = (w: number): PieceInput => ({ name: 'P', loop: [[0, 0], [w, 0], [w, 4], [0, 4]], sides: [] });
  it('puts a piece one margin (allowance plus half the gap) in from the corner, and measures sheet and scale square', () => {
    const s = buildSheet([piece(6)], { allowance: 1, gap: 2 });
    expect(s.pieces[0].seamLine).toEqual([[2, 6], [8, 6], [8, 2], [2, 2]]);
    expect([s.width, s.height]).toEqual([10, 17]);
    expect(s.scaleSquare).toEqual({ x: 2, y: 10, size: 5 });
    expect(s.pieces[0].nameAt).toEqual([5, 4]);
  });
  it('uses at least 1 cm of margin and a 2 cm gap by default', () => {
    expect(buildSheet([piece(6)], { allowance: 0 }).pieces[0].seamLine[3]).toEqual([2, 2]);
  });
  it('widens the sheet for the scale square when the pieces are narrower', () => {
    expect(buildSheet([piece(1)], { allowance: 0, gap: 2 }).width).toBe(10);
  });
  it('keeps a piece on the row when it just fits, and wraps it when it does not', () => {
    const fits = buildSheet([piece(6), piece(6)], { allowance: 1, gap: 2, maxRowWidth: 20 }); // 10 + 10
    const wraps = buildSheet([piece(6), piece(6)], { allowance: 1, gap: 2, maxRowWidth: 19.99 });
    expect(fits.pieces[1].seamLine[0][0]).toBe(12);
    expect(wraps.pieces[1].seamLine[0]).toEqual([2, 14]);
  });
  it('places the second row below the tallest piece of the first', () => {
    const tall: PieceInput = { name: 'T', loop: [[0, 0], [2, 0], [2, 9], [0, 9]], sides: [] };
    const s = buildSheet([piece(6), tall, piece(6)], { allowance: 1, gap: 2, maxRowWidth: 16 });
    expect(s.pieces[2].seamLine[3]).toEqual([2, 2 + 13]); // the first row is 9 + 4 high
  });
  it('writes the label at the middle of the side', () => {
    const p: PieceInput = { name: 'P', loop: [[0, 0], [6, 0], [6, 4], [0, 4]], sides: [{ seam: 0, vertices: [1, 2, 3], points: [[0, 0], [6, 0], [6, 4]] }] };
    expect(buildSheet([p], { allowance: 1, gap: 2 }).pieces[0].labels).toEqual([{ at: [7, 6], text: '1: 10.0' }]);
  });
});

describe('notches', () => {
  const notchesOf = (pieces: PieceInput[], allowance = 1) => buildSheet(pieces, { allowance }).pieces.map((p) => p.notches);
  it('puts one notch half way along a short shared seam on both pieces, at the same share of the length', () => {
    const [l, r] = notchesOf(pair(20));
    expect(l).toHaveLength(1);
    expect(r).toHaveLength(1);
  });
  it('places notches on the seam line, pointing out of the piece, for both pieces even though they travel the seam in opposite directions', () => {
    const s = buildSheet(pair(20), { allowance: 1 });
    const [l] = s.pieces[0].notches;
    const [r] = s.pieces[1].notches;
    const lx = Math.max(...s.pieces[0].seamLine.map((q) => q[0]));
    const rx = Math.min(...s.pieces[1].seamLine.map((q) => q[0]));
    expect(l.from[0]).toBeCloseTo(lx, 9);
    expect(l.to[0] - l.from[0]).toBeCloseTo(NOTCH_LENGTH, 9); // left piece: out is to the right
    expect(l.to[1]).toBeCloseTo(l.from[1], 9);
    expect(r.from[0]).toBeCloseTo(rx, 9);
    expect(r.to[0] - r.from[0]).toBeCloseTo(-NOTCH_LENGTH, 9); // right piece: out is to the left
    // The same height on the sheet means the same place along the seam.
    expect(l.from[1] - Math.min(...s.pieces[0].seamLine.map((q) => q[1]))).toBeCloseTo(10, 9);
    expect(r.from[1] - Math.min(...s.pieces[1].seamLine.map((q) => q[1]))).toBeCloseTo(10, 9);
  });
  it('puts notches at equal shares of each side when the sides differ in length (eased seam)', () => {
    const s = buildSheet(pair(20, 16), { allowance: 1 });
    const top = (i: number) => Math.min(...s.pieces[i].seamLine.map((q) => q[1]));
    const [l, r] = [s.pieces[0].notches[0], s.pieces[1].notches[0]];
    expect((l.from[1] - top(0)) / 20).toBeCloseTo(0.5, 9);
    expect((r.from[1] - top(1)) / 16).toBeCloseTo(0.5, 9);
  });
  it('adds a notch for every further 25 cm, evenly spaced', () => {
    const [l] = notchesOf(pair(60));
    expect(l).toHaveLength(3);
    const ys = l.map((n) => n.from[1]).sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeCloseTo(15, 9);
    expect(ys[2] - ys[1]).toBeCloseTo(15, 9);
    expect(notchesOf(pair(49))[0]).toHaveLength(2);
    expect(notchesOf(pair(24))[0]).toHaveLength(1);
  });
  it('has no notch on a seam shorter than the minimum, a seam on one piece, or a side that is not a seam', () => {
    expect(notchesOf(pair(MIN_NOTCHED - 0.1))[0]).toHaveLength(0);
    expect(notchesOf(pair(MIN_NOTCHED))[0]).toHaveLength(1);
    expect(notchesOf([pair(20)[0]])[0]).toHaveLength(0);
  });
  it('points out of a clockwise outline too', () => {
    const [a, b] = pair(20);
    // Travelling the other way round: the sides run in the opposite order, each the other way too.
    const cw = (p: PieceInput): PieceInput => ({ ...p, loop: [...p.loop].reverse(), sides: [...p.sides].reverse().map((s) => ({ ...s, vertices: [...s.vertices].reverse(), points: [...s.points].reverse() })) });
    const s = buildSheet([cw(a), cw(b)], { allowance: 1 });
    expect(s.pieces[0].notches[0].to[0] - s.pieces[0].notches[0].from[0]).toBeCloseTo(NOTCH_LENGTH, 9);
  });
  it('carries the seam number', () => {
    expect(buildSheet(pair(20), { allowance: 1 }).pieces[0].notches[0].seam).toBe(0);
  });
});
