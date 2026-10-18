import { describe, expect, it } from 'vitest';
import { GUIDE_RINGS, ringLandmarks } from './guides';

/** An ellipse of half-width a (x) and half-depth b (z) centred at z = 3, `n` points, as xyz at height y. */
const ellipse = (a: number, b: number, y: number, n = 72, phase = 1.3) => Array.from({ length: n }, (_, i) => { const t = phase + (2 * Math.PI * i) / n; return [a * Math.cos(t), y, 3 + b * Math.sin(t)]; }).flat();

describe('ringLandmarks', () => {
  const lm = ringLandmarks('waist', ellipse(14, 10, 105));
  const byName = Object.fromEntries(lm.map((l) => [l.name, l.point]));
  it('names the four crossings of a line round the body', () => {
    expect(Object.keys(byName).sort()).toEqual(['waist line, centre back', 'waist line, centre front', 'waist line, left side', 'waist line, right side']);
  });
  it('centre front is the front-most point on the middle, centre back the back-most', () => {
    expect(byName['waist line, centre front'][0]).toBeCloseTo(0, 0);
    expect(byName['waist line, centre front'][2]).toBeCloseTo(13, 0);
    expect(byName['waist line, centre back'][0]).toBeCloseTo(0, 0);
    expect(byName['waist line, centre back'][2]).toBeCloseTo(-7, 0);
  });
  it('the sides are the widest points: left is +x (the wearer\'s left), right is -x', () => {
    expect(byName['waist line, left side'][0]).toBeCloseTo(14, 0);
    expect(byName['waist line, right side'][0]).toBeCloseTo(-14, 0);
    expect(byName['waist line, left side'][1]).toBe(105);
  });
  it('works on a ring that does not start at the front, and on one that is not centred on z = 0', () => {
    const shifted = ellipse(12, 9, 120).map((v, i) => (i % 3 === 2 ? v + 20 : v));
    const l = Object.fromEntries(ringLandmarks('bust', shifted).map((q) => [q.name, q.point]));
    expect(l['bust line, centre front'][2]).toBeCloseTo(32, 0);
    expect(l['bust line, centre back'][2]).toBeCloseTo(14, 1);
  });
  it('is empty for an empty ring and survives a ring with no back half', () => {
    expect(ringLandmarks('waist', [])).toEqual([]);
    const front = ringLandmarks('waist', [0, 100, 5, 2, 100, 5, -2, 100, 5]);
    expect(front.map((q) => q.name)).not.toContain('waist line, centre back');
    expect(front.map((q) => q.name)).toContain('waist line, centre front'); // every point is on the middle line: all of them count as front
    expect(front.find((q) => q.name === 'waist line, centre front')!.point).toEqual([0, 100, 5]);
  });
});

describe('GUIDE_RINGS', () => {
  it('lists the measurement lines in order down the body, each with a label', () => {
    expect(GUIDE_RINGS.map((g) => g.measurement)).toEqual(['highBust', 'bust', 'underbust', 'waist', 'highHip', 'hip']);
    expect(GUIDE_RINGS.every((g) => g.label.length > 0)).toBe(true);
  });
});
