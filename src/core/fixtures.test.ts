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
    // Exact: the generator derives these sums from the rounded parts.
    expect(t.armLength!).toBe(t.upperArmLength! + t.forearmLength!);
    expect(t.crotchDepth!).toBe(t.waistHeight! - t.insideLeg!);
    expect(t.waistHeight!).toBeLessThan(t.height!);
    expect(t.bustHeight!).toBeGreaterThan(t.waistHeight!);
    expect(t.bust!).toBeGreaterThan(t.underbust!);
  });

  it("is a body a person could have (independent of the model: simple anatomy)", () => {
    const t = fx.targets;
    // Allowance of 2.5 cm: the model's chest above the breast is nearly as wide as at the apex (see
    // plausibility.test.ts and PLAN.md known limitations).
    expect(t.highBust!, 'high bust is measured above the bust and should not exceed it').toBeLessThanOrEqual(t.bust! + 2.5);
    expect(t.highBust!).toBeGreaterThan(t.underbust!);
    expect(t.elbow! / t.upperArm!, 'elbow girth vs upper-arm girth').toBeGreaterThanOrEqual(0.75);
    expect(t.elbow! / t.upperArm!).toBeLessThanOrEqual(1.05);
    expect(t.upperArm!).toBeGreaterThan(t.wrist! * 1.4);
    expect(t.thigh!).toBeGreaterThan(t.knee!);
    expect(t.calf!).toBeGreaterThan(t.ankle!);
    expect(t.hip!).toBeGreaterThan(t.highHip!);
    expect(t.highHip!).toBeGreaterThan(t.waist!);
  });
});
