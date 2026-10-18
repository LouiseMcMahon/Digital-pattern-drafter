import { describe, expect, it } from 'vitest';
import type { Mesh, Vec3 } from './mesh';
import { Heap, insertControlPoint, nearestOnSeams, closestBary, type Seam, type SnapTarget, closestSurfacePoint, findControlPoint, snapPoint, type SurfacePoint, SurfaceGraph, pointOnSurface, polylineLength, raycast, snapToVertex, vertexPoint } from './seam';

/** n x n unit squares in z = 0 (side `size`), each cut along one diagonal. Vertex (i, j) has id j * (n + 1) + i. */
function grid(n: number, size = 1): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push((i * size) / n, (j * size) / n, 0);
  const tris: number[] = [];
  const id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  }
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}

/** Open tube of radius r, height h: `around` segments, `rows` bands. Vertex (i, j) has id j * around + i. */
function tube(around: number, rows: number, r: number, h: number): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i < around; i++) positions.push(r * Math.cos((2 * Math.PI * i) / around), (h * j) / rows, r * Math.sin((2 * Math.PI * i) / around));
  const tris: number[] = [];
  const id = (i: number, j: number) => j * around + (i % around);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < around; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  }
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}

const graphOf = (m: Mesh, steiner?: number) => new SurfaceGraph(m.triangles, m.positions.length / 3, steiner);
const corner = (m: Mesh, v: number) => vertexPoint(m, v);

describe('pointOnSurface', () => {
  it('interpolates the triangle corners with the barycentric weights', () => {
    const m = grid(1, 2); // vertices (0,0) (2,0) (0,2) (2,2); triangle 0 = (0,0) (2,0) (2,2)
    expect(pointOnSurface(m, { tri: 0, bary: [1, 0, 0] })).toEqual([0, 0, 0]);
    expect(pointOnSurface(m, { tri: 0, bary: [0, 1, 0] })).toEqual([2, 0, 0]);
    expect(pointOnSurface(m, { tri: 0, bary: [0, 0, 1] })).toEqual([2, 2, 0]);
    expect(pointOnSurface(m, { tri: 0, bary: [0.5, 0.25, 0.25] })).toEqual([1, 0.5, 0]);
    expect(pointOnSurface(m, { tri: 1, bary: [0.5, 0, 0.5] })).toEqual([0, 1, 0]);
  });
  it('follows the surface when the vertices move (the point is stored on the face, not in space)', () => {
    const m = grid(2);
    const p: SurfacePoint = { tri: 3, bary: [0.2, 0.3, 0.5] };
    const before = pointOnSurface(m, p);
    const moved: Mesh = { ...m, positions: m.positions.map((x, i) => (i % 3 === 2 ? 5 : x * 2)) };
    const after = pointOnSurface(moved, p);
    expect(after).toEqual([before[0] * 2, before[1] * 2, 5]);
  });
});

describe('vertexPoint', () => {
  it('is exactly at the vertex, whichever corner of the triangle it is', () => {
    const m = grid(2);
    for (let v = 0; v < 9; v++) expect(pointOnSurface(m, vertexPoint(m, v))).toEqual([(v % 3) / 2, Math.floor(v / 3) / 2, 0]);
  });
  it('refuses a vertex no triangle uses', () => {
    expect(() => vertexPoint(grid(1), 4)).toThrow('Vertex 4 is not used');
  });
});

describe('raycast', () => {
  const m = grid(2);
  it('finds the triangle and barycentric weights under a ray from above', () => {
    const hit = raycast(m, [0.75, 0.25, 5], [0, 0, -1])!;
    expect(hit.t).toBeCloseTo(5, 12);
    expect(pointOnSurface(m, hit).map((x) => +x.toFixed(9))).toEqual([0.75, 0.25, 0]);
    expect(hit.bary[0] + hit.bary[1] + hit.bary[2]).toBeCloseTo(1, 12);
  });
  it('hits from below too, and in the direction of the ray only', () => {
    expect(raycast(m, [0.5, 0.25, -3], [0, 0, 1])!.t).toBeCloseTo(3, 12);
    expect(raycast(m, [0.5, 0.25, 5], [0, 0, 1])).toBeUndefined();
  });
  it('misses outside the mesh and for rays parallel to it', () => {
    expect(raycast(m, [1.5, 0.5, 5], [0, 0, -1])).toBeUndefined();
    expect(raycast(m, [-0.5, 0.5, 5], [0, 0, -1])).toBeUndefined();
    expect(raycast(m, [0.5, 1.5, 5], [0, 0, -1])).toBeUndefined();
    expect(raycast(m, [0.5, 0.5, 5], [1, 0, 0])).toBeUndefined();
  });
  it('returns the nearest of several surfaces', () => {
    const two: Mesh = { positions: Float64Array.from([...m.positions, ...m.positions.map((x, i) => (i % 3 === 2 ? 1 : x))]), triangles: Uint32Array.from([...m.triangles, ...m.triangles.map((v) => v + 9)]) };
    const hit = raycast(two, [0.5, 0.25, 5], [0, 0, -1])!;
    expect(hit.t).toBeCloseTo(4, 12);
    expect(hit.tri).toBeGreaterThanOrEqual(8);
  });
  it('accepts hits on the triangle edges (weights of exactly 0 or 1)', () => {
    const hit = raycast(m, [0, 0, 1], [0, 0, -1])!;
    expect(pointOnSurface(m, hit).map((x) => +x.toFixed(9))).toEqual([0, 0, 0]);
  });
});

