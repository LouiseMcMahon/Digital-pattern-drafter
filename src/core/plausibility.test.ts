import { beforeAll, describe, expect, it } from 'vitest';
import type { BodyModel } from './bodyModel';
import { loadBodyFromDisk } from './loadBodyNode';
import { type MeasurementName, type Measurements, Measurer } from './measure';
import { goldenParams, readGolden } from './testBodies';

/**
 * PLAUSIBILITY. The golden snapshots only say "nothing changed"; if a measurement were broken before the
 * golden file was generated, the golden file would enshrine it. These checks do not look at any golden
 * number: they measure each reference body live and require simple anatomy to hold (proportions of
 * height inside broad human bands, and orderings like wrist < elbow < upper arm). The bands are
 * deliberately loose (about 25% either side of what the reference bodies show, which agrees with
 * published adult proportions), so they catch a measurement that has gone wrong, not natural variation.
 */
let body: BodyModel;
let measurer: Measurer;
const measured: Record<string, Measurements> = {};
const names = Object.keys(readGolden().bodies);
beforeAll(async () => {
  body = await loadBodyFromDisk();
  measurer = new Measurer(body);
  for (const n of names) measured[n] = measurer.measure(body.evaluate(goldenParams(n)));
});

/** Measurement / height, [min, max]. */
const BANDS: Partial<Record<MeasurementName, [number, number]>> = {
  neck: [0.14, 0.28], shoulderWidth: [0.16, 0.28], acrossBack: [0.17, 0.31], acrossChest: [0.15, 0.25],
  armscyeDepth: [0.085, 0.15], shoulderLength: [0.045, 0.09], shoulderToBust: [0.12, 0.26], bustHeight: [0.68, 0.8],
  waistHeight: [0.57, 0.66], napeToWaist: [0.2, 0.29], frontLength: [0.2, 0.32], crotchLength: [0.26, 0.47],
  crotchDepth: [0.11, 0.19], upperArmLength: [0.16, 0.23], forearmLength: [0.11, 0.17], waistToHip: [0.085, 0.14],
  insideLeg: [0.4, 0.52], armLength: [0.29, 0.38], bustSeparation: [0.07, 0.15],
};

describe.each(names)('plausible body: %s', (name) => {
  const m = () => measured[name];
  const female = name !== 'presetMale';

  it('proportions of height are inside human bands', () => {
    const out: string[] = [];
    for (const [n, [lo, hi]] of Object.entries(BANDS) as [MeasurementName, [number, number]][]) {
      const r = m()[n] / m().height;
      if (!(r >= lo && r <= hi)) out.push(`${n} = ${m()[n].toFixed(1)} cm is ${(100 * r).toFixed(1)}% of height (band ${100 * lo}-${100 * hi}%)`);
    }
    expect(out).toEqual([]);
  });

  it('girths are ordered the way a body is', () => {
    const v = m();
    expect(v.wrist).toBeLessThan(v.elbow);
    expect(v.elbow).toBeLessThan(v.upperArm * 1.05);
    expect(v.elbow / v.upperArm, 'elbow vs upper arm').toBeGreaterThan(0.6);
    expect(v.thigh).toBeGreaterThan(v.knee);
    expect(v.calf, 'calf vs ankle').toBeGreaterThan(v.ankle);
    expect(v.calf, 'calf is within a few cm of the knee').toBeLessThan(v.knee + 5);
    expect(v.hip).toBeGreaterThan(v.highHip);
    expect(v.highHip).toBeGreaterThan(v.waist);
    expect(v.bust).toBeGreaterThan(v.underbust);
    expect(v.highBust).toBeGreaterThan(v.underbust);
    if (female) {
      // Allowance of 2.5 cm: in this model the chest above the breast is nearly as wide as at the apex (the
      // average woman's high bust is only ~2 cm under her bust, vs 5-7 cm in published data), so a flat-chested
      // body can read slightly over. More than that is a broken ring. See PLAN.md known limitations.
      expect(v.highBust, 'high bust is above the bust and should not exceed it').toBeLessThanOrEqual(v.bust + 2.5);
    }
  });

  it('heights are ordered down the body', () => {
    const v = m();
    expect(v.height).toBeGreaterThan(v.bustHeight);
    expect(v.bustHeight).toBeGreaterThan(v.waistHeight);
    expect(v.waistHeight).toBeGreaterThan(v.insideLeg);
    expect(v.napeToWaist).toBeGreaterThan(v.armscyeDepth);
    expect(v.acrossBack).toBeGreaterThan(v.acrossChest * 0.95);
    expect(v.shoulderWidth).toBeGreaterThan(v.acrossChest);
  });
});
