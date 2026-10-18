import { describe, expect, it } from 'vitest';
import type { BodyModel, BodyShape } from './bodyModel';
import { TAILOR_POSE, TailorPoseRig, matApply, matMul, matTranspose, rotationBetween } from './pose';

/**
 * UNIT TESTS FOR THE POSE MATH (written from the mutation-testing report: pose.ts scored 3% against the
 * invariant tests alone, because they only check tolerances on the real body). These use a tiny synthetic
 * skeleton and answers worked out independently (quaternions, not the code's Rodrigues matrix), so every
 * term of the rotation and the blend matters.
 */
type V = [number, number, number];
const close = (a: ArrayLike<number>, b: ArrayLike<number>, d = 1e-9) => { for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i]), `${Array.from(a)} vs ${Array.from(b)}`).toBeLessThan(d); };
const unitV = (a: V): V => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mulS = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V) => Math.hypot(...a);

/** Rotate v about a unit axis by angle, via a quaternion (independent of pose.ts's Rodrigues matrix). */
function qRotate(v: V, axis: V, angle: number): V {
  const h = angle / 2;
  const [w, x, y, z] = [Math.cos(h), axis[0] * Math.sin(h), axis[1] * Math.sin(h), axis[2] * Math.sin(h)];
  // v' = q v q^-1, expanded
  const t: V = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}
/** Rotation taking unit a onto unit b, as (axis, angle). */
function between(a: V, b: V): { axis: V; angle: number } {
  const c: V = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return { axis: unitV(c), angle: Math.atan2(norm(c), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) };
}