describe('snapToVertex', () => {
  const m = grid(2);
  it('snaps a point within the radius to the nearest corner of its triangle', () => {
    const near: SurfacePoint = { tri: 0, bary: [0.9, 0.1, 0] }; // 0.05 from vertex 0 (distance 0.1 * 0.5)
    const snapped = snapToVertex(m, near, 0.1);
    expect(pointOnSurface(m, snapped)).toEqual([0, 0, 0]);
  });
  it('leaves a point beyond the radius alone', () => {
    const far: SurfacePoint = { tri: 0, bary: [0.5, 0.3, 0.2] };
    expect(snapToVertex(m, far, 0.1)).toBe(far);
  });
  it('snaps when the distance is exactly the radius', () => {
    const p: SurfacePoint = { tri: 0, bary: [0.8, 0.2, 0] }; // exactly 0.1 from vertex 0
    expect(pointOnSurface(m, snapToVertex(m, p, 0.1))).toEqual([0, 0, 0]);
  });
  it('picks the nearer of two candidates', () => {
    const p: SurfacePoint = { tri: 0, bary: [0.3, 0.7, 0] }; // between vertex 0 and vertex 1, closer to 1
    expect(pointOnSurface(m, snapToVertex(m, p, 0.5))).toEqual([0.5, 0, 0]);
  });
});

describe('SurfaceGraph.path on a flat grid', () => {
  const n = 8;
  const m = grid(n);
  const g = graphOf(m);
  const pos = m.positions;

  it('runs from the start point to the end point', () => {
    const a: SurfacePoint = { tri: 0, bary: [0.2, 0.5, 0.3] };
    const b: SurfacePoint = { tri: 2 * (n * n) - 1, bary: [0.6, 0.1, 0.3] };
    const p = g.path(pos, a, b);
    expect(p.slice(0, 3)).toEqual(pointOnSurface(m, a));
    expect(p.slice(-3)).toEqual(pointOnSurface(m, b));
  });
  it('is nearly straight across the plane and never shorter than the straight line', () => {
    const [a, b] = [corner(m, 0), corner(m, (n + 1) * (n + 1) - 1)];
    const L = polylineLength(g.path(pos, a, b));
    expect(L).toBeGreaterThanOrEqual(Math.SQRT2 - 1e-9);
    expect(L).toBeLessThan(Math.SQRT2 * 1.01);
  });
  it('follows a straight mesh row exactly', () => {
    const L = polylineLength(g.path(pos, corner(m, 0), corner(m, n)));
    expect(L).toBeCloseTo(1, 9);
  });
  it('is a straight segment when both points are in one triangle', () => {
    const a: SurfacePoint = { tri: 0, bary: [0.5, 0.25, 0.25] };
    const b: SurfacePoint = { tri: 0, bary: [0.25, 0.5, 0.25] };
    const p = g.path(pos, a, b);
    expect(p.length).toBe(6);
    expect(polylineLength(p)).toBeCloseTo(0.25 * 0.125, 9); // moves 0.25 of the first edge (1/8 long)
  });
  it('is zero length from a point to itself', () => {
    const a: SurfacePoint = { tri: 5, bary: [0.2, 0.3, 0.5] };
    expect(polylineLength(g.path(pos, a, a))).toBe(0);
  });
  it('is the same length in both directions', () => {
    const a: SurfacePoint = { tri: 3, bary: [0.2, 0.3, 0.5] };
    const b: SurfacePoint = { tri: 90, bary: [0.4, 0.4, 0.2] };
    expect(polylineLength(g.path(pos, a, b))).toBeCloseTo(polylineLength(g.path(pos, b, a)), 9);
  });
  it('is more accurate with more Steiner points', () => {
    const [a, b] = [corner(m, 0), corner(m, (n + 1) * (n + 1) - 1)];
    const lengthWith = (s: number) => polylineLength(graphOf(m, s).path(pos, a, b));
    expect(lengthWith(0)).toBeGreaterThan(lengthWith(3));
    expect(lengthWith(6)).toBeLessThanOrEqual(lengthWith(3) + 1e-12);
    expect(lengthWith(0)).toBeCloseTo(Math.SQRT2, 9); // along mesh diagonals only: exact here
  });
});

