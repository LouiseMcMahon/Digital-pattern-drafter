import { describe, expect, it } from 'vitest';
import { type Loop, arcBetweenPoints, arcPoints, arcPositionOf, loopCentroid, loopLength, pointAtArc, slicePlane } from './slice';

/** Icosphere-free cylinder test: closed tube of radius r. */
function tube(r: number, rows: number, cols: number, height: number) {
  const positions = new Float64Array(rows * cols * 3);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const t = (2 * Math.PI * j) / cols;
    positions.set([r * Math.cos(t), (height * i) / (rows - 1), r * Math.sin(t)], 3 * (i * cols + j));
  }
  const tris: number[] = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
    const a = i * cols + j, b = i * cols + ((j + 1) % cols);
    tris.push(a, a + cols, b, b, a + cols, b + cols);
  }
  return { positions, triangles: new Uint32Array(tris) };
}

describe('slicePlane', () => {
  it('slices a tube into one closed loop with the polygon perimeter', () => {
    const { positions, triangles } = tube(10, 11, 360, 100);
    const loops = slicePlane(positions, triangles, { point: [0, 47, 0], normal: [0, 1, 0] });
    expect(loops).toHaveLength(1);
    expect(loops[0].closed).toBe(true);
    expect(loopLength(loops[0])).toBeCloseTo(2 * Math.PI * 10, 1);
  });

  it('a vertical plane through the tube gives two open chains... or one closed loop around the section', () => {
    const { positions, triangles } = tube(10, 11, 360, 100);
    const loops = slicePlane(positions, triangles, { point: [0, 0, 0], normal: [1, 0, 0] });
    expect(loops.length).toBeGreaterThan(0);
    // Two sides of the tube, each 100 long (open tube, so open chains).
    const total = loops.reduce((s, l) => s + loopLength(l), 0);
    expect(total).toBeCloseTo(200, 0);
  });
});

describe('arc helpers on a tube of known radius', () => {
  const R = 10;
  const { positions, triangles } = tube(R, 11, 720, 100);
  const loop = slicePlane(positions, triangles, { point: [0, 50, 0], normal: [0, 1, 0] })[0];
  const at = (deg: number): [number, number, number] => [R * Math.cos((deg * Math.PI) / 180), 50, R * Math.sin((deg * Math.PI) / 180)];

  it('arc length between two points is radius times the angle between them', () => {
    expect(arcBetweenPoints(loop, at(0), at(90))).toBeCloseTo((R * Math.PI) / 2, 2);
    expect(arcBetweenPoints(loop, at(10), at(100))).toBeCloseTo((R * Math.PI) / 2, 2);
  });

  it('takes the shorter way round a closed loop', () => {
    expect(arcBetweenPoints(loop, at(0), at(270))).toBeCloseTo((R * Math.PI) / 2, 2);
    expect(arcBetweenPoints(loop, at(0), at(180))).toBeCloseTo(R * Math.PI, 2);
  });

  it('is symmetric and zero for the same point', () => {
    expect(arcBetweenPoints(loop, at(33), at(120))).toBeCloseTo(arcBetweenPoints(loop, at(120), at(33)), 9);
    expect(arcBetweenPoints(loop, at(33), at(33))).toBeCloseTo(0, 6);
  });

  it('varies smoothly: moving a point by 0.1 mm moves the arc by about 0.1 mm', () => {
    const p = at(40);
    const q: [number, number, number] = [p[0] + 0.01 * Math.sin((40 * Math.PI) / 180), p[1], p[2] - 0.01 * Math.cos((40 * Math.PI) / 180)];
    expect(Math.abs(arcBetweenPoints(loop, q, at(100)) - arcBetweenPoints(loop, p, at(100)))).toBeLessThan(0.0125);
  });

  it('arcPositionOf is arc length from the loop start', () => {
    const start = [loop.points[0], loop.points[1], loop.points[2]] as [number, number, number];
    expect(arcPositionOf(loop, start)).toBeCloseTo(0, 6);
  });

  it('arcPoints returns a polyline whose length equals the arc', () => {
    const pts = arcPoints(loop, at(0), at(90));
    let len = 0;
    for (let i = 3; i < pts.length; i += 3) len += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]);
    expect(len).toBeCloseTo((R * Math.PI) / 2, 1);
  });
});

