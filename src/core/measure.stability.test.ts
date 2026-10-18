import { beforeAll, describe, expect, it } from 'vitest';
import type { BodyModel, BodyParams, BodyShape } from './bodyModel';
import { loadBodyFromDisk } from './loadBodyNode';
import { MEASUREMENT_NAMES, Measurer } from './measure';
import { TAILOR_POSE } from './pose';
import { goldenParams } from './testBodies';

/**
 * LANDMARK STABILITY. The mutation checks showed that changing the arm angle by 1 degree moved shoulder
 * width by 1.8 cm: the shoulder point was "the highest vertex in a window", and on a flat shoulder the
 * winning vertex jumps along the shoulder when the geometry moves a hair. Landmarks must not behave like
 * that: a small change to the body the landmarks are found on must give a small change in what is measured.
 * (The shoulder and neck points are now computed from the live surface; the others are tracked vertices.)
 *
 * Three properties, measured on three very different bodies:
 *   1. detection stability: find the landmarks on a slightly different mean body, measure the same shape;
 *   2. the same for larger changes (a looser bound: the underarm really does move with the arm);
 *   3. gentleness: evaluate the measured shape itself at a slightly different arm angle.
 */
let body: BodyModel;
let reference: Measurer;
const BODIES = ['presetFemale', 'tall188Narrow', 'plus170'];
const params: Record<string, BodyParams> = {};
const shapes: Record<string, BodyShape> = {};
beforeAll(async () => {
  body = await loadBodyFromDisk();
  reference = new Measurer(body);
  for (const n of BODIES) { params[n] = goldenParams(n); shapes[n] = body.evaluate(params[n]); }
});

/** Largest difference (cm) between two measurers on the same shapes, with the offender's name. */
function worstDifference(other: Measurer): { name: string; cm: number } {
  let worst = { name: '', cm: 0 };
  for (const b of BODIES) {
    const a = reference.measure(shapes[b]);
    const c = other.measure(shapes[b]);
    for (const n of MEASUREMENT_NAMES) if (Math.abs(a[n] - c[n]) > worst.cm) worst = { name: `${n} on ${b}`, cm: Math.abs(a[n] - c[n]) };
  }
  return worst;
}

const ARM = TAILOR_POSE.armDegreesFromVertical;

describe('landmark detection is stable', () => {
  const small: [string, () => BodyShape][] = [
    ['arms 1 degree out', () => body.evaluate({}, { armDegrees: ARM + 1 })],
    ['arms 1 degree in', () => body.evaluate({}, { armDegrees: ARM - 1 })],
    ['mean shifted 0.1 sd along component 0', () => body.evaluate({ z: [0.1] })],
    ['mean shifted 0.1 sd along component 1', () => body.evaluate({ z: [0, -0.1] })],
    ['mean shifted 0.1 sd along component 2', () => body.evaluate({ z: [0, 0, 0.1] })],
  ];
  it.each(small)('small change (%s): nothing moves by more than 0.3 cm', (_label, mean) => {
    const w = worstDifference(new Measurer(body, mean()));
    expect(w.cm, `${w.name} moved ${w.cm.toFixed(2)} cm`).toBeLessThanOrEqual(0.3);
  });

  const large: [string, () => BodyShape][] = [
    ['arms 3 degrees out', () => body.evaluate({}, { armDegrees: ARM + 3 })],
    ['arms 3 degrees in', () => body.evaluate({}, { armDegrees: ARM - 3 })],
    ['mean shifted 0.4 sd along component 0', () => body.evaluate({ z: [0.4] })],
    ['mean shifted 0.4 sd along component 1', () => body.evaluate({ z: [0, -0.4] })],
    ['mean shifted 0.4 sd along component 2', () => body.evaluate({ z: [0, 0, 0.4] })],
    ['mean shifted 0.4 sd along component 4', () => body.evaluate({ z: [0, 0, 0, 0, -0.4] })],
  ];
  it.each(large)('larger change (%s): nothing moves by more than 1.5 cm', (_label, mean) => {
    const w = worstDifference(new Measurer(body, mean()));
    expect(w.cm, `${w.name} moved ${w.cm.toFixed(2)} cm`).toBeLessThanOrEqual(1.5);
  });
});

describe('measurements move gently with the pose', () => {
  it('no measurement changes by more than 0.3 cm for one degree of arm swing', () => {
    for (const b of BODIES) {
      const ref = reference.measure(shapes[b]);
      for (const deg of [ARM - 1, ARM + 1]) {
        const m = reference.measure(body.evaluate(params[b], { armDegrees: deg }));
        for (const n of MEASUREMENT_NAMES) expect(Math.abs(m[n] - ref[n]), `${n} on ${b} at ${deg} degrees`).toBeLessThanOrEqual(0.3);
      }
    }
  });
});
