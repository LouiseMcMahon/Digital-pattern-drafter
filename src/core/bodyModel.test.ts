import { beforeAll, describe, expect, it } from 'vitest';
import type { BodyModel } from './bodyModel';
import { loadBodyFromDisk } from './loadBodyNode';
import { boundaryLoops } from './mesh';

let body: BodyModel;
beforeAll(async () => { body = await loadBodyFromDisk(); });

describe('baked body model', () => {
  it('loads with the expected sizes', () => {
    expect(body.vertexCount).toBe(13718);
    expect(body.faces.length / 3).toBe(27420);
    expect(body.components).toBe(40);
    expect(body.localLabels).toContain('measure-waist-circ-incr');
  });

  it('mean body is a plausible adult, grounded, in cm', () => {
    const s = body.evaluate();
    let [minY, maxY] = [Infinity, -Infinity];
    for (let i = 1; i < s.positions.length; i += 3) { minY = Math.min(minY, s.positions[i]); maxY = Math.max(maxY, s.positions[i]); }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeGreaterThan(150);
    expect(maxY).toBeLessThan(210);
  });

  it('is left/right symmetric and faces +z (bust side)', () => {
    const s = body.evaluate();
    const l = body.joint(s, 'upperleg01.L');
    const r = body.joint(s, 'upperleg01.R');
    expect(l[0]).toBeGreaterThan(0);
    expect(l[0]).toBeCloseTo(-r[0], 3);
    // feet point forward (+z): toe joint is in front of the ankle
    expect(body.joint(s, 'toe3-1.L')[2]).toBeGreaterThan(body.joint(s, 'foot.L')[2]);
  });

  it('local controls are linear and extrapolate', () => {
    const base = body.evaluate();
    const one = body.evaluate({ local: { 'measure-waist-circ-incr': 1 } });
    const two = body.evaluate({ local: { 'measure-waist-circ-incr': 2 } });
    for (let i = 0; i < base.positions.length; i += 997) {
      expect(two.positions[i] - base.positions[i]).toBeCloseTo(2 * (one.positions[i] - base.positions[i]), 3);
    }
  });

  it('first PCA component changes the body (size/height)', () => {
    const a = body.evaluate({ z: [-2] });
    const b = body.evaluate({ z: [2] });
    const height = (s: { positions: Float64Array }) => Math.max(...Array.from({ length: s.positions.length / 3 }, (_, i) => s.positions[3 * i + 1]));
    expect(Math.abs(height(a) - height(b))).toBeGreaterThan(20);
  });

  it('mesh is a manifold-ish surface (boundary loops are small: no tears)', () => {
    const loops = boundaryLoops(body.mesh(body.evaluate()));
    // Open at most at a handful of holes (eyes/mouth interior etc.).
    expect(loops.length).toBeLessThan(10);
  });

  it('the arm angle option reaches the pose: a wider angle swings the wrist further out (mutation-report survivor)', () => {
    const wrist = (deg?: number) => body.joint(body.evaluate({}, deg === undefined ? {} : { armDegrees: deg }), 'wrist.L')[0];
    expect(wrist(25)).toBeGreaterThan(wrist() + 5);
    expect(wrist(0)).toBeLessThan(wrist() - 1);
    expect(wrist(10)).toBeCloseTo(wrist(), 9); // 10 degrees is the default
  });
});