describe('slicePlane attribute interpolation', () => {
  it('interpolates a per-vertex scalar linearly onto the slice points', () => {
    const { positions, triangles } = tube(10, 11, 90, 100);
    const attr = Float64Array.from({ length: positions.length / 3 }, (_, i) => positions[3 * i + 1] * 2); // 2 * y
    const [l] = slicePlane(positions, triangles, { point: [0, 33, 0], normal: [0, 1, 0] }, undefined, attr);
    expect(l.attr).toBeDefined();
    for (const v of l.attr!) expect(v).toBeCloseTo(66, 6);
  });

  it('a tilted plane gives the right ellipse perimeter', () => {
    const { positions, triangles } = tube(10, 41, 720, 100);
    const [l] = slicePlane(positions, triangles, { point: [0, 50, 0], normal: [0, Math.SQRT1_2, Math.SQRT1_2] });
    // Plane at 45 degrees through a cylinder: ellipse with semi-axes 10 and 10*sqrt(2). Ramanujan's approximation.
    const [a, b] = [10, 10 * Math.SQRT2];
    const h = ((a - b) / (a + b)) ** 2;
    expect(loopLength(l)).toBeCloseTo(Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))), 1);
  });
});

/**
 * MUTATION-TESTING DRIVEN (npm run mutate -- slice). The first Stryker run scored slice.ts at 28%: the
 * tests above checked a tube and a few round numbers, so most of the arithmetic could change without a
 * failure. The tests below use shapes small enough to work out by hand (a 3-4-5 path, a 10 cm square, a
 * 3-4-4 segment) so every term of every formula matters.
 */
const open345: Loop = { points: [0, 0, 0, 3, 0, 0, 3, 4, 0], closed: false }; // 3 then 4: length 7, closing edge would be 5
const square: Loop = { points: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0], closed: true }; // 10 cm square, length 40
type V = [number, number, number];

describe('loopLength', () => {
  it('open path: sum of the segments, no closing edge', () => expect(loopLength(open345)).toBe(7));
  it('closed path: includes the closing edge (3-4-5 triangle: 12)', () => expect(loopLength({ ...open345, closed: true })).toBe(12));
  it('uses all three coordinates (a 1-2-2 step is 3 long)', () => expect(loopLength({ points: [0, 0, 0, 1, 2, 2], closed: false })).toBe(3));
  it('uses the right coordinate for each axis in the closing edge', () => {
    // Closing edge runs (7,0,0)->(0,0,0)? no: last point (4,6,12) back to (1,2,3): (3,4,9) -> sqrt(9+16+81)
    const l: Loop = { points: [1, 2, 3, 1, 2, 3, 4, 6, 12], closed: true };
    expect(loopLength(l)).toBeCloseTo(Math.hypot(3, 4, 9) * 2, 9); // out and back along the same edge
  });
  it('a square is 40', () => expect(loopLength(square)).toBe(40));
  it('one point or none has no length', () => {
    expect(loopLength({ points: [1, 1, 1], closed: false })).toBe(0);
    expect(loopLength({ points: [1, 1, 1], closed: true })).toBe(0);
    expect(loopLength({ points: [], closed: false })).toBe(0);
  });
});

describe('loopCentroid', () => {
  it('is the mean of the points, per axis', () => {
    const c = loopCentroid({ points: [0, 0, 0, 2, 4, 6, 4, 8, 12], closed: false });
    expect(c).toEqual([2, 4, 6]);
  });
  it('keeps x, y and z apart', () => {
    expect(loopCentroid({ points: [1, 10, 100, 3, 30, 300], closed: true })).toEqual([2, 20, 200]);
  });
  it('the centroid of the square is its centre', () => expect(loopCentroid(square)).toEqual([5, 5, 0]));
});