describe('SurfaceGraph.path on a tube (curved surface)', () => {
  const around = 24;
  const r = 10;
  const h = 40;
  const m = tube(around, 8, r, h);
  const g = graphOf(m);
  const pos = m.positions;
  const chord = 2 * r * Math.sin(Math.PI / around);

  it('goes the short way round at constant height: half the polygon perimeter', () => {
    const L = polylineLength(g.path(pos, corner(m, 0), corner(m, around / 2)));
    expect(L).toBeCloseTo((around / 2) * chord, 6);
  });
  it('goes the short way round whichever side is shorter', () => {
    const L = polylineLength(g.path(pos, corner(m, 0), corner(m, around - 3)));
    expect(L).toBeCloseTo(3 * chord, 6);
  });
  it('runs straight up a vertical line', () => {
    const L = polylineLength(g.path(pos, corner(m, 0), corner(m, 8 * around)));
    expect(L).toBeCloseTo(h, 6);
  });
  it('stays on the surface: every point of the path is at the tube radius or inside the polygon', () => {
    const p = g.path(pos, corner(m, 0), corner(m, 8 * around + around / 2));
    const apothem = r * Math.cos(Math.PI / around);
    for (let i = 0; i < p.length; i += 3) {
      const rad = Math.hypot(p[i], p[i + 2]);
      expect(rad).toBeLessThanOrEqual(r + 1e-9);
      expect(rad).toBeGreaterThanOrEqual(apothem - 1e-9);
    }
  });
  it('a diagonal is close to the unrolled straight line (the true geodesic)', () => {
    const L = polylineLength(g.path(pos, corner(m, 0), corner(m, 8 * around + around / 2)));
    const unrolled = Math.hypot((around / 2) * chord, h);
    expect(L).toBeGreaterThanOrEqual(unrolled - 1e-9);
    expect(L).toBeLessThan(unrolled * 1.02);
  });
  it('does not shortcut through the open end: the path never leaves the mesh height range', () => {
    const p = g.path(pos, corner(m, 0), corner(m, 4 * around + 5));
    for (let i = 1; i < p.length; i += 3) {
      expect(p[i]).toBeGreaterThanOrEqual(-1e-9);
      expect(p[i]).toBeLessThanOrEqual(h + 1e-9);
    }
  });
  it('is recomputed from the new positions when the body changes', () => {
    const wide: Mesh = { ...m, positions: m.positions.map((x, i) => (i % 3 === 1 ? x : x * 2)) };
    const [a, b] = [corner(m, 0), corner(m, around / 2)];
    expect(polylineLength(g.path(wide.positions, a, b))).toBeCloseTo(2 * polylineLength(g.path(pos, a, b)), 6);
  });
});

describe('SurfaceGraph.seamPath', () => {
  const m = grid(4);
  const g = graphOf(m);
  const pts = [0, 4, 24, 20].map((v) => corner(m, v)); // the four corners of the unit square, counter-clockwise
  it('joins the control points in order', () => {
    const open: Seam = { points: pts, closed: false };
    expect(polylineLength(g.seamPath(m.positions, open))).toBeCloseTo(3, 9);
  });
  it('a closed seam returns to its first point', () => {
    const closed: Seam = { points: pts, closed: true };
    const path = g.seamPath(m.positions, closed);
    expect(polylineLength(path)).toBeCloseTo(4, 9);
    expect(path.slice(0, 3)).toEqual(path.slice(-3));
  });
  it('does not repeat the point where two legs meet', () => {
    const path = g.seamPath(m.positions, { points: pts.slice(0, 3), closed: false });
    for (let i = 3; i < path.length; i += 3) expect(Math.hypot(path[i] - path[i - 3], path[i + 1] - path[i - 2], path[i + 2] - path[i - 1])).toBeGreaterThan(0);
  });
  it('a closed seam of two points is not doubled back (it needs three to enclose anything)', () => {
    const path = g.seamPath(m.positions, { points: pts.slice(0, 2), closed: true });
    expect(polylineLength(path)).toBeCloseTo(1, 9);
  });
  it('a single control point is that point', () => {
    expect(g.seamPath(m.positions, { points: [pts[1]], closed: false })).toEqual([1, 0, 0]);
  });
  it('no control points give an empty path', () => {
    expect(g.seamPath(m.positions, { points: [], closed: false })).toEqual([]);
  });
});

describe('polylineLength', () => {
  it('sums the segments', () => {
    expect(polylineLength([0, 0, 0, 3, 4, 0, 3, 4, 12])).toBe(17);
  });
  it('is zero for none or one point', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([1, 2, 3])).toBe(0);
  });
});

describe('Heap', () => {
  it('pops keys in ascending order whatever the insertion order', () => {
    const h = new Heap();
    const keys = [5, 3, 9, 1, 7, 3, 8, 2, 6, 4, 0, 10, 3];
    keys.forEach((k, i) => h.push(k, 100 + i));
    expect(h.size).toBe(keys.length);
    expect(h.peekKey()).toBe(0);
    const popped: number[] = [];
    while (h.size > 0) popped.push(h.pop()[0]);
    expect(popped).toEqual([...keys].sort((a, b) => a - b));
  });
  it('returns each key with its own node', () => {
    const h = new Heap();
    for (const [k, n] of [[4, 40], [2, 20], [3, 30], [1, 10], [5, 50]]) h.push(k, n);
    expect([h.pop(), h.pop(), h.pop(), h.pop(), h.pop()]).toEqual([[1, 10], [2, 20], [3, 30], [4, 40], [5, 50]]);
  });
  it('works when interleaving pushes and pops, and with one element', () => {
    const h = new Heap();
    h.push(2, 2);
    expect(h.pop()).toEqual([2, 2]);
    expect(h.size).toBe(0);
    h.push(5, 5); h.push(1, 1); h.push(3, 3);
    expect(h.pop()).toEqual([1, 1]);
    h.push(0, 0); h.push(4, 4);
    expect([h.pop()[0], h.pop()[0], h.pop()[0], h.pop()[0]]).toEqual([0, 3, 4, 5]);
  });
});

