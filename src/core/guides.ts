import type { Vec3 } from './mesh';
import type { SnapTarget } from './seam';

/** The circumference lines of the body a seam is usually drawn through, and what to call them. */
export const GUIDE_RINGS: { measurement: string; label: string }[] = [
  { measurement: 'highBust', label: 'high bust' },
  { measurement: 'bust', label: 'bust' },
  { measurement: 'underbust', label: 'underbust' },
  { measurement: 'waist', label: 'waist' },
  { measurement: 'highHip', label: 'high hip' },
  { measurement: 'hip', label: 'hip' },
];

/**
 * The four places a horizontal line round the body is usually crossed by a vertical seam: centre front, centre back
 * and the two sides. `ring` is the line as xyz points; x is the wearer's left, z the front (the app's axes).
 */
export function ringLandmarks(label: string, ring: ArrayLike<number>): SnapTarget[] {
  const pts: Vec3[] = [];
  for (let i = 0; i + 2 < ring.length; i += 3) pts.push([ring[i], ring[i + 1], ring[i + 2]]);
  if (pts.length === 0) return [];
  const zs = pts.map((p) => p[2]);
  const middle = (Math.min(...zs) + Math.max(...zs)) / 2;
  const pick = (candidates: Vec3[], score: (p: Vec3) => number) => candidates.reduce((best, p) => (score(p) < score(best) ? p : best));
  const front = pts.filter((p) => p[2] >= middle);
  const back = pts.filter((p) => p[2] < middle);
  const out: SnapTarget[] = [];
  if (front.length) out.push({ name: `${label} line, centre front`, point: pick(front, (p) => Math.abs(p[0])) });
  if (back.length) out.push({ name: `${label} line, centre back`, point: pick(back, (p) => Math.abs(p[0])) });
  out.push({ name: `${label} line, left side`, point: pick(pts, (p) => -p[0]) });
  out.push({ name: `${label} line, right side`, point: pick(pts, (p) => p[0]) });
  return out;
}

/**
 * Centre front and centre back as lines up the body: where the plane x = 0 cuts the surface, sampled every `step` cm
 * from `yBottom` to each line's own top (the front line stops at the neck base, the back line at the nape).
 * Each sample takes the front-most (or back-most) cut at that height, which keeps it on the trunk.
 */
export function centreLines(
  positions: ArrayLike<number>, triangles: ArrayLike<number>, yBottom: number, frontTop: number, backTop: number, step = 0.5,
): { name: string; points: number[] }[] {
  const frontZ = new Map<number, number>();
  const backZ = new Map<number, number>();
  const at = (i: number): Vec3 => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const top = Math.max(frontTop, backTop);
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const v = [at(triangles[t]), at(triangles[t + 1]), at(triangles[t + 2])];
    const cuts: Vec3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      if ((a[0] < 0) === (b[0] < 0) || a[0] === b[0]) continue;
      const s = -a[0] / (b[0] - a[0]);
      cuts.push([0, a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])]);
    }
    if (cuts.length !== 2) continue;
    const [p, q] = cuts;
    const lo = Math.max(yBottom, Math.min(p[1], q[1])), hi = Math.min(top, Math.max(p[1], q[1]));
    for (let j = Math.ceil(lo / step); j * step <= hi; j++) {
      const y = j * step;
      const s = q[1] === p[1] ? 0 : (y - p[1]) / (q[1] - p[1]);
      const z = p[2] + s * (q[2] - p[2]);
      if (y <= frontTop) frontZ.set(j, Math.max(frontZ.get(j) ?? -Infinity, z));
      if (y <= backTop) backZ.set(j, Math.min(backZ.get(j) ?? Infinity, z));
    }
  }
  const line = (zs: Map<number, number>) => [...zs.keys()].sort((a, b) => a - b).flatMap((j) => [0, j * step, zs.get(j)!]);
  return [{ name: 'centre front line', points: line(frontZ) }, { name: 'centre back line', points: line(backZ) }].filter((l) => l.points.length >= 6);
}