describe('arcPositionOf (arc length from the first point to the point on the loop closest to p)', () => {
  it.each<[string, V, number]>([
    ['on the first edge', [2, 1, 0], 2],
    ['beside the second edge (nearer than the end of the first)', [5, 1, 0], 4],
    ['on the second edge', [4, 2, 0], 3 + 2],
    ['in 3D the off-plane distance does not matter', [1, 1, 7], 1],
    ['before the start clamps to the start', [-5, 0, 0], 0],
    ['past the end clamps to the end', [3, 20, 0], 7],
    ['exactly at the corner', [3, 0, 0], 3],
  ])('open 3-4 path: %s', (_name, p, expected) => expect(arcPositionOf(open345, p)).toBeCloseTo(expected, 9));

  it.each<[string, V, number]>([
    ['bottom edge', [5, -2, 0], 5],
    ['right edge', [12, 5, 0], 15],
    ['top edge', [5, 12, 0], 25],
    ['left edge (the closing edge)', [-2, 5, 0], 35],
    ['the origin', [0, 0, 0], 0],
    ['in 3D', [5, -2, 9], 5],
  ])('closed square: %s', (_name, p, expected) => expect(arcPositionOf(square, p)).toBeCloseTo(expected, 9));

  it('picks the nearer of two edges', () => {
    expect(arcPositionOf(square, [9, 1, 0])).toBeCloseTo(9, 9); // 1 from the bottom edge, 1 from the right edge: bottom (first) wins the tie
    expect(arcPositionOf(square, [9.5, 1, 0])).toBeCloseTo(11, 9); // closer to the right edge
  });
  it('does not produce NaN on a loop with a repeated point', () => {
    const l: Loop = { points: [0, 0, 0, 0, 0, 0, 6, 0, 0], closed: false };
    expect(Number.isFinite(arcPositionOf(l, [3, 1, 0]))).toBe(true);
    expect(arcPositionOf(l, [3, 1, 0])).toBeCloseTo(3, 12); // the repeated point adds no length
  });
});

describe('arcBetweenPoints', () => {
  it('open path: just the difference', () => expect(arcBetweenPoints(open345, [1, 0, 0], [3, 3, 0])).toBeCloseTo(5, 9));
  it('open path never wraps', () => expect(arcBetweenPoints(open345, [0, 0, 0], [3, 4, 0])).toBeCloseTo(7, 9));
  it('closed square: the short way round, whichever side the points are on', () => {
    expect(arcBetweenPoints(square, [5, -2, 0], [12, 5, 0])).toBeCloseTo(10, 9);
    expect(arcBetweenPoints(square, [5, -2, 0], [-2, 5, 0])).toBeCloseTo(10, 9); // 30 one way, 10 the other
    expect(arcBetweenPoints(square, [-2, 5, 0], [5, -2, 0])).toBeCloseTo(10, 9);
    expect(arcBetweenPoints(square, [5, -2, 0], [5, 12, 0])).toBeCloseTo(20, 9); // exactly half
  });
});

describe('pointAtArc', () => {
  it.each<[number, V]>([
    [0, [0, 0, 0]], [5, [5, 0, 0]], [10, [10, 0, 0]], [15, [10, 5, 0]], [20, [10, 10, 0]], [25, [5, 10, 0]], [35, [0, 5, 0]],
  ])('closed square at %s', (pos, expected) => {
    const p = pointAtArc(square, pos);
    expect(p[0]).toBeCloseTo(expected[0], 9); expect(p[1]).toBeCloseTo(expected[1], 9); expect(p[2]).toBeCloseTo(expected[2], 9);
  });
  it('wraps a closed loop in both directions', () => {
    expect(pointAtArc(square, 40)).toEqual([0, 0, 0]);
    expect(pointAtArc(square, 45)).toEqual([5, 0, 0]);
    expect(pointAtArc(square, -5)).toEqual([0, 5, 0]);
    expect(pointAtArc(square, 85)).toEqual([5, 0, 0]);
  });
  it('clamps an open path to its ends', () => {
    expect(pointAtArc(open345, -3)).toEqual([0, 0, 0]);
    expect(pointAtArc(open345, 100)).toEqual([3, 4, 0]);
    expect(pointAtArc(open345, 7)).toEqual([3, 4, 0]);
    expect(pointAtArc(open345, 5)).toEqual([3, 2, 0]);
  });
  it('interpolates in 3D along a 3-4-4 segment (length 6)', () => {
    const p = pointAtArc({ points: [0, 0, 0, 2, 4, 4], closed: false }, 3);
    expect(p[0]).toBeCloseTo(1, 9); expect(p[1]).toBeCloseTo(2, 9); expect(p[2]).toBeCloseTo(2, 9);
  });
  it('steps over a zero-length segment without NaN', () => {
    const p = pointAtArc({ points: [0, 0, 0, 0, 0, 0, 6, 0, 0], closed: false }, 2);
    expect(p).toEqual([2, 0, 0]);
  });
  it('is the inverse of arcPositionOf on the loop', () => {
    for (const pos of [1, 7, 13, 22, 38]) expect(arcPositionOf(square, pointAtArc(square, pos))).toBeCloseTo(pos, 9);
  });
});