describe('raycast on a single tilted triangle', () => {
  // Corners (0,0,0), (2,0,2), (0,2,2): not axis aligned, so a wrong edge vector or sign shows.
  const tri: Mesh = { positions: Float64Array.from([0, 0, 0, 2, 0, 2, 0, 2, 2]), triangles: Uint32Array.from([0, 1, 2]) };
  it('gives exact distance and barycentric weights for an oblique ray', () => {
    // Target = 0.5*A + 0.25*B + 0.25*C = (0.5, 0.5, 1). Ray from (2.5, 2.5, 4) along (-2, -2, -3) / norm.
    const dir: Vec3 = [-2, -2, -3];
    const hit = raycast(tri, [2.5, 2.5, 4], dir)!;
    expect(hit.t).toBeCloseTo(1, 12);
    expect(hit.bary[0]).toBeCloseTo(0.5, 12);
    expect(hit.bary[1]).toBeCloseTo(0.25, 12);
    expect(hit.bary[2]).toBeCloseTo(0.25, 12);
  });
  it('misses on each of the three sides', () => {
    expect(raycast(tri, [-0.2, 0.5, 5], [0, 0, -1])).toBeUndefined(); // beyond the edge A-C
    expect(raycast(tri, [0.5, -0.2, 5], [0, 0, -1])).toBeUndefined(); // beyond the edge A-B
    expect(raycast(tri, [1.5, 1.5, 5], [0, 0, -1])).toBeUndefined(); // beyond the edge B-C
  });
  it('does not hit a surface behind the origin', () => {
    expect(raycast(tri, [0.5, 0.5, -5], [0, 0, -1])).toBeUndefined();
  });
});

describe('SurfaceGraph.path through a shared vertex', () => {
  // Two triangles that touch only at vertex 0: the only way from one to the other is through it.
  const bow: Mesh = {
    positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0]),
    triangles: Uint32Array.from([0, 1, 2, 0, 3, 4]),
  };
  it('includes vertex 0 itself', () => {
    const g = graphOf(bow);
    const a: SurfacePoint = { tri: 0, bary: [0.2, 0.4, 0.4] }; // (0.4, 0.4, 0)
    const b: SurfacePoint = { tri: 1, bary: [0.2, 0.4, 0.4] }; // (-0.4, -0.4, 0)
    const p = g.path(bow.positions, a, b);
    expect(polylineLength(p)).toBeCloseTo(2 * Math.hypot(0.4, 0.4), 9);
    expect(p).toContain(0);
    expect(p.length).toBe(9);
  });
});

describe('closestSurfacePoint', () => {
  const m = grid(1, 2); // triangle 0 = (0,0) (2,0) (2,2); triangle 1 = (0,0) (2,2) (0,2)
  it('projects a point above the surface straight down, and reports the height', () => {
    const c = closestSurfacePoint(m, [1.5, 0.5, 3]);
    expect(c.tri).toBe(0);
    expect(c.distance).toBeCloseTo(3, 12);
    const q = pointOnSurface(m, c);
    expect(q[0]).toBeCloseTo(1.5, 12);
    expect(q[1]).toBeCloseTo(0.5, 12);
    expect(q[2]).toBeCloseTo(0, 12);
  });
  it('works from below too', () => {
    const c = closestSurfacePoint(m, [0.5, 1.5, -2]);
    expect(c.tri).toBe(1);
    expect(c.distance).toBeCloseTo(2, 12);
  });
  it('clamps to the nearest edge and corner when the point is off the mesh', () => {
    const edge = closestSurfacePoint(m, [1, -1, 0]); // below the bottom edge
    expect(pointOnSurface(m, edge)).toEqual([1, 0, 0]);
    expect(edge.distance).toBeCloseTo(1, 12);
    const corner = closestSurfacePoint(m, [5, 6, 0]);
    expect(pointOnSurface(m, corner)).toEqual([2, 2, 0]);
    expect(corner.distance).toBeCloseTo(5, 12);
    const origin = closestSurfacePoint(m, [-3, -4, 0]);
    expect(pointOnSurface(m, origin)).toEqual([0, 0, 0]);
    expect(origin.distance).toBeCloseTo(5, 12);
  });
  it('clamps to the other edges of a triangle (the diagonal and the right-hand side)', () => {
    const diag = closestSurfacePoint(m, [1.5, 0.5, 0]); // inside triangle 0, near the diagonal x = y
    expect(diag.distance).toBeCloseTo(0, 12);
    const side = closestSurfacePoint(m, [3, 1, 0]);
    expect(pointOnSurface(m, side)).toEqual([2, 1, 0]);
    expect(side.distance).toBeCloseTo(1, 12);
    const top = closestSurfacePoint(m, [1, 3, 0]);
    expect(pointOnSurface(m, top)).toEqual([1, 2, 0]);
  });
  it('picks the nearer of two surfaces', () => {
    const two: Mesh = {
      positions: Float64Array.from([0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 5, 4, 0, 5, 0, 4, 5]),
      triangles: Uint32Array.from([0, 1, 2, 3, 4, 5]),
    };
    expect(closestSurfacePoint(two, [1, 1, 4]).tri).toBe(1);
    expect(closestSurfacePoint(two, [1, 1, 1]).tri).toBe(0);
  });
  it('refuses an empty mesh', () => {
    expect(() => closestSurfacePoint({ positions: new Float64Array(0), triangles: new Uint32Array(0) }, [0, 0, 0])).toThrow();
  });
});

