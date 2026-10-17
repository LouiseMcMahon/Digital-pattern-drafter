import { describe, expect, it } from 'vitest';
import { type EaseField, scalesAt, sortedField, uniformEase } from './ease';

const field = (): EaseField => ({
  knots: [
    { y: 100, horizontal: 10, vertical: -20 },
    { y: 0, horizontal: 0, vertical: 0 },
    { y: 50, horizontal: 20, vertical: 10 },
  ],
});

describe('scalesAt', () => {
  it('is 1 + percent / 100', () => {
    expect(scalesAt(uniformEase(10, -5), 123)).toEqual({ horizontal: 1.1, vertical: 0.95 });
    expect(scalesAt(uniformEase(0, 0), 0)).toEqual({ horizontal: 1, vertical: 1 });
  });
  it('no knots means no ease', () => {
    expect(scalesAt({ knots: [] }, 5)).toEqual({ horizontal: 1, vertical: 1 });
  });
  it('is flat beyond the end knots', () => {
    const f = field();
    expect(scalesAt(f, -10)).toEqual({ horizontal: 1, vertical: 1 });
    expect(scalesAt(f, 0)).toEqual({ horizontal: 1, vertical: 1 });
    expect(scalesAt(f, 100)).toEqual({ horizontal: 1.1, vertical: 0.8 });
    expect(scalesAt(f, 500)).toEqual({ horizontal: 1.1, vertical: 0.8 });
  });
  it('hits the knot values exactly', () => {
    expect(scalesAt(field(), 50)).toEqual({ horizontal: 1.2, vertical: 1.1 });
  });
  it('blends with smoothstep: half way is the mean, a quarter is 0.15625 of the way', () => {
    // Between y=0 (0%) and y=50 (20%): t=.5 -> s=.5 ; t=.25 -> s = .0625*(3-.5) = .15625.
    expect(scalesAt(field(), 25).horizontal).toBeCloseTo(1.1, 12);
    expect(scalesAt(field(), 12.5).horizontal).toBeCloseTo(1 + (20 * 0.15625) / 100, 12);
    // Between y=50 (20%) and y=100 (10%): t=.75 -> s = .5625*(3-1.5) = .84375.
    expect(scalesAt(field(), 87.5).horizontal).toBeCloseTo(1 + (20 * (1 - 0.84375) + 10 * 0.84375) / 100, 12);
  });
  it('has zero slope at the knots (no kink)', () => {
    const f = field();
    const h = 1e-4;
    const slope = (y: number) => (scalesAt(f, y + h).horizontal - scalesAt(f, y - h).horizontal) / (2 * h);
    expect(Math.abs(slope(50))).toBeLessThan(1e-6);
  });
  it('does not depend on the order the knots were given in, and does not reorder them', () => {
    const f = field();
    const before = f.knots.map((k) => k.y);
    expect(scalesAt(f, 30)).toEqual(scalesAt(sortedField(f), 30));
    expect(f.knots.map((k) => k.y)).toEqual(before);
  });
});

describe('sortedField', () => {
  it('returns a sorted copy flagged as sorted', () => {
    const f = field();
    const s = sortedField(f);
    expect(s.sorted).toBe(true);
    expect(s.knots.map((k) => k.y)).toEqual([0, 50, 100]);
    expect(s.knots).not.toBe(f.knots);
    expect(f.knots.map((k) => k.y)).toEqual([100, 0, 50]);
  });
});

describe('uniformEase', () => {
  it('is a single knot', () => {
    expect(uniformEase(3, 4).knots).toEqual([{ y: 0, horizontal: 3, vertical: 4 }]);
  });
});
