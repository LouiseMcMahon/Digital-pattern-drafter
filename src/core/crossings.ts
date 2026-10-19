import { type Mesh, type Vec3, dot, len, sub } from './mesh';
import { type Seam, type SurfacePoint, SurfaceGraph, closestSurfacePoint, pointOnSurface } from './seam';

/** Two paths this close (cm) cross. Paths on a surface cross exactly within a triangle, so this only has to absorb rounding. */
export const CROSSING_TOLERANCE = 1e-5;
/** A control point this close (cm) to a crossing is the crossing: it is reused, not doubled. */
export const SHARED_RADIUS = 0.05;

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * The closest points of two segments (Ericson, Real-Time Collision Detection 5.1.9), as parameters along each.
 * Undefined for parallel segments, which have no single crossing (seams that run together are cut as shared edges).
 */
export function closestOnSegments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { s: number; t: number; distance: number } | undefined {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  if (a < 1e-18 || e < 1e-18) return undefined;
  const b = dot(d1, d2);
  const c = dot(d1, r);
  const f = dot(d2, r);
  const denom = a * e - b * b;
  if (denom <= 1e-9 * a * e) return undefined;
  let s = clamp01((b * f - c * e) / denom);
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp01(-c / a); }
  else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
  return { s, t, distance: len(sub(lerp(p1, q1, s), lerp(p2, q2, t))) };
}

const samePoint = (a: SurfacePoint, b: SurfacePoint) => a.tri === b.tri && a.bary.every((w, k) => Math.abs(w - b.bary[k]) < 1e-9);

/** Index of the control point of a seam within SHARED_RADIUS of a place, or -1. */
function controlPointAt(m: Mesh, seam: Seam, at: Vec3): number {
  let best = -1;
  let bd = SHARED_RADIUS;
  seam.points.forEach((p, i) => {
    const d = len(sub(pointOnSurface(m, p), at));
    if (d <= bd) { bd = d; best = i; }
  });
  return best;
}

interface Crossing { a: number; legA: number; b: number; legB: number; at: Vec3 }

/** The first place where the path of one seam crosses or touches the path of another that is not already a shared control point. */
function firstCrossing(m: Mesh, seams: readonly Seam[], legs: number[][][]): Crossing | undefined {
  for (let a = 0; a < seams.length; a++) for (let b = a + 1; b < seams.length; b++) {
    for (let la = 0; la < legs[a].length; la++) for (let lb = 0; lb < legs[b].length; lb++) {
      const [pa, pb] = [legs[a][la], legs[b][lb]];
      for (let i = 0; i + 5 < pa.length; i += 3) for (let j = 0; j + 5 < pb.length; j += 3) {
        const hit = closestOnSegments(
          [pa[i], pa[i + 1], pa[i + 2]], [pa[i + 3], pa[i + 4], pa[i + 5]],
          [pb[j], pb[j + 1], pb[j + 2]], [pb[j + 3], pb[j + 4], pb[j + 5]],
        );
        if (!hit || hit.distance > CROSSING_TOLERANCE) continue;
        const at = lerp([pa[i], pa[i + 1], pa[i + 2]], [pa[i + 3], pa[i + 4], pa[i + 5]], hit.s);
        const [ia, ib] = [controlPointAt(m, seams[a], at), controlPointAt(m, seams[b], at)];
        if (ia >= 0 && ib >= 0 && samePoint(seams[a].points[ia], seams[b].points[ib])) continue; // already a shared point
        return { a, legA: la, b, legB: lb, at };
      }
    }
  }
  return undefined;
}

/**
 * Makes seams that cross, or that end on or touch each other, meet at a control point both hold, which is what cutting
 * the mesh needs (a seam can only be a panel side from one control point to the next). A control point already at the
 * crossing is reused; otherwise a new one is put on both paths there, which does not change either path.
 * Changes the seams in place; returns how many crossings it joined. A seam is not joined to itself.
 */
export function splitCrossings(m: Mesh, graph: SurfaceGraph, seams: Seam[], maxJoins = 200): number {
  const legs = seams.map((s) => graph.seamLegs(m.positions as Float64Array, s));
  let joined = 0;
  while (joined < maxJoins) {
    const c = firstCrossing(m, seams, legs);
    if (!c) break;
    const [A, B] = [seams[c.a], seams[c.b]];
    const [ia, ib] = [controlPointAt(m, A, c.at), controlPointAt(m, B, c.at)];
    if (ia >= 0 && ib >= 0) {
      B.points[ib] = A.points[ia]; // two nearby points of their own: one place
    } else if (ia >= 0) {
      B.points.splice(c.legB + 1, 0, A.points[ia]);
    } else if (ib >= 0) {
      A.points.splice(c.legA + 1, 0, B.points[ib]);
    } else {
      const { tri, bary } = closestSurfacePoint(m, c.at);
      A.points.splice(c.legA + 1, 0, { tri, bary });
      B.points.splice(c.legB + 1, 0, { tri, bary: [...bary] });
    }
    legs[c.a] = graph.seamLegs(m.positions as Float64Array, A);
    legs[c.b] = graph.seamLegs(m.positions as Float64Array, B);
    joined++;
  }
  return joined;
}
