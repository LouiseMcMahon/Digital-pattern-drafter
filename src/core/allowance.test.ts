import { describe, expect, it } from 'vitest';
import { MITER_LIMIT, type Pt, offsetOutline, signedArea } from './allowance';

const square = (s: number): Pt[] => [[0, 0], [s, 0], [s, s], [0, s]]; // anticlockwise
const reversed = (p: Pt[]) => [...p].reverse();
const hexagon = (apothem: number): Pt[] => {
  const r = apothem / Math.cos(Math.PI / 6);
  return Array.from({ length: 6 }, (_, i) => [r * Math.cos((Math.PI / 3) * i), r * Math.sin((Math.PI / 3) * i)] as Pt);
};
const bounds = (p: Pt[]) => ({ x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) });
/**
 * A piece with one corner of interior angle `deg` at the origin, bisected by the +x axis; its other corners are 90 degrees or
 * wide (180 - deg / 2), so only the origin is near the miter limit. Anticlockwise, the origin first.
 */
const wedge = (deg: number): Pt[] => {
  const [a, b] = [10, 10 * Math.tan((deg * Math.PI) / 360)];
  return [[0, 0], [a, -b], [a + 20, -b], [a + 20, b], [a, b]];
};

describe('signedArea', () => {
  it('is positive anticlockwise and negative clockwise', () => {
    expect(signedArea(square(4))).toBe(16);
    expect(signedArea(reversed(square(4)))).toBe(-16);
  });
  it('is 0 for fewer than three points or a flat line', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([[1, 1]])).toBe(0);
    expect(signedArea([[0, 0], [5, 5]])).toBe(0);
    expect(signedArea([[0, 0], [1, 1], [2, 2]])).toBe(0);
  });
  it('does not depend on where the polygon is', () => {
    expect(signedArea(square(4).map(([x, y]) => [x + 100, y - 50] as Pt))).toBeCloseTo(16, 9);
  });
});

