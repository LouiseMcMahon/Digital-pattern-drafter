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
