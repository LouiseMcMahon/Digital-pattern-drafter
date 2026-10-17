import { describe, expect, it } from 'vitest';
import { buildFrontTorso, defaultMeasurements, type Measurements } from './body';
import { uniformEase } from './ease';
import { flatten } from './flatten';

const tubeMeasurements: Measurements = {
  ...defaultMeasurements,
  bust: 90, waist: 90, hip: 90,
  depthRatio: { bust: 0.7, waist: 0.7, hip: 0.7 },
};

function bounds(uv: Float64Array) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < uv.length; i += 2) {
    x0 = Math.min(x0, uv[i]); x1 = Math.max(x1, uv[i]);
    y0 = Math.min(y0, uv[i + 1]); y1 = Math.max(y1, uv[i + 1]);
  }
  return { w: x1 - x0, h: y1 - y0 };
}

function run(m: Measurements, horizontal: number, vertical: number) {
  const g = buildFrontTorso(m);
  const r = flatten(g.mesh, { ease: uniformEase(horizontal, vertical) });
  return { g, r, ...bounds(r.uv) };
}

describe('flatten', () => {
  it('zero ease on a near-tube keeps lengths (no flips, low error)', () => {
    const { r, w } = run(tubeMeasurements, 0, 0);
    expect(r.flippedTriangles).toBe(0);
    expect(r.rmsEdgeError).toBeLessThan(0.02);
    expect(w).toBeGreaterThan((90 / 2) * 0.95);
    expect(w).toBeLessThan((90 / 2) * 1.05);
  });

  it('horizontal ease % scales the panel width', () => {
    const base = run(tubeMeasurements, 0, 0).w;
    expect(run(tubeMeasurements, 10, 0).w / base).toBeCloseTo(1.1, 1);
    expect(run(tubeMeasurements, -10, 0).w / base).toBeCloseTo(0.9, 1);
  });

  it('vertical ease % scales the panel height', () => {
    const base = run(tubeMeasurements, 0, 0).h;
    expect(run(tubeMeasurements, 0, -10).h / base).toBeCloseTo(0.9, 1);
    expect(run(tubeMeasurements, 0, 10).h / base).toBeCloseTo(1.1, 1);
  });

  it('shaped torso with mixed ease flattens without flips', () => {
    const { r } = run(defaultMeasurements, -8, -3);
    expect(r.flippedTriangles).toBe(0);
  });
});