describe('snapPoint', () => {
  const m = grid(2, 2); // 1 cm squares
  const mid: SurfacePoint = raycast(m, [0.62, 0.55, 3], [0, 0, -1])!; // near the centre of the 2 x 2 patch, away from every vertex
  const neck: SnapTarget = { name: 'neck point', point: [0.8, 0.5, 0.4] }; // 0.4 above the surface
  it('reuses the exact surface point of a seam point target, so two seams hold the same point', () => {
    const other: SurfacePoint = { tri: mid.tri, bary: [0.2, 0.3, 0.5] };
    const r = snapPoint(m, mid, [{ name: 'seam 1 point 1', point: pointOnSurface(m, other), surface: other }], Infinity);
    expect(r.point).toEqual(other);
    expect(r.point).not.toBe(other);
  });
  it('snaps to a landmark within the radius, landing on the surface under it', () => {
    const r = snapPoint(m, mid, [neck], 0.5);
    expect(r.target).toBe('neck point');
    const q = pointOnSurface(m, r.point);
    expect(q[0]).toBeCloseTo(0.8, 12);
    expect(q[1]).toBeCloseTo(0.5, 12);
    expect(q[2]).toBeCloseTo(0, 12);
  });
  it('leaves the point alone beyond the radius', () => {
    const r = snapPoint(m, mid, [neck], 0.1, 0.05);
    expect(r.target).toBeUndefined();
    expect(r.point).toBe(mid);
  });
  it('picks the nearest of several landmarks', () => {
    const near: SnapTarget = { name: 'near', point: [0.6, 0.5, 0] };
    const r = snapPoint(m, mid, [neck, near], 0.5);
    expect(r.target).toBe('near');
  });
  it('prefers a landmark to a vertex that is also in range', () => {
    const nearVertex = vertexPoint(m, 4);
    const t: SnapTarget = { name: 'lm', point: [1.1, 1, 0] };
    expect(snapPoint(m, nearVertex, [t], 0.5).target).toBe('lm');
  });
  it('falls back to a vertex within the vertex radius, and uses the target radius only for targets', () => {
    const nearCorner = raycast(m, [1.02, 0.99, 3], [0, 0, -1])!; // 0.03 from the centre vertex (1, 1)
    const r = snapPoint(m, nearCorner, [], 0.05, 0.1);
    expect(r.target).toBeUndefined();
    expect(pointOnSurface(m, r.point)).toEqual([1, 1, 0]);
    const far = snapPoint(m, nearCorner, [], 0.5, 0.01);
    expect(far.point).toBe(nearCorner);
  });
  it('snaps when the distance is exactly the radius', () => {
    const t: SnapTarget = { name: 'edge', point: [mid.bary[0] * 0 + pointOnSurface(m, mid)[0] + 0.25, pointOnSurface(m, mid)[1], 0] };
    expect(snapPoint(m, mid, [t], 0.25).target).toBe('edge');
  });
});

describe('findControlPoint', () => {
  const m = grid(2, 2);
  const near = (at: Vec3) => (p: Vec3) => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
  const seams: Seam[] = [
    { points: [vertexPoint(m, 0), vertexPoint(m, 4)], closed: false },
    { points: [vertexPoint(m, 8), vertexPoint(m, 5)], closed: false },
  ];
  it('finds the control point under a position, with its seam and index', () => {
    expect(findControlPoint(m, seams, near([1.05, 1, 0]), 0.2)).toEqual({ seam: 0, index: 1 });
    expect(findControlPoint(m, seams, near([2, 2, 0.1]), 0.2)).toEqual({ seam: 1, index: 0 });
    expect(findControlPoint(m, seams, near([2, 1, 0]), 0.2)).toEqual({ seam: 1, index: 1 });
  });
  it('returns nothing outside the radius, and nothing when there are no seams', () => {
    expect(findControlPoint(m, seams, near([0.5, 1.5, 0]), 0.2)).toBeUndefined();
    expect(findControlPoint(m, [], near([0, 0, 0]), 5)).toBeUndefined();
  });
  it('uses whatever distance the caller supplies (the viewer passes screen distance)', () => {
    expect(findControlPoint(m, seams, (p) => Math.abs(p[1] - 2), 0.1)).toEqual({ seam: 1, index: 0 });
  });
  it('picks the nearest when several are in range, and accepts exactly the radius', () => {
    expect(findControlPoint(m, seams, near([1.4, 1, 0]), 5)).toEqual({ seam: 0, index: 1 });
    expect(findControlPoint(m, seams, near([0, 0.5, 0]), 0.5)).toEqual({ seam: 0, index: 0 });
  });
});

