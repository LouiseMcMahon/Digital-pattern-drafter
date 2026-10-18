import { describe, expect, it } from 'vitest';
import { GUIDE_RINGS, centreLines, ringLandmarks } from './guides';

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

/** A closed elliptical tube (half-width a, half-depth b, centred at z = 3) from y = 0 to y = 20; no vertex lies on x = 0. */
function tube(a: number, b: number, cols = 64) {
  const positions: number[] = [];
  for (const y of [0, 10, 20]) for (let c = 0; c < cols; c++) { const t = 0.05 + (2 * Math.PI * c) / cols; positions.push(a * Math.cos(t), y, 3 + b * Math.sin(t)); }
  const triangles: number[] = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, j = r * cols + ((c + 1) % cols);
    triangles.push(i, i + cols, j, j, i + cols, j + cols);
  }
  return { positions, triangles };
}

describe('centreLines', () => {
  const { positions, triangles } = tube(14, 10, 64);
  const lines = centreLines(positions, triangles, 2, 15, 18);
  const front = lines.find((l) => l.name === 'centre front line')!;
  const back = lines.find((l) => l.name === 'centre back line')!;
  const ys = (l: { points: number[] }) => l.points.filter((_, i) => i % 3 === 1);
  it('returns the centre front line and the centre back line, in that order', () => {
    expect(lines.map((l) => l.name)).toEqual(['centre front line', 'centre back line']);
  });
  it('runs up the body on the centre plane, front-most and back-most', () => {
    for (let i = 0; i < front.points.length; i += 3) { expect(front.points[i]).toBe(0); expect(front.points[i + 2]).toBeCloseTo(13, 1); }
    for (let i = 0; i < back.points.length; i += 3) { expect(back.points[i]).toBe(0); expect(back.points[i + 2]).toBeCloseTo(-7, 1); }
  });
  it('is sampled every step cm from the bottom up to its own top, in order', () => {
    expect(ys(front)[0]).toBe(2);
    expect(ys(front).at(-1)).toBe(15);
    expect(ys(back)[0]).toBe(2);
    expect(ys(back).at(-1)).toBe(18);
    expect(ys(front)).toHaveLength(27);
    expect(ys(back)).toHaveLength(33);
    expect(ys(front)).toEqual([...ys(front)].sort((p, q) => p - q));
  });
  it('honours the step size', () => {
    const coarse = centreLines(positions, triangles, 2, 15, 18, 2);
    expect(ys(coarse[0])).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });
  it('keeps the front-most cut when the surface is cut more than once at a height', () => {
    const inner = tube(5, 3, 64);
    const both = { positions: [...positions, ...inner.positions], triangles: [...triangles, ...inner.triangles.map((i) => i + positions.length / 3)] };
    const l = centreLines(both.positions, both.triangles, 2, 15, 18);
    expect(l[0].points[2]).toBeCloseTo(13, 1);
    expect(l[1].points[2]).toBeCloseTo(-7, 1);
  });
  it('is empty when nothing crosses the centre plane or the range is empty', () => {
    expect(centreLines([5, 0, 0, 6, 0, 0, 5, 10, 0], [0, 1, 2], 0, 10, 10)).toEqual([]);
    expect(centreLines(positions, triangles, 30, 40, 40)).toEqual([]);
  });
});
