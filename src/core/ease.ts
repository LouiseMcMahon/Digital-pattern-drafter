/**
 * Ease is a target scale applied to the body's own lengths when flattening:
 *   horizontal scale = (C + e) / C   (e = ease in cm over the full circumference)
 *   vertical scale   = (L + e) / L   (e as a fraction of the local vertical length)
 * Scale < 1 is negative ease: the pattern is smaller than the body and the
 * fabric has to stretch by 1/scale - 1 to fit.
 */
export interface EaseKnot {
  /** Height (cm) this knot applies at. */
  y: number;
  /** Total circumference ease in cm (negative = tighter than the body). */
  horizontalCm: number;
  /** Vertical ease as a fraction of length (-0.05 = pattern 5% shorter than the body). */
  vertical: number;
}

export interface EaseField {
  knots: EaseKnot[];
}

export const uniformEase = (horizontalCm: number, vertical: number): EaseField => ({
  knots: [{ y: 0, horizontalCm, vertical }],
});

function lerpKnots(knots: EaseKnot[], y: number, prop: 'horizontalCm' | 'vertical'): number {
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

/** Scale factors at height y given the body circumference there. */
export function scalesAt(field: EaseField, y: number, circumference: number) {
  return {
    horizontal: (circumference + lerpKnots(field.knots, y, 'horizontalCm')) / circumference,
    vertical: 1 + lerpKnots(field.knots, y, 'vertical'),
  };
}

export interface Fabric {
  name: string;
  /** Max comfortable stretch as a fraction (0.5 = 50%) along the weft (horizontal) and warp (vertical). */
  maxStretchH: number;
  maxStretchV: number;
}

export const fabrics: Fabric[] = [
  { name: 'Woven (no stretch)', maxStretchH: 0.0, maxStretchV: 0.0 },
  { name: 'Stretch woven', maxStretchH: 0.15, maxStretchV: 0.05 },
  { name: 'Cotton jersey', maxStretchH: 0.5, maxStretchV: 0.25 },
  { name: '4-way lycra', maxStretchH: 0.8, maxStretchV: 0.6 },
  { name: 'Latex (0.4mm)', maxStretchH: 1.0, maxStretchV: 1.0 },
];
