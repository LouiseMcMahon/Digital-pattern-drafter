import { describe, expect, it } from 'vitest';
import { CROSSING_TOLERANCE, SHARED_RADIUS, closestOnSegments, splitCrossings } from './crossings';
import { area, cutMesh, locateInCut, regionFrom } from './cut';
import type { Mesh, Vec3 } from './mesh';
import { type Seam, type SurfacePoint, SurfaceGraph, pointOnSurface, polylineLength, raycast } from './seam';

/** n x n squares of side `size` in z = 0, each cut along one diagonal. */
function grid(n: number, size: number): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push((i * size) / n, (j * size) / n, 0);
  const tris: number[] = [];
  const id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}
const m = grid(12, 12);
const graph = new SurfaceGraph(m.triangles, m.positions.length / 3);
const at = (x: number, y: number): SurfacePoint => raycast(m, [x, y, 5], [0, 0, -1])!;
const open = (...pts: [number, number][]): Seam => ({ points: pts.map(([x, y]) => at(x, y)), closed: false });
const closed = (...pts: [number, number][]): Seam => ({ points: pts.map(([x, y]) => at(x, y)), closed: true });
const where = (p: SurfacePoint) => pointOnSurface(m, p);
const near = (p: SurfacePoint, x: number, y: number) => Math.hypot(where(p)[0] - x, where(p)[1] - y) < 1e-6;
const pathLength = (s: Seam) => polylineLength(graph.seamPath(m.positions as Float64Array, s));

describe('closestOnSegments', () => {
  it('finds where two segments cross, with the position along each', () => {
    const r = closestOnSegments([0, 0, 0], [4, 0, 0], [1, -1, 0], [1, 3, 0])!;
    expect(r.s).toBeCloseTo(0.25, 12);
    expect(r.t).toBeCloseTo(0.25, 12);
    expect(r.distance).toBeCloseTo(0, 12);
  });
  it('measures the gap between segments that miss (skew in space)', () => {
    const r = closestOnSegments([0, 0, 0], [2, 0, 0], [1, -1, 3], [1, 1, 3])!;
    expect(r.s).toBeCloseTo(0.5, 12);
    expect(r.t).toBeCloseTo(0.5, 12);
    expect(r.distance).toBeCloseTo(3, 12);
  });
  it('clamps to the end of the second segment when the lines cross beyond it', () => {
    const r = closestOnSegments([0, 0, 0], [10, 0, 0], [5, 1, 0], [5, 3, 0])!; // the second stops short of y = 0
    expect(r.t).toBe(0);
    expect(r.s).toBeCloseTo(0.5, 12);
    expect(r.distance).toBeCloseTo(1, 12);
    const r2 = closestOnSegments([0, 0, 0], [10, 0, 0], [5, -3, 0], [5, -1, 0])!;
    expect(r2.t).toBe(1);
    expect(r2.s).toBeCloseTo(0.5, 12);
    expect(r2.distance).toBeCloseTo(1, 12);
  });
  it('clamps to the end of the first segment when the lines cross beyond it', () => {
    const r = closestOnSegments([0, 0, 0], [4, 0, 0], [6, -2, 0], [6, 2, 0])!;
    expect(r.s).toBe(1);
    expect(r.t).toBeCloseTo(0.5, 12);
    expect(r.distance).toBeCloseTo(2, 12);
    const r2 = closestOnSegments([0, 0, 0], [4, 0, 0], [-3, -2, 0], [-3, 2, 0])!;
    expect(r2.s).toBe(0);
    expect(r2.distance).toBeCloseTo(3, 12);
  });
  it('reports touching ends as distance 0', () => {
    const r = closestOnSegments([0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 0])!;
    expect(r.distance).toBeCloseTo(0, 12);
    expect(r.s).toBeCloseTo(1, 12);
    expect(r.t).toBeCloseTo(0, 12);
  });
  it('has no answer for parallel, overlapping or zero-length segments', () => {
    expect(closestOnSegments([0, 0, 0], [4, 0, 0], [0, 1, 0], [4, 1, 0])).toBeUndefined();
    expect(closestOnSegments([0, 0, 0], [4, 0, 0], [1, 0, 0], [3, 0, 0])).toBeUndefined();
    expect(closestOnSegments([0, 0, 0], [0, 0, 0], [1, -1, 0], [1, 1, 0])).toBeUndefined();
    expect(closestOnSegments([0, 0, 0], [4, 0, 0], [1, 1, 0], [1, 1, 0])).toBeUndefined();
  });
  it('still answers for segments that are nearly but not quite parallel', () => {
    const r = closestOnSegments([0, 0, 0], [10, 0, 0], [0, -0.5, 0], [10, 0.5, 0])!;
    expect(r.distance).toBeCloseTo(0, 9);
    expect(r.s).toBeCloseTo(0.5, 9);
  });
});

