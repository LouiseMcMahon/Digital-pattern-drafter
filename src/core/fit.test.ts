import { beforeAll, describe, expect, it } from 'vitest';
import type { BodyModel } from './bodyModel';
import { loadBodyFromDisk } from './loadBodyNode';
import { fitBody, R1_TOLERANCE_CM } from './fit';
import { FIXTURES } from './fixtures';
import { Measurer, type MeasurementName } from './measure';

let body: BodyModel;
let measurer: Measurer;
beforeAll(async () => {
  body = await loadBodyFromDisk();
  measurer = new Measurer(body);
});

describe('R1/R2: fitted body reproduces the entered measurements', () => {
  for (const [key, fx] of Object.entries(FIXTURES)) {
    it(`${fx.label} (${key}) within ${R1_TOLERANCE_CM} cm on every measurement`, () => {
      const r = fitBody(body, measurer, fx.targets, { preset: fx.preset });
      // Independent read-back on a freshly evaluated body, not the solver's cached numbers.
      const shape = body.evaluate(r.params);
      const names = Object.keys(fx.targets) as MeasurementName[];
      const m = measurer.measure(shape, names);
      for (const n of names) expect(Math.abs(m[n] - fx.targets[n]!), `${n}: wanted ${fx.targets[n]}, got ${m[n].toFixed(2)}`).toBeLessThanOrEqual(R1_TOLERANCE_CM);
      expect(r.unmet).toEqual([]);
    }, 120_000);
  }

  it('a sparse measurement set still hits what was entered', () => {
    const t = { height: 188, bust: 95, waist: 78, hip: 104, napeToWaist: 47, insideLeg: 89 };
    const r = fitBody(body, measurer, t, { preset: 'female' });
    expect(r.unmet).toEqual([]);
    expect(r.maxError).toBeLessThan(R1_TOLERANCE_CM);
  }, 120_000);

  it('flags implausible measurement sets (R2) and never reports a miss as a match', () => {
    // 188 cm tall with a 45 cm inside leg is not a human proportion.
    const r = fitBody(body, measurer, { height: 188, insideLeg: 45, waistHeight: 120 }, { preset: 'female' });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.join(' ')).toMatch(/insideLeg/);
    // Whatever it returns, unmet lists exactly the targets that are off by more than R1.
    for (const u of r.unmet) expect(Math.abs(u.achieved - u.target)).toBeGreaterThan(R1_TOLERANCE_CM);
    const off = Object.entries(r.errors).filter(([, e]) => Math.abs(e!) > R1_TOLERANCE_CM).map(([n]) => n).sort();
    expect(r.unmet.map((u) => u.name).sort()).toEqual(off);
  }, 120_000);

  it('warns when measurements that are tied by definition disagree', () => {
    const r = fitBody(body, measurer, { height: 188, armLength: 64, upperArmLength: 35, forearmLength: 27, waistHeight: 115, insideLeg: 88, crotchDepth: 30 }, { preset: 'female', maxIterations: 3 });
    const w = r.warnings.join(' | ');
    expect(w).toMatch(/Arm length/);
    expect(w).toMatch(/Crotch depth/);
  }, 120_000);

  it('typical fixtures need no plausibility warnings', () => {
    for (const key of ['tall188Average', 'tall188Narrow']) {
      const r = fitBody(body, measurer, FIXTURES[key].targets, { preset: 'female' });
      expect(r.warnings, key).toEqual([]);
    }
  }, 120_000);
});
