import { describe, expect, it } from 'vitest';
import type { Mesh, Vec3 } from './mesh';
import { princessSeam, ringPointAtX } from './princess';
import { pointOnSurface } from './seam';

/** A circle of radius r round the y axis at height y, as xyz points; the front is +z. */
function circle(r: number, y: number, n = 64, from = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const a = from + (2 * Math.PI * i) / n; out.push(r * Math.sin(a), y, r * Math.cos(a)); }
  return out;
}

/** Open tube of radius r from y = 0 to h, many segments so it is nearly round. */
function tube(around: number, rows: number, r: number, h: number): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i < around; i++) {
    const a = (2 * Math.PI * i) / around;
    positions.push(r * Math.sin(a), (h * j) / rows, r * Math.cos(a));
  }
  const id = (i: number, j: number) => j * around + (i % around);
  const tris: number[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < around; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}

describe('ringPointAtX', () => {
  it('finds the front crossing of the plane x = 5 on a circle', () => {
    const p = ringPointAtX(circle(15, 100), 5)!;
    expect(p[0]).toBeCloseTo(5, 12);
    expect(p[1]).toBe(100);
    expect(p[2]).toBeGreaterThan(13.9); // the front is +z, so the front crossing, not the back
    expect(p[2]).toBeLessThan(14.2);
  });
  it('picks the front-most crossing whichever way round the ring is listed or where it starts', () => {
    const forward = ringPointAtX(circle(15, 100, 64, 0), -7)!;
    const c = circle(15, 100, 64, 0.3); // starts elsewhere, then listed the other way round
    const reversedRing: number[] = [];
    for (let i = c.length - 3; i >= 0; i -= 3) reversedRing.push(c[i], c[i + 1], c[i + 2]);
    const backward = ringPointAtX(reversedRing, -7)!;
    for (const p of [forward, backward]) {
      expect(p[0]).toBeCloseTo(-7, 12);
      expect(p[2]).toBeGreaterThan(13);
    }
  });
  it('interpolates between ring points (a ring of four corners)', () => {
    const square = [-10, 50, -10, 10, 50, -10, 10, 50, 10, -10, 50, 10];
    const p = ringPointAtX(square, 2)!;
    expect(p).toEqual([2, 50, 10]);
  });
  it('interpolates height and depth along a slanted edge, using the exact fraction', () => {
    const ring = [0, 0, 0, 10, 20, 40, 10, 20, -40]; // a triangle
    const p = ringPointAtX(ring, 2.5)!;
    expect(p[0]).toBe(2.5);
    expect(p[1]).toBeCloseTo(5, 12);
    expect(p[2]).toBeCloseTo(10, 12);
  });
  it('ignores edges that run along x = const (no single crossing)', () => {
    const ring = [5, 0, 0, 5, 0, 10, 10, 0, 10, 10, 0, 0];
    const p = ringPointAtX(ring, 5)!;
    expect(p[0]).toBe(5);
  });
  it('falls back to the front point nearest the plane when the ring never reaches it', () => {
    const p = ringPointAtX(circle(15, 100), 20)!;
    expect(p[0]).toBeGreaterThan(14.5);
    expect(p[2]).toBeGreaterThanOrEqual(-0.5); // on the front half
    const q = ringPointAtX(circle(15, 100), -20)!;
    expect(q[0]).toBeLessThan(-14.5);
  });
  it('the fallback never picks the back of the ring', () => {
    // x is far to the left of a ring whose back half has the nearer points
    const ring = [-5, 0, -9, 5, 0, -9, 5, 0, 9, 6, 0, 9];
    const p = ringPointAtX(ring, -50)!;
    expect(p[2]).toBe(9);
  });
  it('has nothing to say about an empty ring', () => {
    expect(ringPointAtX([], 3)).toBeUndefined();
    expect(ringPointAtX([1, 2], 3)).toBeUndefined();
  });
});

describe('princessSeam', () => {
  const m = tube(96, 40, 10, 40);
  const apex: Vec3 = [4, 30, Math.sqrt(100 - 16)];
  const shoulder: Vec3 = [3, 39.5, 9.5];
  const waistRing = circle(10, 20, 96);
  const hipRing = circle(10, 10, 96);

  it('runs from the shoulder over the apex, then straight down to the waist and hip lines', () => {
    const s = princessSeam(m, { shoulder, apex, waistRing, hipRing });
    expect(s.closed).toBe(false);
    expect(s.points).toHaveLength(4);
    const at = s.points.map((p) => pointOnSurface(m, p));
    const expectNear = (got: Vec3, want: Vec3, tol: number) => { for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k])).toBeLessThan(tol); };
    expectNear(at[0], shoulder, 0.1);
    expectNear(at[1], apex, 0.1);
    expectNear(at[2], [4, 20, Math.sqrt(100 - 16)], 0.1); // directly below the apex, at the waist
    expectNear(at[3], [4, 10, Math.sqrt(100 - 16)], 0.1);
  });
  it('follows the apex sideways: the other side of the body gives the mirror image', () => {
    const left = princessSeam(m, { shoulder, apex, waistRing, hipRing }).points.map((p) => pointOnSurface(m, p));
    const right = princessSeam(m, { shoulder: [-3, 39.5, 9.5], apex: [-4, 30, apex[2]], waistRing, hipRing }).points.map((p) => pointOnSurface(m, p));
    for (let i = 0; i < 4; i++) {
      expect(right[i][0]).toBeCloseTo(-left[i][0], 1);
      expect(right[i][1]).toBeCloseTo(left[i][1], 1);
      expect(right[i][2]).toBeCloseTo(left[i][2], 1);
    }
  });
  it('needs the waist and the hip lines', () => {
    expect(() => princessSeam(m, { shoulder, apex, waistRing: [], hipRing })).toThrow(/waist and hip lines/);
    expect(() => princessSeam(m, { shoulder, apex, waistRing, hipRing: [] })).toThrow(/waist and hip lines/);
  });
});