describe('splitCrossings', () => {
  it('puts one shared control point on two seams that cross, without changing either path', () => {
    const a = open([1, 6.3], [11, 5.7]);
    const b = open([4.4, 1], [6.2, 11]);
    const [la, lb] = [pathLength(a), pathLength(b)];
    expect(splitCrossings(m, graph, [a, b])).toBe(1);
    expect(a.points).toHaveLength(3);
    expect(b.points).toHaveLength(3);
    expect(a.points[1]).toEqual(b.points[1]); // the very same place
    // the lines: y = 6.3 - 0.06 (x - 1) and x = 4.4 + 0.18 (y - 1)
    const [px, py] = where(a.points[1]);
    expect(py).toBeCloseTo(6.3 - 0.06 * (px - 1), 6);
    expect(px).toBeCloseTo(4.4 + 0.18 * (py - 1), 6);
    expect(pathLength(a)).toBeCloseTo(la, 6);
    expect(pathLength(b)).toBeCloseTo(lb, 6);
    expect(splitCrossings(m, graph, [a, b])).toBe(0); // nothing left to join
  });

  it('places the crossing exactly where the two lines meet', () => {
    const a = open([2, 2], [10, 10]);
    const b = open([2, 10], [10, 2]);
    expect(splitCrossings(m, graph, [a, b])).toBe(1);
    expect(near(a.points[1], 6, 6)).toBe(true);
    expect(a.points[1]).toEqual(b.points[1]);
  });

  it('leaves seams that do not meet alone, including parallel ones', () => {
    const a = open([1, 3], [11, 3]);
    const b = open([1, 8], [11, 8]);
    const c = open([6, 4], [6, 7]); // stops short of both
    const before = JSON.stringify([a, b, c]);
    expect(splitCrossings(m, graph, [a, b, c])).toBe(0);
    expect(JSON.stringify([a, b, c])).toBe(before);
  });

  it('does nothing for no seams, one seam, or empty seams', () => {
    expect(splitCrossings(m, graph, [])).toBe(0);
    expect(splitCrossings(m, graph, [open([1, 1], [5, 5])])).toBe(0);
    expect(splitCrossings(m, graph, [{ points: [], closed: false }, open([1, 1], [5, 5])])).toBe(0);
    expect(splitCrossings(m, graph, [{ points: [at(3, 3)], closed: false }, open([1, 3], [5, 3])])).toBe(0); // a lone point has no path to cross
  });

  it('does not join a seam to itself', () => {
    const figureEight = open([2, 2], [10, 10], [10, 2], [2, 10]);
    expect(splitCrossings(m, graph, [figureEight])).toBe(0);
    expect(figureEight.points).toHaveLength(4);
  });

  it('joins a seam that ends on the middle of another: the other gains that end point', () => {
    const a = open([1, 6], [11, 6]);
    const b = open([6.5, 1], [6.5, 6]);
    expect(splitCrossings(m, graph, [a, b])).toBe(1);
    expect(a.points).toHaveLength(3);
    expect(near(a.points[1], 6.5, 6)).toBe(true);
    expect(a.points[1]).toEqual(b.points[1]);
    expect(b.points).toHaveLength(2);
    // and the other way round (the seam that ends is the first one)
    const c = open([6.5, 1], [6.5, 6]);
    const d = open([1, 6], [11, 6]);
    expect(splitCrossings(m, graph, [c, d])).toBe(1);
    expect(d.points).toHaveLength(3);
    expect(c.points).toHaveLength(2);
    expect(c.points[1]).toEqual(d.points[1]);
  });

  it('reuses a control point that is already at the crossing, on the first seam', () => {
    const a = open([1, 6], [6, 6], [11, 6]);
    const b = open([6, 1], [6, 11]);
    const own = a.points[1];
    expect(splitCrossings(m, graph, [a, b])).toBe(1);
    expect(a.points).toHaveLength(3); // no new point
    expect(a.points[1]).toBe(own);
    expect(b.points).toHaveLength(3);
    expect(b.points[1]).toEqual(own);
  });

  it('reuses a control point that is already at the crossing, on the second seam', () => {
    const a = open([1, 6], [11, 6]);
    const b = open([6, 1], [6, 6], [6, 11]);
    const own = b.points[1];
    expect(splitCrossings(m, graph, [a, b])).toBe(1);
    expect(b.points).toHaveLength(3);
    expect(b.points[1]).toBe(own);
    expect(a.points).toHaveLength(3);
    expect(a.points[1]).toEqual(own);
  });

  it('merges two nearby points of the two seams into one place, the first seam winning', () => {
    const a = open([1, 6], [6, 6], [11, 6]);
    const b = open([6, 1], [6.03, 6], [6, 11]);
    const own = a.points[1];
    expect(SHARED_RADIUS).toBeGreaterThan(0.03);
    expect(splitCrossings(m, graph, [a, b])).toBe(1);
    expect(a.points).toHaveLength(3);
    expect(b.points).toHaveLength(3);
    expect(b.points[1]).toBe(own);
  });

  it('a point farther than the shared radius from the crossing is not mistaken for it', () => {
    const a = open([1, 6], [6, 6], [11, 6]);
    const b = open([6, 1], [6 + SHARED_RADIUS * 4, 6.4], [6, 11]);
    expect(splitCrossings(m, graph, [a, b])).toBe(1);
    expect(b.points).toHaveLength(4); // b's own point is a different place: the crossing is added to both
    expect(a.points).toHaveLength(4);
    expect(near(a.points[1], 6, 6)).toBe(true); // a's own point is still there
    expect(a.points[2]).toEqual(b.points[1]); // the crossing: after a's own point, before b's own
  });

  it('joins a seam to the closing leg of a closed seam, putting the new point last', () => {
    const loop = closed([3, 3], [9, 3], [9, 9], [3, 9]); // the closing leg runs from (3, 9) back down to (3, 3)
    const bar = open([1, 6], [5, 6]);
    expect(splitCrossings(m, graph, [loop, bar])).toBe(1);
    expect(loop.points).toHaveLength(5);
    expect(near(loop.points[4], 3, 6)).toBe(true);
    expect(near(loop.points[3], 3, 9)).toBe(true);
    expect(loop.closed).toBe(true);
    expect(bar.points).toHaveLength(3);
  });

  it('puts the new point on the right leg of a seam with several', () => {
    const a = open([1, 1], [4, 2], [8, 2], [11, 1]);
    const b = open([6, 0.5], [6, 4]);
    expect(splitCrossings(m, graph, [a, b])).toBe(1);
    expect(a.points).toHaveLength(5);
    expect(near(a.points[2], 6, 2)).toBe(true); // between the 2nd and 3rd points
    expect(near(a.points[1], 4, 2)).toBe(true);
    expect(near(a.points[3], 8, 2)).toBe(true);
  });

  it('joins every crossing, and stops at the limit when told to', () => {
    const make = () => [open([1, 2], [11, 2]), open([3, 1], [3, 11]), open([8, 1], [8, 11])];
    const seams = make();
    expect(splitCrossings(m, graph, seams)).toBe(2);
    expect(seams[0].points).toHaveLength(4);
    expect(seams[1].points).toHaveLength(3);
    expect(seams[2].points).toHaveLength(3);
    const limited = make();
    expect(splitCrossings(m, graph, limited, 1)).toBe(1);
    expect(limited[0].points).toHaveLength(3);
    expect(splitCrossings(m, graph, limited, 0)).toBe(0);
  });

  it('copes with three seams through one point (each pair joins, all at the same place)', () => {
    const seams = [open([2, 6], [10, 6]), open([6, 2], [6, 10]), open([2, 2], [10, 10])];
    const joins = splitCrossings(m, graph, seams);
    expect(joins).toBeGreaterThanOrEqual(2);
    for (const s of seams) expect(s.points.some((p) => near(p, 6, 6))).toBe(true);
    expect(splitCrossings(m, graph, seams)).toBe(0);
  });

  it('makes seams that cross cuttable into the right panels', () => {
    // Two overlapping squares: 6 x 6 at (2, 2) and 6 x 6 at (5, 5). They cross at (8, 5) and (5, 8).
    const squares = [closed([2, 2], [8, 2], [8, 8], [2, 8]), closed([5, 5], [11, 5], [11, 11], [5, 11])];
    expect(splitCrossings(m, graph, squares)).toBe(2);
    expect(squares[0].points).toHaveLength(6);
    expect(squares[1].points).toHaveLength(6);
    const cut = cutMesh(m, graph, squares);
    const regionArea = (x: number, y: number) => area(cut.mesh, regionFrom(cut, locateInCut(cut, m, at(x, y))));
    expect(regionArea(3, 3)).toBeCloseTo(27, 6); // only the first square
    expect(regionArea(10, 10)).toBeCloseTo(27, 6); // only the second
    expect(regionArea(6.5, 6.5)).toBeCloseTo(9, 6); // both
    const outside = regionArea(1, 11);
    expect(outside).toBeCloseTo(144 - 27 - 27 - 9, 6);
  });

  it('exposes a tolerance small enough that only real crossings count', () => {
    expect(CROSSING_TOLERANCE).toBeGreaterThan(0);
    expect(CROSSING_TOLERANCE).toBeLessThan(1e-3);
    const a = open([1, 6], [11, 6]);
    const b = open([6, 1], [6, 5.99]); // ends 0.01 cm short of the first seam
    expect(splitCrossings(m, graph, [a, b])).toBe(0);
  });

  it('works on a curved surface too (paths bend, crossings are still found)', () => {
    const bump = (() => {
      const n = 16;
      const positions: number[] = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const x = -4 + (8 * i) / n, y = (6 * j) / n;
        positions.push(x, y, 4 - (x * x) / 4 - (y * y) / 9);
      }
      const id = (i: number, j: number) => j * (n + 1) + i;
      const tris: number[] = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
      return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) } as Mesh;
    })();
    const g = new SurfaceGraph(bump.triangles, bump.positions.length / 3);
    const pt = (x: number, y: number): SurfacePoint => raycast(bump, [x, y, 20], [0, 0, -1])!;
    const a: Seam = { points: [pt(-3, 1), pt(3, 5)], closed: false };
    const b: Seam = { points: [pt(-3, 5), pt(3, 1)], closed: false };
    expect(splitCrossings(bump, g, [a, b])).toBe(1);
    const x = pointOnSurface(bump, a.points[1]) as Vec3;
    expect(Math.abs(x[0])).toBeLessThan(0.6);
    expect(x[1]).toBeGreaterThan(2);
    expect(x[1]).toBeLessThan(5);
    for (const s of [a, b]) { // it is on both paths
      const line = g.seamPath(bump.positions as Float64Array, s);
      let best = Infinity;
      for (let i = 0; i + 5 < line.length; i += 3) {
        const d = [line[i + 3] - line[i], line[i + 4] - line[i + 1], line[i + 5] - line[i + 2]];
        const l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x[0] - line[i]) * d[0] + (x[1] - line[i + 1]) * d[1] + (x[2] - line[i + 2]) * d[2]) / l2)) : 0;
        best = Math.min(best, Math.hypot(line[i] + t * d[0] - x[0], line[i + 1] + t * d[1] - x[1], line[i + 2] + t * d[2] - x[2]));
      }
      expect(best).toBeLessThan(1e-6);
    }
    expect(a.points[1]).toEqual(b.points[1]);
  });
});
