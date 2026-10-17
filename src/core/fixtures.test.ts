import { beforeAll, describe, expect, it } from 'vitest';
import type { BodyModel } from './bodyModel';
import { FIXTURES } from './fixtures';
import { loadBodyFromDisk } from './loadBodyNode';
import { MEASUREMENT_NAMES, Measurer } from './measure';
import { goldenParams } from './testBodies';

/** The fixtures are the acceptance data for R1/R2. They must themselves be sane and self-consistent. */
let reference: Record<string, number>;
beforeAll(async () => {
  const body: BodyModel = await loadBodyFromDisk();
  reference = { ...new Measurer(body).measure(body.evaluate(goldenParams('presetFemale'))) };
});

describe.each(Object.entries(FIXTURES))('fixture %s', (key, fx) => {
  it('has every measurement, each finite, positive and within 0.5x-2x of a typical woman', () => {
    for (const n of MEASUREMENT_NAMES) {
      const v = fx.targets[n];
      expect(v, `${key} is missing ${n}`).toBeDefined();
      expect(Number.isFinite(v!) && v! > 0, `${key} ${n} = ${v}`).toBe(true);
      expect(v! / reference[n], `${key} ${n} = ${v} vs typical ${reference[n].toFixed(1)}`).toBeGreaterThan(0.5);
      expect(v! / reference[n], `${key} ${n} = ${v} vs typical ${reference[n].toFixed(1)}`).toBeLessThan(2);
    }
  });

  it('is self-consistent (measurements tied together by definition agree to within tape resolution)', () => {
    const t = fx.targets;
    expect(Math.abs(t.armLength! - (t.upperArmLength! + t.forearmLength!))).toBeLessThanOrEqual(0.6);
    expect(Math.abs(t.crotchDepth! - (t.waistHeight! - t.insideLeg!))).toBeLessThanOrEqual(0.6);
    expect(t.waistHeight!).toBeLessThan(t.height!);
    expect(t.bustHeight!).toBeGreaterThan(t.waistHeight!);
    expect(t.bust!).toBeGreaterThan(t.underbust!);
  });
});
