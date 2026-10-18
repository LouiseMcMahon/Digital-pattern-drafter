import type { Mesh, Vec3 } from './mesh';
import { type Seam, closestSurfacePoint } from './seam';

/** What a princess seam runs through. The rings are the waist and hip lines as xyz points; x is the wearer's left, z the front. */
export interface PrincessInputs {
  shoulder: Vec3;
  apex: Vec3;
  waistRing: ArrayLike<number>;
  hipRing: ArrayLike<number>;
}

/**
 * Where a ring crosses the vertical plane x = `x` on the front of the body (the front-most crossing), or if it never
 * does, its front point nearest that plane. Returns undefined for an empty ring.
 */
export function ringPointAtX(ring: ArrayLike<number>, x: number): Vec3 | undefined {
  const pts: Vec3[] = [];
  for (let i = 0; i + 2 < ring.length; i += 3) pts.push([ring[i], ring[i + 1], ring[i + 2]]);
  if (pts.length === 0) return undefined;
  let best: Vec3 | undefined;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
    const t = (x - a[0]) / (b[0] - a[0]);
    const at: Vec3 = [x, a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
    if (!best || at[2] > best[2]) best = at;
  }
  if (best) return best;
  const zs = pts.map((p) => p[2]);
  const middle = (Math.min(...zs) + Math.max(...zs)) / 2;
  return pts.filter((p) => p[2] >= middle).reduce((p, q) => (Math.abs(q[0] - x) < Math.abs(p[0] - x) ? q : p));
}

/**
 * A princess seam: from the shoulder point over the bust apex, then straight down the front to the waist line and on
 * to the hip line, each directly below the apex. Four control points; the paths between them are found on the surface.
 */
export function princessSeam(m: Mesh, inputs: PrincessInputs): Seam {
  const waist = ringPointAtX(inputs.waistRing, inputs.apex[0]);
  const hip = ringPointAtX(inputs.hipRing, inputs.apex[0]);
  if (!waist || !hip) throw new Error('The waist and hip lines are needed to draw a princess seam');
  const place = (p: Vec3) => { const { tri, bary } = closestSurfacePoint(m, p); return { tri, bary }; };
  return { points: [inputs.shoulder, inputs.apex, waist, hip].map(place), closed: false };
}
