import { beforeAll, describe, expect, it } from 'vitest';
import type { BodyModel } from './bodyModel';
import { loadBodyFromDisk } from './loadBodyNode';
import { TAILOR_POSE } from './pose';
import { goldenParams, readGolden } from './testBodies';

/** R5: the standard tailor pose. See REQUIREMENTS.md. */
let body: BodyModel;
beforeAll(async () => { body = await loadBodyFromDisk(); });

const names = Object.keys(readGolden().bodies);
type J = [number, number, number];
const dist = (a: J, b: J) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const fromVertical = (a: J, b: J) => (Math.atan2(Math.hypot(b[0] - a[0], b[2] - a[2]), -(b[1] - a[1])) * 180) / Math.PI;

describe.each(names)('tailor pose: %s', (name) => {
  const params = () => goldenParams(name);

  it('upper arm and forearm are held at the tailor-pose angle from vertical, straight, in the coronal plane', () => {
    const s = body.evaluate(params());
    for (const side of ['L', 'R'] as const) {
      const sh = body.joint(s, `upperarm01.${side}`);
      const el = body.joint(s, `lowerarm01.${side}`);
      const wr = body.joint(s, `wrist.${side}`);
      expect(fromVertical(sh, el)).toBeCloseTo(TAILOR_POSE.armDegreesFromVertical, 1);
      expect(fromVertical(el, wr)).toBeCloseTo(TAILOR_POSE.armDegreesFromVertical, 1);
      expect(Math.abs(el[2] - sh[2])).toBeLessThan(0.05); // no forward/back lean
      expect(Math.abs(wr[2] - el[2])).toBeLessThan(0.05);
      // Out to the side: the arm is lateral of the shoulder on its own side.
      expect((side === 'L' ? 1 : -1) * (wr[0] - sh[0])).toBeGreaterThan(0);
    }
  });

  it('thigh and shank are vertical', () => {
    const s = body.evaluate(params());
    for (const side of ['L', 'R'] as const) {
      expect(fromVertical(body.joint(s, `upperleg01.${side}`), body.joint(s, `lowerleg01.${side}`))).toBeLessThan(0.5);
      expect(fromVertical(body.joint(s, `lowerleg01.${side}`), body.joint(s, `foot.${side}`))).toBeLessThan(0.5);
    }
  });

  it('soles are on y = 0 and the feet keep their flat orientation', () => {
    const s = body.evaluate(params());
    const rest = body.evaluate(params(), { pose: 'rest' });
    let minY = Infinity;
    for (let i = 1; i < s.positions.length; i += 3) minY = Math.min(minY, s.positions[i]);
    expect(minY).toBeCloseTo(0, 6);
    for (const side of ['L', 'R'] as const) {
      // Toe-to-ankle offset (height and length) is unchanged by the pose: the foot was not tilted.
      const off = (sh: typeof s) => { const a = body.joint(sh, `foot.${side}`); const t = body.joint(sh, `toe3-1.${side}`); return [t[1] - a[1], t[2] - a[2]]; };
      expect(off(s)[0]).toBeCloseTo(off(rest)[0], 1);
      expect(off(s)[1]).toBeCloseTo(off(rest)[1], 1);
    }
  });

  it('posing does not change bone lengths', () => {
    const s = body.evaluate(params());
    const rest = body.evaluate(params(), { pose: 'rest' });
    for (const side of ['L', 'R'] as const) {
      for (const [a, b] of [['upperarm01', 'lowerarm01'], ['lowerarm01', 'wrist'], ['upperleg01', 'lowerleg01'], ['lowerleg01', 'foot']]) {
        expect(dist(body.joint(s, `${a}.${side}`), body.joint(s, `${b}.${side}`))).toBeCloseTo(dist(body.joint(rest, `${a}.${side}`), body.joint(rest, `${b}.${side}`)), 1);
      }
    }
  });

  it('is left/right symmetric', () => {
    const s = body.evaluate(params());
    for (const j of ['upperarm01', 'lowerarm01', 'wrist', 'upperleg01', 'lowerleg01', 'foot', 'toe3-1']) {
      const l = body.joint(s, `${j}.L`);
      const r = body.joint(s, `${j}.R`);
      // Within 0.2 mm (25x tighter than the 5 mm measurement requirement): the baked data is float32/int16, and limb rotations amplify that noise, so mirrored joints agree to a tenth of a millimetre, not to the bit.
      expect(Math.abs(l[0] + r[0])).toBeLessThan(0.02);
      expect(Math.abs(l[1] - r[1])).toBeLessThan(0.02);
      expect(Math.abs(l[2] - r[2])).toBeLessThan(0.02);
    }
  });

  it('is finite everywhere and leaves the trunk and head where the rest pose has them', () => {
    const s = body.evaluate(params());
    const rest = body.evaluate(params(), { pose: 'rest' });
    expect(s.positions.every(Number.isFinite)).toBe(true);
    expect(s.joints.every(Number.isFinite)).toBe(true);
    // x and z of the head and spine joints are untouched by the limb rotations.
    for (const j of ['head', 'neck01', 'spine01', 'spine05']) {
      const a = body.joint(s, j);
      const b = body.joint(rest, j);
      expect(a[0]).toBeCloseTo(b[0], 6);
      expect(a[2]).toBeCloseTo(b[2], 6);
    }
  });
});

describe('pose selection', () => {
  it("defaults to the tailor pose; 'rest' is the model's native pose and differs", () => {
    const def = body.evaluate();
    const tailor = body.evaluate({}, { pose: 'tailor' });
    const rest = body.evaluate({}, { pose: 'rest' });
    expect(Array.from(def.positions)).toEqual(Array.from(tailor.positions));
    const w = (s: typeof def) => body.joint(s, 'wrist.L');
    expect(dist(w(rest), w(tailor))).toBeGreaterThan(15);
    // Native rest pose has the arms well out and forward of a hanging arm.
    expect(fromVertical(body.joint(rest, 'upperarm01.L'), body.joint(rest, 'lowerarm01.L'))).toBeGreaterThan(30);
  });
});