describe('offsetOutline', () => {
  it('moves a square out by the allowance on every side', () => {
    const o = offsetOutline(square(10), 1);
    expect(o).toHaveLength(4);
    expect(bounds(o)).toEqual({ x0: -1, x1: 11, y0: -1, y1: 11 });
    expect(signedArea(o)).toBeCloseTo(144, 9);
    expect(o[0]).toEqual([-1, -1]); // corners stay in order and are mitred
  });
  it('does the same whichever way round the outline runs', () => {
    const o = offsetOutline(reversed(square(10)), 1);
    expect(bounds(o)).toEqual({ x0: -1, x1: 11, y0: -1, y1: 11 });
    expect(Math.abs(signedArea(o))).toBeCloseTo(144, 9);
    expect(signedArea(o)).toBeLessThan(0); // and keeps its direction
  });
  it('a negative distance moves it in', () => {
    const o = offsetOutline(square(10), -1.5);
    expect(bounds(o)).toEqual({ x0: 1.5, x1: 8.5, y0: 1.5, y1: 8.5 });
    expect(bounds(offsetOutline(reversed(square(10)), -1.5))).toEqual({ x0: 1.5, x1: 8.5, y0: 1.5, y1: 8.5 });
  });
  it('a distance of 0 gives the same outline', () => {
    const o = offsetOutline(square(10), 0);
    o.forEach((q, i) => { expect(q[0]).toBeCloseTo(square(10)[i][0], 12); expect(q[1]).toBeCloseTo(square(10)[i][1], 12); });
  });
  it('scales a regular polygon by (apothem + d) / apothem', () => {
    const o = offsetOutline(hexagon(5), 1);
    expect(o).toHaveLength(6);
    expect(signedArea(o) / signedArea(hexagon(5))).toBeCloseTo(1.44, 9);
  });
  it('keeps each offset edge parallel to the original, a distance d outside it', () => {
    const base = [[0, 0], [8, 1], [9, 7], [3, 9], [-1, 4]] as Pt[];
    const d = 0.75;
    const o = offsetOutline(base, d);
    expect(o).toHaveLength(base.length);
    for (let i = 0; i < base.length; i++) {
      const [a, b] = [base[i], base[(i + 1) % base.length]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const q of [o[i], o[(i + 1) % o.length]]) { // both ends of the offset edge are d from the original edge's line, on the outside
        const dist = ((b[1] - a[1]) * (q[0] - a[0]) - (b[0] - a[0]) * (q[1] - a[1])) / l; // signed: positive left of travel
        expect(dist).toBeCloseTo(d, 9); // positive is to the right of travel, which is outside for an anticlockwise outline
      }
    }
  });
  it('mitres a corner of 90 degrees and bevels one that is sharper than the miter limit allows', () => {
    expect(offsetOutline(wedge(90), 1)).toHaveLength(5);
    expect(MITER_LIMIT).toBe(2);
    const sharp = offsetOutline(wedge(40), 1); // 1 / sin(20 deg) = 2.9: cut off
    expect(sharp).toHaveLength(6);
    // the two bevel points are each exactly d from the corner, on the normals of the two edges
    const [p, q] = [sharp[0], sharp[1]];
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 9);
    expect(Math.hypot(q[0], q[1])).toBeCloseTo(1, 9);
    expect(p[0]).toBeCloseTo(q[0], 9); expect(p[1] * q[1]).toBeLessThan(0); // mirror images about the bisector, not one point
  });
  it('a corner just inside the limit is mitred and just outside is not', () => {
    // 1 / sin(half) = 2 at 60 degrees; 2.0 limit. 61 degrees: factor 1.97 (mitre); 59 degrees: 2.03 (bevel).
    expect(offsetOutline(wedge(61), 1)).toHaveLength(5);
    expect(offsetOutline(wedge(59), 1)).toHaveLength(6);
  });
  it('places a mitred sharp-ish corner on the bisector, 1 / sin(half-angle) away', () => {
    const o = offsetOutline(wedge(90), 1);
    expect(o[0][0]).toBeCloseTo(-Math.SQRT2, 9); // 1 / sin(45 deg) back along the bisector (the x axis)
    expect(o[0][1]).toBeCloseTo(0, 9);
    const w = offsetOutline(wedge(60.5), 1);
    expect(w[0][0]).toBeCloseTo(-1 / Math.sin((30.25 * Math.PI) / 180), 9);
  });
  it('handles a reflex (inward) corner of an L shape by pulling it the other way', () => {
    const L: Pt[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    const o = offsetOutline(L, 1);
    expect(o).toHaveLength(6);
    expect(o[3][0]).toBeCloseTo(5, 9); // the inside corner at (4, 4) moves to (5, 5): away from the solid part
    expect(o[3][1]).toBeCloseTo(5, 9);
    expect(o[0]).toEqual([-1, -1]);
    expect(signedArea(o)).toBeGreaterThan(signedArea(L));
  });
  it('drops repeated points, including a repeat of the first at the end', () => {
    const o = offsetOutline([[0, 0], [0, 0], [10, 0], [10, 10], [10, 10], [0, 10], [0, 0]], 1);
    expect(o).toHaveLength(4);
    expect(bounds(o)).toEqual({ x0: -1, x1: 11, y0: -1, y1: 11 });
  });
  it('returns a copy of what it is given when there is no area to offset', () => {
    const pts: Pt[] = [[0, 0], [1, 1]];
    const o = offsetOutline(pts, 3);
    expect(o).toEqual(pts);
    o[0][0] = 9;
    expect(pts[0][0]).toBe(0);
    expect(offsetOutline([], 1)).toEqual([]);
    expect(offsetOutline([[2, 2], [2, 2], [2, 2]], 1)).toEqual([]);
  });
  it('bevels a spike that turns back on itself instead of dividing by zero', () => {
    const o = offsetOutline([[0, 0], [10, 0], [0, 0.0000001], [-10, 0.0000001]], 1);
    for (const q of o) { expect(Number.isFinite(q[0])).toBe(true); expect(Number.isFinite(q[1])).toBe(true); }
  });
});