describe('arcPoints', () => {
  const len = (pts: number[]) => { let s = 0; for (let i = 3; i < pts.length; i += 3) s += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]); return s; };
  const at = (pts: number[], i: number) => [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]];

  it('runs from the first point to the second along the loop', () => {
    const pts = arcPoints(square, [5, -2, 0], [12, 5, 0]);
    expect(at(pts, 0)).toEqual([5, 0, 0]);
    const last = at(pts, pts.length / 3 - 1);
    expect(last[0]).toBeCloseTo(10, 9); expect(last[1]).toBeCloseTo(5, 9);
    expect(len(pts)).toBeCloseTo(10, 6);
  });
  it('takes the short way across the start of a closed loop', () => {
    const pts = arcPoints(square, [-2, 5, 0], [5, -2, 0]);
    expect(len(pts)).toBeCloseTo(10, 6);
    const n = pts.length / 3;
    expect(at(pts, 0)).toEqual([0, 5, 0]); // runs in loop order: 35 -> 45 (= 5)
    const last = at(pts, n - 1);
    expect(last[0]).toBeCloseTo(5, 9); expect(last[1]).toBeCloseTo(0, 9);
    expect(pts.some((_, i) => i % 3 === 0 && Math.abs(pts[i]) < 1e-9 && Math.abs(pts[i + 1]) < 1e-9)).toBe(true); // passes the corner (0,0)
  });
  it('gives the same path whichever way round the points are given', () => {
    expect(arcPoints(square, [12, 5, 0], [5, -2, 0])).toEqual(arcPoints(square, [5, -2, 0], [12, 5, 0]));
  });
  it('is spaced at about 0.5 cm or finer', () => {
    const pts = arcPoints(square, [5, -2, 0], [5, 12, 0]);
    for (let i = 1; i < pts.length / 3; i++) expect(Math.hypot(...(at(pts, i).map((v, k) => v - at(pts, i - 1)[k]) as V))).toBeLessThanOrEqual(0.5 + 1e-9);
  });
  it('follows an open path without wrapping at its end', () => {
    const pts = arcPoints(open345, [0, 0, 0], [3, 4, 0]);
    expect(len(pts)).toBeCloseTo(7, 6);
    expect(at(pts, 0)).toEqual([0, 0, 0]);
    expect(at(pts, pts.length / 3 - 1)).toEqual([3, 4, 0]);
  });
  it('a path from a point to itself is that point (at least 3 samples)', () => {
    const pts = arcPoints(square, [5, -2, 0], [5, -2, 0]);
    expect(pts.length / 3).toBe(3);
    expect(at(pts, 2)).toEqual([5, 0, 0]);
  });
});

