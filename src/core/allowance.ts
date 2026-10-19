export type Pt = [number, number];

/** Signed area of a polygon (cm²): positive when the points run anticlockwise. */
export function signedArea(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const [a, b] = [p[i], p[(i + 1) % p.length]]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** A corner sharper than this many times the offset would poke out a long spike, so it is cut off (bevelled) instead. */
export const MITER_LIMIT = 2;

/**
 * The outline moved outwards by `distance` (cm; negative moves it inwards): the cutting line round a pattern piece
 * for a seam allowance. Corners are mitred, or bevelled when sharp. Repeated points are dropped first. The offset
 * of a very concave piece by more than its notches are wide can cross itself: seam allowances are a few cm at most.
 */
export function offsetOutline(points: readonly Pt[], distance: number): Pt[] {
  const p = points.filter((q, i) => { const n = points[(i + 1) % points.length]; return Math.hypot(n[0] - q[0], n[1] - q[1]) > 1e-9; });
  if (p.length < 3) return p.map((q) => [...q] as Pt);
  const side = signedArea(p) >= 0 ? 1 : -1; // outward is to the right of travel for an anticlockwise outline
  const normal = (a: Pt, b: Pt): Pt => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(side * (b[1] - a[1])) / l, (-side * (b[0] - a[0])) / l];
  };
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const [prev, here, next] = [p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length]];
    const [n0, n1] = [normal(prev, here), normal(here, next)];
    const c = n0[0] * n1[0] + n0[1] * n1[1];
    if (1 + c > 1e-9 && Math.sqrt(2 / (1 + c)) <= MITER_LIMIT) {
      out.push([here[0] + (distance * (n0[0] + n1[0])) / (1 + c), here[1] + (distance * (n0[1] + n1[1])) / (1 + c)]);
    } else {
      out.push([here[0] + distance * n0[0], here[1] + distance * n0[1]], [here[0] + distance * n1[0], here[1] + distance * n1[1]]);
    }
  }
  return out;
}