describe('rotation helpers', () => {
  const pairs: [V, V][] = [[[1, 0, 0], [0, 1, 0]], [[0, 0, 1], [1, 1, 0]], [[3, -4, 12], [-2, 5, 1]], [[0, -1, 0], [0.2, -0.9, 0.3]]];
  it.each(pairs)('rotationBetween(%j, %j) maps the first direction onto the second', (a, b) => {
    const R = rotationBetween(a, b);
    close(matApply(R, unitV(a)), unitV(b));
  });
  it.each(pairs)('is a proper rotation (orthonormal, determinant 1) for %j -> %j', (a, b) => {
    const R = rotationBetween(a, b);
    const RRt = matMul(R, matTranspose(R));
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(RRt[i]).toBeCloseTo(v, 9));
    const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    expect(det).toBeCloseTo(1, 9);
  });
  it('agrees with an independent quaternion rotation on an arbitrary vector', () => {
    const [a, b]: [V, V] = [unitV([3, -4, 12]), unitV([-2, 5, 1])];
    const { axis, angle } = between(a, b);
    const v: V = [1.5, -2, 0.7];
    close(matApply(rotationBetween(a, b), v), qRotate(v, axis, angle));
  });
  it('length does not matter: only the directions are used', () => {
    const R = rotationBetween([0, 0, 5], [3, 3, 0]);
    close(matApply(R, [0, 0, 1]), unitV([1, 1, 0]));
    expect(rotationBetween([0, 0, 5], [3, 3, 0])).toEqual(rotationBetween([0, 0, 1], [1, 1, 0]));
  });
  it('a zero vector has no direction: identity, never NaN', () => {
    expect(Array.from(rotationBetween([0, 0, 0], [1, 0, 0]))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(rotationBetween([1, 0, 0], [0, 0, 0]))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it('the same direction is the identity', () => {
    expect(Array.from(rotationBetween([0, -1, 0], [0, -1, 0]))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(rotationBetween([0, -2, 0], [0, -5, 0]))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]); // parallel, different length
  });
  it('opposite directions turn half a circle (not the identity)', () => {
    for (const a of [[0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 1, 1], [-3, 0.1, 0]] as V[]) {
      const b = mulS(a, -1);
      const R = rotationBetween(a, b);
      close(matApply(R, unitV(a)), unitV(b));
      const RRt = matMul(R, matTranspose(R));
      [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(RRt[i]).toBeCloseTo(v, 9));
      // A proper rotation (determinant +1), not a reflection such as -I, which also maps a to -a.
      const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
      expect(det).toBeCloseTo(1, 9);
      // Half a circle: applying it twice is the identity, and it fixes the axis it turns about.
      const RR = matMul(R, R);
      [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(RR[i]).toBeCloseTo(v, 9));
    }
  });
  it('matMul composes: (A B) v = A (B v); matTranspose inverts a rotation', () => {
    const A = rotationBetween([1, 0, 0], [0, 1, 0]);
    const B = rotationBetween([0, 0, 1], [1, 2, 3]);
    const v: V = [0.3, -1.2, 2.2];
    close(matApply(matMul(A, B), v), matApply(A, matApply(B, v)));
    close(matApply(matTranspose(A), matApply(A, v)), v);
  });
});

// ---- a tiny skeleton ----
const ARM_ORIGIN: Record<'L' | 'R', { sh: V; el: V; wr: V }> = {
  L: { sh: [10, 140, 0], el: [30, 120, 10], wr: [40, 105, 25] },
  R: { sh: [-10, 140, 0], el: [-30, 120, 10], wr: [-40, 105, 25] },
};
const LEG_ORIGIN: Record<'L' | 'R', { hip: V; knee: V; ankle: V; toe: V }> = {
  L: { hip: [8, 95, 0], knee: [12, 50, 5], ankle: [16, 8, 0], toe: [16, 2, 15] },
  R: { hip: [-8, 95, 0], knee: [-12, 50, 5], ankle: [-16, 8, 0], toe: [-16, 2, 15] },
};

function skeleton() {
  const labels = ['root'];
  const parent = [-1];
  const joints: V[] = [[0, 100, 0]];
  const add = (label: string, par: string, at: V) => { labels.push(label); parent.push(labels.indexOf(par)); joints.push(at); };
  for (const s of ['L', 'R'] as const) {
    add(`shoulder01.${s}`, 'root', ARM_ORIGIN[s].sh);
    add(`upperarm01.${s}`, `shoulder01.${s}`, ARM_ORIGIN[s].sh);
    add(`lowerarm01.${s}`, `upperarm01.${s}`, ARM_ORIGIN[s].el);
    add(`wrist.${s}`, `lowerarm01.${s}`, ARM_ORIGIN[s].wr);
    add(`upperleg01.${s}`, 'root', LEG_ORIGIN[s].hip);
    add(`lowerleg01.${s}`, `upperleg01.${s}`, LEG_ORIGIN[s].knee);
    add(`foot.${s}`, `lowerleg01.${s}`, LEG_ORIGIN[s].ankle);
    add(`toe.${s}`, `foot.${s}`, LEG_ORIGIN[s].toe);
  }
  // One vertex on each bone's joint (weight 1), plus a half-and-half vertex between root and each limb root.
  const verts: { at: V; weights: Record<string, number> }[] = labels.map((l, i) => ({ at: joints[i], weights: { [l]: 1 } }));
  verts.push({ at: [20, 130, 5], weights: { root: 0.5, 'upperarm01.L': 0.5 } });
  verts.push({ at: [-20, 130, 5], weights: { root: 0.25, 'upperarm01.R': 0.75 } });
  verts.push({ at: [10, 60, 3], weights: { root: 0.5, 'upperleg01.L': 0.5 } });
  const body = {
    boneLabels: labels,
    boneParents: parent,
    vertexCount: verts.length,
    weightOfBones: (v: number, pick: (bi: number) => boolean) => Object.entries(verts[v].weights).reduce((sum, [l, w]) => sum + (pick(labels.indexOf(l)) ? w : 0), 0),
  } as unknown as BodyModel;
  const shape: BodyShape = { positions: Float64Array.from(verts.flatMap((v) => v.at)), joints: Float64Array.from(joints.flat()) };
  return { body, shape, labels, verts };
}

describe('TailorPoseRig on a synthetic skeleton (arm and leg, both sides)', () => {
  const { body, shape, labels, verts } = skeleton();
  const posed = new TailorPoseRig(body).apply(shape);
  const joint = (s: BodyShape, l: string): V => { const i = labels.indexOf(l); return [s.joints[3 * i], s.joints[3 * i + 1], s.joints[3 * i + 2]]; };
  const vertex = (s: BodyShape, i: number): V => [s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]];
  const deg = (TAILOR_POSE.armDegreesFromVertical * Math.PI) / 180;

  it.each(['L', 'R'] as const)('%s arm: shoulder stays, upper arm and forearm both hang along the arm direction at their original lengths', (s) => {
    const sign = s === 'L' ? 1 : -1;
    const armDir: V = [sign * Math.sin(deg), -Math.cos(deg), 0];
    const o = ARM_ORIGIN[s];
    const upperLen = norm(sub(o.el, o.sh));
    const foreLen = norm(sub(o.wr, o.el));
    close(joint(posed, `upperarm01.${s}`), o.sh);
    close(joint(posed, `lowerarm01.${s}`), add(o.sh, mulS(armDir, upperLen)));
    close(joint(posed, `wrist.${s}`), add(add(o.sh, mulS(armDir, upperLen)), mulS(armDir, foreLen)));
  });

  it.each(['L', 'R'] as const)('%s leg: hip stays, thigh and shank vertical at their original lengths, foot offset kept', (s) => {
    const o = LEG_ORIGIN[s];
    const thigh = norm(sub(o.knee, o.hip));
    const shank = norm(sub(o.ankle, o.knee));
    const knee: V = [o.hip[0], o.hip[1] - thigh, o.hip[2]];
    const ankle: V = [o.hip[0], o.hip[1] - thigh - shank, o.hip[2]];
    close(joint(posed, `upperleg01.${s}`), o.hip);
    close(joint(posed, `lowerleg01.${s}`), knee);
    close(joint(posed, `foot.${s}`), ankle);
    // The foot keeps its orientation: the toe sits where it did relative to the ankle.
    close(joint(posed, `toe.${s}`), add(ankle, sub(o.toe, o.ankle)));
  });

  it('a vertex fully on a bone moves exactly with that bone', () => {
    for (const s of ['L', 'R'] as const) {
      for (const bone of [`wrist.${s}`, `lowerarm01.${s}`, `foot.${s}`, `toe.${s}`, `lowerleg01.${s}`]) {
        close(vertex(posed, labels.indexOf(bone)), joint(posed, bone));
      }
    }
  });

  it('root vertices and joints are untouched', () => {
    close(vertex(posed, 0), verts[0].at);
    close(joint(posed, 'root'), [0, 100, 0]);
  });

  it('a vertex half on the arm moves half of the way the arm moves (blend by skinning weight)', () => {
    const o = ARM_ORIGIN.L;
    const armDir: V = [Math.sin(deg), -Math.cos(deg), 0];
    const { axis, angle } = between(unitV(sub(o.el, o.sh)), armDir);
    const p = verts[verts.length - 3].at;
    const full = add(o.sh, qRotate(sub(p, o.sh), axis, angle));
    close(vertex(posed, verts.length - 3), add(p, mulS(sub(full, p), 0.5)));
  });

  it('a vertex three-quarters on the right arm moves three quarters of the way', () => {
    const o = ARM_ORIGIN.R;
    const armDir: V = [-Math.sin(deg), -Math.cos(deg), 0];
    const { axis, angle } = between(unitV(sub(o.el, o.sh)), armDir);
    const p = verts[verts.length - 2].at;
    const full = add(o.sh, qRotate(sub(p, o.sh), axis, angle));
    close(vertex(posed, verts.length - 2), add(p, mulS(sub(full, p), 0.75)));
  });

  it('a vertex half on the left leg moves half of the way the thigh moves', () => {
    const o = LEG_ORIGIN.L;
    const { axis, angle } = between(unitV(sub(o.knee, o.hip)), [0, -1, 0]);
    const p = verts[verts.length - 1].at;
    const full = add(o.hip, qRotate(sub(p, o.hip), axis, angle));
    close(vertex(posed, verts.length - 1), add(p, mulS(sub(full, p), 0.5)));
  });

  it('does not change the input shape', () => {
    const before = Array.from(shape.positions);
    new TailorPoseRig(body).apply(shape);
    expect(Array.from(shape.positions)).toEqual(before);
  });

  it('the arm angle is a parameter: 0 degrees hangs the arm straight down; a wider angle swings it out further', () => {
    const zero = new TailorPoseRig(body, 0).apply(shape);
    const wr = joint(zero, 'wrist.L');
    expect(wr[0]).toBeCloseTo(ARM_ORIGIN.L.sh[0], 9);
    const wide = joint(new TailorPoseRig(body, TAILOR_POSE.armDegreesFromVertical + 10).apply(shape), 'wrist.L');
    expect(wide[0]).toBeGreaterThan(joint(posed, 'wrist.L')[0]);
  });

  it('throws on a missing bone instead of silently doing nothing', () => {
    const broken = { ...body, boneLabels: body.boneLabels.filter((l) => l !== 'foot.L') } as unknown as BodyModel;
    expect(() => new TailorPoseRig(broken).apply(shape)).toThrow(/Unknown bone/);
  });
});
