import { describe, expect, it } from 'vitest';
import { buildFrontTorso, circumferenceAt, defaultMeasurements, type Measurements } from './body';
import { uniformEase, fabrics } from './ease';
import { flatten, stretchDemand } from './flatten';

const cylinder: Measurements = {
  ...defaultMeasurements,
  bust: 90, waist: 90, hip: 90,
  depthRatio: { bust: 0.7, waist: 0.7, hip: 0.7 },
};
// The top/hem knots taper slightly; make a true tube for the developable test.
const tube = (m: Measurements) => ({ ...m, topHeight: 40, hemHeight: -25 });

function bounds(uv: Float64Array) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < uv.length; i += 2) {
    x0 = Math.min(x0, uv[i]); x1 = Math.max(x1, uv[i]);
    y0 = Math.min(y0, uv[i + 1]); y1 = Math.max(y1, uv[i + 1]);
  }
  return { w: x1 - x0, h: y1 - y0 };
}

function run(m: Measurements, horizontalCm: number, vertical: number) {
  const g = buildFrontTorso(tube(m));
  const r = flatten(g.mesh, { ease: uniformEase(horizontalCm, vertical), circumferenceAt: (y) => circumferenceAt(m, y) });
  return { g, r, ...bounds(r.uv) };
}

describe('flatten', () => {
  it('zero ease on a near-tube keeps lengths (no flips, low error)', () => {
    const { r, w } = run(cylinder, 0, 0);
    expect(r.flippedTriangles).toBe(0);
    expect(r.rmsEdgeError).toBeLessThan(0.02);
    expect(w).toBeGreaterThan(90 / 2 * 0.95);
    expect(w).toBeLessThan(90 / 2 * 1.05);
  });

  it('positive horizontal ease widens the front panel by half the total ease', () => {
    const base = run(cylinder, 0, 0).w;
    const eased = run(cylinder, 8, 0).w;
    expect(eased - base).toBeGreaterThan(3.5);
    expect(eased - base).toBeLessThan(4.5);
  });

  it('negative vertical ease shortens the panel', () => {
    const base = run(cylinder, 0, 0).h;
    const eased = run(cylinder, 0, -0.1).h;
    expect(eased / base).toBeGreaterThan(0.88);
    expect(eased / base).toBeLessThan(0.92);
  });

  it('shaped torso with mixed ease flattens without flips', () => {
    const { r } = run(defaultMeasurements, -6, -0.03);
    expect(r.flippedTriangles).toBe(0);
  });

  it('reports the stretch a knit needs for negative ease, and checks it against the fabric', () => {
    const { g, r } = run(cylinder, -9, 0); // -10% around
    const jersey = fabrics.find((f) => f.name === 'Cotton jersey')!;
    const woven = fabrics[0];
    const s = stretchDemand(g.mesh, r.uv, jersey);
    expect(s.maxH).toBeGreaterThan(0.09);
    expect(s.maxH).toBeLessThan(0.14); // 1/0.9 - 1 = 11%
    expect(s.fabricOk).toBe(true);
    expect(stretchDemand(g.mesh, r.uv, woven).fabricOk).toBe(false);
  });
});