describe('closestBary', () => {
  const A: Vec3 = [0, 0, 0];
  const B: Vec3 = [4, 0, 0];
  const C: Vec3 = [0, 4, 0];
  it('gives the exact weights in each of the seven regions of a right triangle', () => {
    const cases: [Vec3, Vec3][] = [
      [[-1, -1, 0], [1, 0, 0]], // corner A
      [[6, -1, 0], [0, 1, 0]], // corner B
      [[-1, 6, 0], [0, 0, 1]], // corner C
      [[1, -2, 0], [0.75, 0.25, 0]], // edge AB
      [[-2, 3, 0], [0.25, 0, 0.75]], // edge AC
      [[5, 2, 0], [0, 0.875, 0.125]], // edge BC
      [[1, 1, 2], [0.5, 0.25, 0.25]], // inside, above the plane
      [[1, 1, -3], [0.5, 0.25, 0.25]], // inside, below it
    ];
    for (const [p, want] of cases) closestBary(p, A, B, C).forEach((v, i) => expect(v).toBeCloseTo(want[i], 12));
  });
  it('is on the boundary exactly where the point projects onto it', () => {
    expect(closestBary([4, 0, 0], A, B, C)).toEqual([0, 1, 0]); // a corner itself
    expect(closestBary([0, 0, 0], A, B, C)).toEqual([1, 0, 0]);
    expect(closestBary([2, 0, 5], A, B, C)).toEqual([0.5, 0.5, 0]); // above the middle of AB
  });
  // Oblique triangles, where the dot products of the edges are not zero and a wrong term shows up.
  const triangles: [Vec3, Vec3, Vec3][] = [
    [[0, 0, 0], [4, 0, 0], [1, 3, 0]],
    [[0, 0, 0], [5, 1, 0], [4, 4, 1]],
    [[1, 2, 3], [4, 1, 0], [2, 6, 1]],
  ];
  const at = (t: [Vec3, Vec3, Vec3], w: Vec3): Vec3 => [0, 1, 2].map((k) => w[0] * t[0][k] + w[1] * t[1][k] + w[2] * t[2][k]) as Vec3;
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  it('finds the closest point of the triangle (checked against a brute-force search) for points all around it', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (const t of triangles) {
      for (let n = 0; n < 60; n++) {
        const p: Vec3 = [rnd() * 14 - 5, rnd() * 14 - 5, rnd() * 8 - 3];
        const w = closestBary(p, ...t);
        expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 12);
        for (const x of w) expect(x).toBeGreaterThanOrEqual(-1e-12);
        let best = Infinity;
        const N = 120;
        for (let i = 0; i <= N; i++) for (let j = 0; i + j <= N; j++) best = Math.min(best, dist(p, at(t, [1 - (i + j) / N, i / N, j / N])));
        const got = dist(p, at(t, w));
        expect(got).toBeLessThanOrEqual(best + 1e-9); // never worse than the grid
        expect(got).toBeGreaterThan(best - 0.2); // and the grid (spacing ~ 0.05) cannot be far better: it is exact
      }
    }
  });
});

describe('closestSurfacePoint on several triangles', () => {
  it('uses the strict nearest (a later triangle at equal distance does not replace the first)', () => {
    const m: Mesh = { positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]), triangles: Uint32Array.from([0, 1, 2, 3, 4, 5]) };
    const c = closestSurfacePoint(m, [0.2, 0.2, 0.5]);
    expect(c.tri).toBe(0); // 0.5 below, and 0.5 above triangle 1
    expect(c.distance).toBeCloseTo(0.5, 12);
  });
});