describe('slicePlane on small meshes with known answers', () => {
  // Unit cube-like open tube: 4 sides, 2 rings, height 10, square cross-section 10x10, split into triangles.
  const ring = (y: number) => [[0, y, 0], [10, y, 0], [10, y, 10], [0, y, 10]];
  const positions = Float64Array.from([...ring(0), ...ring(10)].flat());
  const tris: number[] = [];
  for (let j = 0; j < 4; j++) { const a = j, b = (j + 1) % 4; tris.push(a, a + 4, b, b, a + 4, b + 4); }
  const triangles = Uint32Array.from(tris);

  it('a horizontal slice is a closed loop of the cross-section, with each point on the plane', () => {
    const loops = slicePlane(positions, triangles, { point: [0, 4, 0], normal: [0, 1, 0] });
    expect(loops).toHaveLength(1);
    expect(loops[0].closed).toBe(true);
    for (let i = 1; i < loops[0].points.length; i += 3) expect(loops[0].points[i]).toBeCloseTo(4, 9);
    expect(loopLength(loops[0])).toBeCloseTo(40, 9);
  });
  it('places each point where the edge crosses the plane (interpolation)', () => {
    const [l] = slicePlane(positions, triangles, { point: [0, 2.5, 0], normal: [0, 1, 0] });
    const xs = new Set<number>();
    for (let i = 0; i < l.points.length; i += 3) xs.add(Math.round(l.points[i] * 1e6) / 1e6);
    expect([...xs].sort()).toContain(0);
    expect([...xs].sort()).toContain(10);
    // The diagonal edge of each side face is crossed at 25% of the way up, so x/z along the side is 2.5 or 7.5 there.
    expect([...xs]).toContain(2.5);
  });
  it('does not repeat a point where triangles share an edge', () => {
    const [l] = slicePlane(positions, triangles, { point: [0, 4, 0], normal: [0, 1, 0] });
    const seen = new Set<string>();
    for (let i = 0; i < l.points.length; i += 3) seen.add(l.points.slice(i, i + 3).map((v) => v.toFixed(6)).join(','));
    expect(seen.size).toBe(l.points.length / 3);
  });
  it('a plane that misses the mesh gives nothing', () => {
    expect(slicePlane(positions, triangles, { point: [0, 100, 0], normal: [0, 1, 0] })).toEqual([]);
    expect(slicePlane(positions, triangles, { point: [0, -5, 0], normal: [0, 1, 0] })).toEqual([]);
  });
  it('the side the normal points to does not change the loop', () => {
    const up = slicePlane(positions, triangles, { point: [0, 4, 0], normal: [0, 1, 0] })[0];
    const down = slicePlane(positions, triangles, { point: [0, 4, 0], normal: [0, -1, 0] })[0];
    expect(loopLength(down)).toBeCloseTo(loopLength(up), 9);
  });
  it('only slices the triangles in `subset`: half the tube gives one open chain', () => {
    // Faces 0 and 1 only (triangle indices 0..3): two sides of the square.
    const loops = slicePlane(positions, triangles, { point: [0, 4, 0], normal: [0, 1, 0] }, [0, 1, 2, 3]);
    expect(loops).toHaveLength(1);
    expect(loops[0].closed).toBe(false);
    expect(loopLength(loops[0])).toBeCloseTo(20, 9);
  });
  it('an empty subset gives nothing', () => {
    expect(slicePlane(positions, triangles, { point: [0, 4, 0], normal: [0, 1, 0] }, [])).toEqual([]);
  });
  it('a vertical plane through the middle gives two open chains of 10 cm each', () => {
    const loops = slicePlane(positions, triangles, { point: [5, 0, 0], normal: [1, 0, 0] });
    expect(loops).toHaveLength(2);
    for (const l of loops) { expect(l.closed).toBe(false); expect(loopLength(l)).toBeCloseTo(10, 9); }
  });
  it('carries a per-vertex attribute onto the slice points, linearly', () => {
    const attr = Float64Array.from([...ring(0), ...ring(10)].map((v) => v[0] * 100 + v[1])); // 100*x + y
    const [l] = slicePlane(positions, triangles, { point: [0, 4, 0], normal: [0, 1, 0] }, undefined, attr);
    expect(l.attr).toHaveLength(l.points.length / 3);
    for (let i = 0; i < l.attr!.length; i++) expect(l.attr![i]).toBeCloseTo(100 * l.points[3 * i] + l.points[3 * i + 1], 6);
  });
  it('has no attr array when none is given', () => {
    const [l] = slicePlane(positions, triangles, { point: [0, 4, 0], normal: [0, 1, 0] });
    expect(l.attr).toBeUndefined();
  });
});
