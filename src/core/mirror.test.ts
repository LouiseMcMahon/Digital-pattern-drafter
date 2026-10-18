import { describe, expect, it } from 'vitest';
import { CENTRE_TOLERANCE, mirrorPoint, mirrorSeam } from './mirror';
import type { Mesh } from './mesh';
import { type Seam, type SurfacePoint, SurfaceGraph, pointOnSurface, polylineLength, raycast } from './seam';

/** A bump z = 4 - x^2/4 - y^2/9 over x in [-4, 4], y in [0, 6]: symmetric about x = 0, with the diagonals all running one way (so the mesh itself is not symmetric). */
function bump(n = 16): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -4 + (8 * i) / n;
    const y = (6 * j) / n;
    positions.push(x, y, 4 - (x * x) / 4 - (y * y) / 9);
  }
  const id = (i: number, j: number) => j * (n + 1) + i;
  const tris: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}
const m = bump();
const at = (x: number, y: number): SurfacePoint => raycast(m, [x, y, 20], [0, 0, -1])!;

describe('mirrorPoint', () => {
  it('lands on the mirror position (to within the mesh resolution) for points on either side', () => {
    for (const [x, y] of [[1.3, 0.7], [-2.2, 3.1], [3.4, 5.5], [-0.9, 2.4]]) {
      const p = pointOnSurface(m, at(x, y));
      const q = pointOnSurface(m, mirrorPoint(m, at(x, y)));
      expect(q[0]).toBeCloseTo(-p[0], 1);
      expect(q[1]).toBeCloseTo(p[1], 1);
      expect(q[2]).toBeCloseTo(p[2], 1);
    }
  });
  it('a point on the centre line is its own mirror image (returned as is)', () => {
    const p = at(0, 2.5);
    expect(mirrorPoint(m, p)).toBe(p);
    const near = at(CENTRE_TOLERANCE * 0.9, 2.5);
    expect(mirrorPoint(m, near)).toBe(near);
  });
  it('a point just beyond the tolerance is mirrored, not shared', () => {
    const p = at(CENTRE_TOLERANCE * 1.5, 2.5);
    expect(mirrorPoint(m, p)).not.toBe(p);
  });
  it('mirroring twice returns to the start', () => {
    const p = at(2.7, 4.1);
    const [a, b] = [pointOnSurface(m, p), pointOnSurface(m, mirrorPoint(m, mirrorPoint(m, p)))];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.1);
  });
  it('a point exactly at the tolerance counts as on the centre line', () => {
    const p = at(1, 2);
    expect(mirrorPoint(m, p, pointOnSurface(m, p)[0])).toBe(p);
  });
  it('honours a different tolerance', () => {
    const p = at(1, 2);
    expect(mirrorPoint(m, p, 1.5)).toBe(p);
    expect(mirrorPoint(m, p, 0.5)).not.toBe(p);
  });
});

describe('mirrorSeam', () => {
  const half: Seam = { points: [at(0, 0.4), at(2.5, 1.1), at(3, 3.4), at(1.2, 5.2), at(0, 5.6)], closed: false };
  const other = mirrorSeam(m, half);
  it('keeps the order, the number of points and the closed flag', () => {
    expect(other.points).toHaveLength(5);
    expect(other.closed).toBe(false);
    expect(mirrorSeam(m, { points: half.points, closed: true }).closed).toBe(true);
  });
  it('shares the ends on the centre line, so the two halves meet exactly', () => {
    expect(other.points[0]).toBe(half.points[0]);
    expect(other.points[4]).toBe(half.points[4]);
  });
  it('the other side is the mirror image: every control point is mirrored', () => {
    half.points.slice(1, 4).forEach((p, i) => {
      const [a, b] = [pointOnSurface(m, p), pointOnSurface(m, other.points[i + 1])];
      expect(b[0]).toBeCloseTo(-a[0], 1);
      expect(b[1]).toBeCloseTo(a[1], 1);
    });
  });
  it('both halves have the same length, however the mesh is triangulated (the paths are straight)', () => {
    const g = new SurfaceGraph(m.triangles, m.positions.length / 3);
    const [la, lb] = [polylineLength(g.seamPath(m.positions, half)), polylineLength(g.seamPath(m.positions, other))];
    expect(Math.abs(la - lb) / la).toBeLessThan(0.01);
  });
});