describe('SurfaceGraph.path is a straight line over the surface', () => {
  const pathLength = (m: Mesh, a: SurfacePoint, b: SurfacePoint) => polylineLength(graphOf(m).path(m.positions, a, b));
  const at = (m: Mesh, x: number, y: number) => raycast(m, [x, y, 5], [0, 0, -1])!;

  it('on a flat grid it has exactly the straight-line length, in any direction', () => {
    const m = grid(8, 8);
    for (const [x0, y0, x1, y1] of [[0.3, 0.4, 7.6, 6.9], [7.5, 0.6, 0.4, 7.4], [0.5, 4.2, 7.7, 4.9], [3.3, 0.2, 4.1, 7.9], [1.1, 1.3, 6.3, 1.3]]) {
      expect(pathLength(m, at(m, x0, y0), at(m, x1, y1))).toBeCloseTo(Math.hypot(x1 - x0, y1 - y0), 9);
    }
  });
  it('is the same for the mirror image of a point pair on a mirror-symmetric mesh', () => {
    // A grid whose diagonals mirror each other about x = 4 (the left half cut one way, the right half the other).
    const n = 8;
    const positions: number[] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push(i, j, 0);
    const id = (i: number, j: number) => j * (n + 1) + i;
    const tris: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (i < n / 2) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
      else tris.push(id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
    }
    const m: Mesh = { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
    const left = pathLength(m, at(m, 0.7, 0.6), at(m, 3.4, 7.3));
    const right = pathLength(m, at(m, 8 - 0.7, 0.6), at(m, 8 - 3.4, 7.3));
    expect(left).toBeCloseTo(right, 9);
    expect(left).toBeCloseTo(Math.hypot(2.7, 6.7), 9);
  });
  it('on a faceted tube it is the straight line of the unrolled surface', () => {
    const around = 24;
    const r = 5;
    const m = tube(around, 8, r, 16); // 2 cm bands, chord 2 r sin(pi / 24)
    const chord = 2 * r * Math.sin(Math.PI / around);
    // Points at the middle of a facet: take the barycentre of a triangle pair and measure over the unrolled strip.
    const a: SurfacePoint = { tri: 2 * (2 * around + 3), bary: [0.2, 0.3, 0.5] }; // band 2, facet 3
    const b: SurfacePoint = { tri: 2 * (6 * around + 9), bary: [0.4, 0.4, 0.2] }; // band 6, facet 9
    const [pa, pb] = [pointOnSurface(m, a), pointOnSurface(m, b)];
    // Unrolled coordinates: x = distance along the polygon, y = height.
    const unroll = (p: Vec3, tri: number) => {
      const facet = (tri / 2) % around;
      const x0 = facet * chord;
      const c0 = m.positions.slice(3 * facet, 3 * facet + 3); // bottom-left corner of this facet column, band 0
      const c1 = m.positions.slice(3 * ((facet + 1) % around), 3 * ((facet + 1) % around) + 3);
      const along = Math.hypot(p[0] - c0[0], p[2] - c0[2]) / Math.hypot(c1[0] - c0[0], c1[2] - c0[2]);
      return [x0 + along * chord, p[1]];
    };
    const [ua, ub] = [unroll(pa, a.tri), unroll(pb, b.tri)];
    expect(pathLength(m, a, b)).toBeCloseTo(Math.hypot(ub[0] - ua[0], ub[1] - ua[1]), 8);
  });
  it('is never shorter than the straight line through space', () => {
    const m = tube(24, 8, 5, 16);
    const a: SurfacePoint = { tri: 7, bary: [0.3, 0.3, 0.4] };
    const b: SurfacePoint = { tri: 2 * (5 * 24 + 15) + 1, bary: [0.3, 0.3, 0.4] };
    const [pa, pb] = [pointOnSurface(m, a), pointOnSurface(m, b)];
    expect(pathLength(m, a, b)).toBeGreaterThanOrEqual(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) - 1e-9);
  });
  it('pathNodes lists the start, the crossings in order, and the end', () => {
    const m = grid(4, 4);
    const nodes = graphOf(m).pathNodes(m.positions, at(m, 0.3, 0.4), at(m, 3.6, 3.1));
    expect(nodes[0].kind).toBe('face');
    expect(nodes[nodes.length - 1].kind).toBe('face');
    expect(nodes.length).toBeGreaterThan(4);
    for (const n of nodes.slice(1, -1)) {
      if (n.kind === 'edge') { expect(n.a).toBeLessThan(n.b); expect(n.t).toBeGreaterThanOrEqual(0); expect(n.t).toBeLessThanOrEqual(1); }
    }
  });
});

describe('seamLegs', () => {
  const m = grid(6, 6);
  const g = graphOf(m);
  const at = (x: number, y: number) => raycast(m, [x, y, 5], [0, 0, -1])!;
  it('has one polyline per leg, joined end to end, and closed seams have the leg back to the start', () => {
    const open: Seam = { points: [at(0.5, 0.5), at(3, 1.2), at(5.5, 4.4)], closed: false };
    const legs = g.seamLegs(m.positions, open);
    expect(legs).toHaveLength(2);
    expect(legs[0].slice(-3)).toEqual(legs[1].slice(0, 3));
    expect(legs.flat().length).toBe(legs[0].length + legs[1].length);
    expect(g.seamLegs(m.positions, { points: open.points, closed: true })).toHaveLength(3);
    expect(g.seamLegs(m.positions, { points: open.points.slice(0, 2), closed: true })).toHaveLength(1); // two points do not enclose anything
    expect(g.seamLegs(m.positions, { points: [open.points[0]], closed: false })).toEqual([]);
  });
  it('seamPath is the legs without the repeated joins', () => {
    const s: Seam = { points: [at(0.5, 0.5), at(3, 1.2), at(5.5, 4.4)], closed: false };
    const legs = g.seamLegs(m.positions, s);
    expect(g.seamPath(m.positions, s)).toEqual([...legs[0], ...legs[1].slice(3)]);
  });
});

