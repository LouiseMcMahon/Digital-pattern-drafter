import type { Mesh } from './mesh';
import { type Seam, type SurfacePoint, closestSurfacePoint, pointOnSurface } from './seam';

/** A point this close to the centre plane (x = 0, cm) is on the centre line: it is shared with its mirror image. */
export const CENTRE_TOLERANCE = 0.3;

/**
 * The surface point that mirrors `p` across the body's centre plane (x = 0). The body is left/right symmetric, so
 * this is the same place on the other side. A point on the centre line is its own mirror image and is returned as is,
 * so two seams meet exactly there.
 */
export function mirrorPoint(m: Mesh, p: SurfacePoint, tolerance = CENTRE_TOLERANCE): SurfacePoint {
  const at = pointOnSurface(m, p);
  if (Math.abs(at[0]) <= tolerance) return p;
  const { tri, bary } = closestSurfacePoint(m, [-at[0], at[1], at[2]]);
  return { tri, bary };
}

/** The mirror image of a seam, point for point in the same order. */
export function mirrorSeam(m: Mesh, seam: Seam, tolerance = CENTRE_TOLERANCE): Seam {
  return { points: seam.points.map((p) => mirrorPoint(m, p, tolerance)), closed: seam.closed };
}
