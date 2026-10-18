import type { BodyModel, BodyShape } from './bodyModel';

/**
 * Poses the body can be evaluated in.
 *  tailor  the standard tailor pose (REQUIREMENTS.md R5). The default everywhere.
 *  rest    the model's native rest pose (arms out and forward, elbows bent, legs splayed).
 */
export type PoseName = 'tailor' | 'rest';

/** Standard tailor pose parameters. Change these only together with REQUIREMENTS.md R5 and the golden files. */
export const TAILOR_POSE = {
  /** Arms are held this far from vertical, out to the sides in the coronal plane (an A-pose: clear of the torso so the underarm can be measured). */
  armDegreesFromVertical: 45,
} as const;

type V3 = [number, number, number];
type M3 = [number, number, number, number, number, number, number, number, number]; // row-major

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (a: M3, b: M3): M3 => {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[3 * i + j] += a[3 * i + k] * b[3 * k + j];
  return r as M3;
};
const transpose = (a: M3): M3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const apply = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

/** Rotation taking direction a onto direction b (Rodrigues; exported for the tests). */
export function rotationBetween(from: V3, to: V3): M3 {
  if (norm(from) === 0 || norm(to) === 0) return IDENTITY; // no direction to turn
  const a = unit(from); // directions: length must not matter (a non-unit input used to give a non-rotation)
  const b = unit(to);
  const k = cross(a, b);
  const s = norm(k);
  const c = dot(a, b);
  if (s < 1e-12) {
    if (c > 0) return IDENTITY; // already the same direction
    // Opposite directions: any axis perpendicular to a will do; turn half a circle about it.
    const axis = unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0])); // a is a unit vector here
    const [x, y, z] = axis;
    return [2 * x * x - 1, 2 * x * y, 2 * x * z, 2 * y * x, 2 * y * y - 1, 2 * y * z, 2 * z * x, 2 * z * y, 2 * z * z - 1];
  }
  const [x, y, z] = [k[0] / s, k[1] / s, k[2] / s];
  const t = 1 - c;
  return [
    c + x * x * t, x * y * t - z * s, x * z * t + y * s,
    y * x * t + z * s, c + y * y * t, y * z * t - x * s,
    z * x * t - y * s, z * y * t + x * s, c + z * z * t,
  ];
}

/**
 * Moves the model's rest pose into the tailor pose with rigid joint rotations blended by skinning
 * weight: arms are held `armDegreesFromVertical` from vertical with straight elbows; legs are vertical and
 * straight (feet hip-width apart, as the hips stand); feet keep their flat orientation.
 */
export class TailorPoseRig {
  private readonly chains = new Map<string, { bones: Set<number>; weight: Float64Array }>();

  /** @param armDegrees arm angle from vertical; only tests vary it (stability of landmark detection). */
  constructor(private readonly body: BodyModel, private readonly armDegrees: number = TAILOR_POSE.armDegreesFromVertical) {}

  private chain(root: string) {
    let c = this.chains.get(root);
    if (!c) {
      const b = this.body;
      const r = b.boneLabels.indexOf(root);
      if (r < 0) throw new Error(`Unknown bone: ${root}`); // a misspelt bone must not become a silent no-op
      const bones = new Set<number>();
      b.boneLabels.forEach((_, i) => {
        for (let j = i; j !== -1; j = b.boneParents[j]) if (j === r) { bones.add(i); break; }
      });
      c = { bones, weight: Float64Array.from({ length: b.vertexCount }, (_, v) => b.weightOfBones(v, (bi) => bones.has(bi))) };
      this.chains.set(root, c);
    }
    return c;
  }

  apply(shape: BodyShape): BodyShape {
    const positions = Float64Array.from(shape.positions);
    const joints = Float64Array.from(shape.joints);
    const b = this.body;
    const bone = (label: string) => b.boneLabels.indexOf(label);
    const joint = (label: string): V3 => [joints[3 * bone(label)], joints[3 * bone(label) + 1], joints[3 * bone(label) + 2]];

    /** Rotate everything weighted to the chain about pivot; its joints rotate rigidly. */
    const rotate = (root: string, pivot: V3, R: M3) => {
      const { bones, weight } = this.chain(root);
      for (let v = 0; v < b.vertexCount; v++) {
        const w = weight[v];
        if (w === 0) continue;
        const p: V3 = [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
        const q = apply(R, sub(p, pivot));
        for (let k = 0; k < 3; k++) positions[3 * v + k] = p[k] + w * (pivot[k] + q[k] - p[k]);
      }
      for (const j of bones) {
        const q = apply(R, sub([joints[3 * j], joints[3 * j + 1], joints[3 * j + 2]], pivot));
        for (let k = 0; k < 3; k++) joints[3 * j + k] = pivot[k] + q[k];
      }
    };

    const a = (this.armDegrees * Math.PI) / 180;
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? 1 : -1;
      // Arm: swing the whole arm down, then straighten the elbow along the same line.
      const armDir: V3 = [sign * Math.sin(a), -Math.cos(a), 0];
      let pivot = joint(`upperarm01.${side}`);
      rotate(`shoulder01.${side}`, pivot, rotationBetween(unit(sub(joint(`lowerarm01.${side}`), pivot)), armDir));
      pivot = joint(`lowerarm01.${side}`);
      rotate(`lowerarm01.${side}`, pivot, rotationBetween(unit(sub(joint(`wrist.${side}`), pivot)), armDir));

      // Leg: thigh vertical, then shank vertical (straight knee), then the foot keeps its original orientation.
      const down: V3 = [0, -1, 0];
      pivot = joint(`upperleg01.${side}`);
      const R1 = rotationBetween(unit(sub(joint(`lowerleg01.${side}`), pivot)), down);
      rotate(`upperleg01.${side}`, pivot, R1);
      pivot = joint(`lowerleg01.${side}`);
      const R2 = rotationBetween(unit(sub(joint(`foot.${side}`), pivot)), down);
      rotate(`lowerleg01.${side}`, pivot, R2);
      rotate(`foot.${side}`, joint(`foot.${side}`), transpose(mul(R2, R1)));
    }
    return { positions, joints };
  }
}

/** 3x3 matrix helpers, exported for the tests. */
export { mul as matMul, transpose as matTranspose, apply as matApply };
