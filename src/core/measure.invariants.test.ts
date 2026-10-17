import { beforeAll, describe, expect, it } from 'vitest';
import type { BodyModel, BodyShape } from './bodyModel';
import { loadBodyFromDisk } from './loadBodyNode';
import { MEASUREMENT_NAMES, type MeasurementName, Measurer } from './measure';
import { goldenParams } from './testBodies';

/**
 * Properties every measurement definition must keep, whatever the model data is. They catch a
 * definition silently changing meaning even when the golden numbers are updated by mistake.
 */
let body: BodyModel;
let measurer: Measurer;
beforeAll(async () => { body = await loadBodyFromDisk(); measurer = new Measurer(body); });

const scaled = (s: BodyShape, k: number): BodyShape => ({ positions: s.positions.map((v) => v * k), joints: s.joints.map((v) => v * k) });

/** Measurements that are pure functions of the geometry, so they scale exactly with the body. */
const SCALE_COVARIANT: MeasurementName[] = MEASUREMENT_NAMES.filter((n) => !['thigh', 'highBust', 'armscyeDepth'].includes(n));

describe('measurement definitions', () => {
  it('never throw when a section is missing: they return NaN, which the fit counts as a miss', () => {
    // Move the body 500 cm sideways so the centre-line plane (x = 0) crosses nothing.
    const s = body.evaluate(goldenParams('presetFemale'));
    const away: BodyShape = { positions: s.positions.map((v, i) => (i % 3 === 0 ? v + 500 : v)), joints: s.joints.map((v, i) => (i % 3 === 0 ? v + 500 : v)) };
    expect(() => measurer.measure(away, ['napeToWaist', 'crotchLength'])).not.toThrow();
    const m = measurer.measure(away, ['napeToWaist', 'crotchLength']);
    expect(Number.isNaN(m.napeToWaist)).toBe(true);
    expect(Number.isNaN(m.crotchLength)).toBe(true);
  });

  it('are deterministic', () => {
    const s = body.evaluate(goldenParams('tall188Average'));
    expect(measurer.measure(s)).toEqual(measurer.measure(s));
  });

  it('every measurement is a finite positive number on every reference body', () => {
    for (const name of ['presetFemale', 'presetMale', 'tall188Broad', 'petite155', 'plus170']) {
      const m = measurer.measure(body.evaluate(goldenParams(name)));
      for (const n of MEASUREMENT_NAMES) expect(Number.isFinite(m[n]) && m[n] > 0, `${name} ${n} = ${m[n]}`).toBe(true);
    }
  });

  it('scale with the body: scaling a body by 10% scales every geometric measurement by 10%', () => {
    const s = body.evaluate(goldenParams('tall188Average'));
    const a = measurer.measure(s);
    const b = measurer.measure(scaled(s, 1.1));
    for (const n of SCALE_COVARIANT) {
      expect(Math.abs(b[n] / a[n] - 1.1), `${n}: ${a[n].toFixed(2)} -> ${b[n].toFixed(2)}`).toBeLessThan(0.004);
    }
  });

  it('measure only the requested subset, with identical values', () => {
    const s = body.evaluate(goldenParams('presetFemale'));
    const all = measurer.measure(s);
    const some = measurer.measure(s, ['bust', 'waist', 'acrossBack', 'crotchLength']);
    for (const n of ['bust', 'waist', 'acrossBack', 'crotchLength'] as const) expect(some[n]).toBe(all[n]);
  });

  it('an arm-length identity holds by definition: armLength = shoulder-to-elbow + elbow-to-wrist', () => {
    for (const name of ['presetFemale', 'tall188Narrow', 'plus170']) {
      const m = measurer.measure(body.evaluate(goldenParams(name)));
      expect(m.armLength).toBeCloseTo(m.upperArmLength + m.forearmLength, 6);
    }
  });

  it('a rise identity holds by definition: crotchDepth = waistHeight - insideLeg', () => {
    for (const name of ['presetFemale', 'tall188Narrow', 'plus170']) {
      const m = measurer.measure(body.evaluate(goldenParams(name)));
      expect(m.crotchDepth).toBeCloseTo(m.waistHeight - m.insideLeg, 6);
    }
  });

  it('height is the body height (floor to crown) in the tailor pose', () => {
    const s = body.evaluate(goldenParams('tall188Average'));
    let top = 0;
    for (let i = 1; i < s.positions.length; i += 3) top = Math.max(top, s.positions[i]);
    expect(measurer.measure(s, ['height']).height).toBeCloseTo(top, 9);
  });
});

/** Anny's dedicated controls must still move the measurement they are named for, in the right direction. */
describe('controls move the measurements they are named for', () => {
  const cases: [string, MeasurementName][] = [
    ['measure-bust-circ-incr', 'bust'], ['measure-underbust-circ-incr', 'underbust'], ['measure-waist-circ-incr', 'waist'],
    ['measure-hips-circ-incr', 'hip'], ['measure-neck-circ-incr', 'neck'], ['measure-upperarm-circ-incr', 'upperArm'],
    ['measure-wrist-circ-incr', 'wrist'], ['measure-thigh-circ-incr', 'thigh'], ['measure-knee-circ-incr', 'knee'],
    ['measure-calf-circ-incr', 'calf'], ['measure-ankle-circ-incr', 'ankle'],
    ['measure-upperarm-length-incr', 'upperArmLength'], ['measure-lowerarm-length-incr', 'forearmLength'],
    ['measure-napetowaist-dist-incr', 'napeToWaist'], ['measure-shoulder-dist-incr', 'shoulderWidth'],
  ];
  it.each(cases)('%s raises %s by at least 0.5 cm', (control, name) => {
    const base = goldenParams('presetFemale');
    const a = measurer.measure(body.evaluate(base), [name])[name];
    const b = measurer.measure(body.evaluate({ ...base, local: { [control]: 1 } }), [name])[name];
    expect(b - a, `${control}: ${a.toFixed(2)} -> ${b.toFixed(2)}`).toBeGreaterThan(0.5);
  });

  it('the length controls move height, the circumference controls leave it alone', () => {
    const base = goldenParams('presetFemale');
    const h = (local: Record<string, number>) => measurer.measure(body.evaluate({ ...base, local }), ['height']).height;
    const h0 = h({});
    expect(Math.abs(h({ 'measure-waist-circ-incr': 2 }) - h0)).toBeLessThan(0.3);
    expect(Math.abs(h({ 'measure-bust-circ-incr': 2 }) - h0)).toBeLessThan(0.3);
    expect(h({ 'measure-lowerleg-height-incr': 1 }) - h0).toBeGreaterThan(1);
  });
});
