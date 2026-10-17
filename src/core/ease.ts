/**
 * Ease is a percentage applied to the body's own lengths when flattening:
 *   scale = 1 + percent / 100
 * independently along the horizontal (weft) and vertical (warp) directions.
 * Negative percent makes the pattern smaller than the body (for stretch fabric).
 */
export interface EaseKnot {
  /** Height (cm) this knot applies at. */
  y: number;
  /** Horizontal ease, percent (-10 = pattern 10% narrower than the body). */
  horizontal: number;
  /** Vertical ease, percent. */
  vertical: number;
}

export interface EaseField {
  knots: EaseKnot[];
}

export const uniformEase = (horizontal: number, vertical: number): EaseField => ({
  knots: [{ y: 0, horizontal, vertical }],
});

function lerpKnots(knots: EaseKnot[], y: number, prop: 'horizontal' | 'vertical'): number {
  const ks = [...knots].sort((a, b) => a.y - b.y);
  if (ks.length === 0) return 0;
  if (y <= ks[0].y) return ks[0][prop];
  if (y >= ks[ks.length - 1].y) return ks[ks.length - 1][prop];
  let i = 0;
  while (y > ks[i + 1].y) i++;
  const t = (y - ks[i].y) / (ks[i + 1].y - ks[i].y);
  const s = t * t * (3 - 2 * t); // smoothstep, so ease changes don't kink the pattern
  return ks[i][prop] * (1 - s) + ks[i + 1][prop] * s;
}

/** Scale factors at height y. */
export function scalesAt(field: EaseField, y: number) {
  return {
    horizontal: 1 + lerpKnots(field.knots, y, 'horizontal') / 100,
    vertical: 1 + lerpKnots(field.knots, y, 'vertical') / 100,
  };
}