describe('nearestOnSeams and insertControlPoint', () => {
  const m = grid(6, 6);
  const g = graphOf(m);
  const at = (x: number, y: number) => raycast(m, [x, y, 5], [0, 0, -1])!;
  const seams: Seam[] = [
    { points: [at(0.4, 2), at(3, 2), at(5.6, 2)], closed: false },
    { points: [at(0.4, 4.5), at(5.6, 4.5)], closed: false },
  ];
  const legs = seams.map((q) => g.seamLegs(m.positions, q));
  const near = (x: number, y: number) => (p: Vec3) => Math.hypot(p[0] - x, p[1] - y, p[2]);

  it('finds the nearest point on a seam path, and which leg it is on', () => {
    const hit = nearestOnSeams(legs, near(1.4, 2.3), 1)!;
    expect(hit.seam).toBe(0);
    expect(hit.leg).toBe(0);
    expect(hit.at[0]).toBeCloseTo(1.4, 3);
    expect(hit.at[1]).toBeCloseTo(2, 3);
    expect(hit.distance).toBeCloseTo(0.3, 3);
    expect(nearestOnSeams(legs, near(4.5, 2.1), 1)!.leg).toBe(1);
    expect(nearestOnSeams(legs, near(2.2, 4.4), 1)!.seam).toBe(1);
  });
  it('returns nothing beyond the radius, and can skip a seam', () => {
    expect(nearestOnSeams(legs, near(3, 3.2), 0.5)).toBeUndefined();
    expect(nearestOnSeams(legs, near(1.4, 2.3), 1, 0)).toBeUndefined();
    expect(nearestOnSeams(legs, near(1.4, 2.3), 3, 0)!.seam).toBe(1);
  });
  it('takes the distance the caller gives (not space)', () => {
    const byX = (p: Vec3) => Math.abs(p[0] - 4.8);
    expect(nearestOnSeams(legs, byX, 0.01)!.at[0]).toBeCloseTo(4.8, 3);
  });
  it('inserting a control point puts it in the right place in the list and keeps the path the same length', () => {
    const seam: Seam = { points: [...seams[0].points], closed: false };
    const before = polylineLength(g.seamPath(m.positions, seam));
    const p = insertControlPoint(m, seam, 0, [1.4, 2, 0]);
    expect(seam.points).toHaveLength(4);
    expect(seam.points[1]).toBe(p);
    expect(pointOnSurface(m, p)[0]).toBeCloseTo(1.4, 9);
    expect(polylineLength(g.seamPath(m.positions, seam))).toBeCloseTo(before, 9);
  });
  it('on a closed seam the last leg inserts at the end', () => {
    const seam: Seam = { points: [at(1, 1), at(5, 1), at(3, 5)], closed: true };
    const last = g.seamLegs(m.positions, seam).length - 1;
    const p = insertControlPoint(m, seam, last, [2, 3, 0]);
    expect(seam.points[3]).toBe(p);
    expect(seam.points).toHaveLength(4);
  });
});

describe('nearestOnSeams on hand-made legs', () => {
  const dist3 = (target: Vec3) => (p: Vec3) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
  it('finds the closest point on a slanted 3D segment in all three coordinates', () => {
    const legs = [[[0, 0, 0, 4, 3, 12]]]; // one seam, one leg, one segment of length 13
    const P: Vec3 = [3, 4, 5];
    const d = [4, 3, 12];
    const t = (P[0] * d[0] + P[1] * d[1] + P[2] * d[2]) / (d[0] ** 2 + d[1] ** 2 + d[2] ** 2);
    const hit = nearestOnSeams(legs, dist3(P), 20)!;
    expect(hit.at[0]).toBeCloseTo(t * 4, 6);
    expect(hit.at[1]).toBeCloseTo(t * 3, 6);
    expect(hit.at[2]).toBeCloseTo(t * 12, 6);
    expect(hit.distance).toBeCloseTo(Math.hypot(P[0] - hit.at[0], P[1] - hit.at[1], P[2] - hit.at[2]), 9);
  });
  it('finds a narrow window of nearness on a long segment (a metric that is infinite where the seam is hidden)', () => {
    const legs = [[[0, 0, 0, 6, 0, 0]]];
    const visibleOnly = (p: Vec3) => (p[0] >= 4.0 && p[0] <= 4.6 ? Math.abs(p[0] - 4.3) : Infinity);
    const hit = nearestOnSeams(legs, visibleOnly, 1)!;
    expect(hit.at[0]).toBeCloseTo(4.3, 4);
  });
  it('compares segments of one leg and legs of one seam: the nearest wins wherever it is', () => {
    const legs = [[[0, 0, 0, 2, 0, 0, 2, 2, 0], [2, 2, 0, 5, 2, 0]], [[0, 5, 0, 5, 5, 0]]];
    expect(nearestOnSeams(legs, dist3([1, 0.2, 0]), 1)).toMatchObject({ seam: 0, leg: 0 });
    expect(nearestOnSeams(legs, dist3([2.2, 1.5, 0]), 1)).toMatchObject({ seam: 0, leg: 0 });
    expect(nearestOnSeams(legs, dist3([4, 2.1, 0]), 1)).toMatchObject({ seam: 0, leg: 1 });
    expect(nearestOnSeams(legs, dist3([3, 4.6, 0]), 1)).toMatchObject({ seam: 1, leg: 0 });
  });
  it('accepts a distance exactly equal to the radius, and keeps the first of two equally near places', () => {
    const legs = [[[0, 0, 0, 1, 0, 0]], [[0, 0, 0, 1, 0, 0]]];
    expect(nearestOnSeams(legs, () => 0.25, 0.25)).toMatchObject({ seam: 0 });
    expect(nearestOnSeams(legs, () => 0.25, 0.2499)).toBeUndefined();
  });
  it('a segment shorter than the sampling step is still searched, including its end', () => {
    const legs = [[[0, 0, 0, 0.1, 0, 0]]];
    expect(nearestOnSeams(legs, (p) => Math.abs(p[0] - 0.1), 1)!.at[0]).toBeCloseTo(0.1, 6);
    expect(nearestOnSeams(legs, (p) => Math.abs(p[0] - 0), 1)!.at[0]).toBeCloseTo(0, 6);
  });
});
