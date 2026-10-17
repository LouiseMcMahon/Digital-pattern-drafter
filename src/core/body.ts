import type { Mesh } from './mesh';

/**
 * Procedural torso built from tape measurements. Licence-clean (no scanned
 * body-model data), so the app can be published freely.
 *
 * Coordinates are cm: x = left/right, y = up (waist at 0), z = front.
 * The torso is a loft of superellipse rings whose perimeters equal the
 * measured circumferences at each landmark height.
 */
export interface Measurements {
  /** Full circumferences, cm. */
  bust: number;
  waist: number;
  hip: number;
  /** Landmark heights relative to the waist (cm, up positive). */
  bustHeight: number;
  hipHeight: number; // negative
  /** Top of the bodice (neck-base level) and hem. */
  topHeight: number;
  hemHeight: number; // negative
  /** Depth/width ratio of the cross-section at bust, waist, hip. */
  depthRatio: { bust: number; waist: number; hip: number };
}

export const defaultMeasurements: Measurements = {
  bust: 92,
  waist: 74,
  hip: 98,
  bustHeight: 25,
  hipHeight: -20,
  topHeight: 40,
  hemHeight: -25,
  depthRatio: { bust: 0.72, waist: 0.68, hip: 0.66 },
};

const EXPONENT = 2.6; // >2 squares the ellipse slightly, closer to a real torso

function superellipsePerimeter(a: number, b: number, n = EXPONENT, samples = 720): number {
  let p = 0;
  let prev = ringPoint(a, b, 0, n);
  for (let i = 1; i <= samples; i++) {
    const cur = ringPoint(a, b, (2 * Math.PI * i) / samples, n);
    p += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
  return p;
}

function ringPoint(a: number, b: number, t: number, n = EXPONENT): [number, number] {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [a * Math.sign(c) * Math.abs(c) ** (2 / n), b * Math.sign(s) * Math.abs(s) ** (2 / n)];
}

/** Semi-axes (half-width a, half-depth b) with the given perimeter and depth/width ratio. */
export function semiAxes(circumference: number, depthRatio: number): [number, number] {
  const unit = superellipsePerimeter(1, depthRatio);
  const a = circumference / unit;
  return [a, a * depthRatio];
}

interface Knot {
  y: number;
  circ: number;
  ratio: number;
}

function knots(m: Measurements): Knot[] {
  const k: Knot[] = [
    { y: m.hemHeight, circ: m.hip * 0.97, ratio: m.depthRatio.hip },
    { y: m.hipHeight, circ: m.hip, ratio: m.depthRatio.hip },
    { y: 0, circ: m.waist, ratio: m.depthRatio.waist },
    { y: m.bustHeight, circ: m.bust, ratio: m.depthRatio.bust },
    { y: m.topHeight, circ: m.bust * 0.9, ratio: m.depthRatio.bust * 0.9 },
  ];
  return k.sort((p, q) => p.y - q.y);
}

/** Smooth (Catmull-Rom style, non-uniform) interpolation of a knot property at height y. */
function interpolate(ks: Knot[], y: number, prop: 'circ' | 'ratio'): number {
  if (y <= ks[0].y) return ks[0][prop];
  if (y >= ks[ks.length - 1].y) return ks[ks.length - 1][prop];
  let i = 0;
  while (y > ks[i + 1].y) i++;
  const [p0, p1] = [ks[i], ks[i + 1]];
  const h = p1.y - p0.y;
  const slope = (a: Knot, b: Knot) => (b[prop] - a[prop]) / (b.y - a.y);
  const m0 = i > 0 ? 0.5 * (slope(ks[i - 1], p0) + slope(p0, p1)) : slope(p0, p1);
  const m1 = i + 2 < ks.length ? 0.5 * (slope(p0, p1) + slope(p1, ks[i + 2])) : slope(p0, p1);
  const t = (y - p0.y) / h;
  const [t2, t3] = [t * t, t * t * t];
  return (
    (2 * t3 - 3 * t2 + 1) * p0[prop] + (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * p1[prop] + (t3 - t2) * h * m1
  );
}

export function circumferenceAt(m: Measurements, y: number): number {
  return interpolate(knots(m), y, 'circ');
}

export interface TorsoGrid {
  mesh: Mesh;
  rows: number;
  /** Vertices per row (ring is split at the two side seams, so this covers one half). */
  cols: number;
  /** Row heights (cm). */
  ys: number[];
}

/**
 * Front half of the torso (side seam to side seam, through centre front)
 * as a regular grid: row r (bottom to top) x col c (right side seam -> left side seam).
 */
export function buildFrontTorso(m: Measurements, rows = 41, cols = 33): TorsoGrid {
  const ks = knots(m);
  const positions = new Float64Array(rows * cols * 3);
  const ys: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = m.hemHeight + ((m.topHeight - m.hemHeight) * r) / (rows - 1);
    ys.push(y);
    const [a, b] = semiAxes(interpolate(ks, y, 'circ'), interpolate(ks, y, 'ratio'));
    for (let c = 0; c < cols; c++) {
      const t = (Math.PI * c) / (cols - 1); // 0..pi covers z >= 0
      const [x, z] = ringPoint(a, b, t);
      const i = r * cols + c;
      positions[3 * i] = x;
      positions[3 * i + 1] = y;
      positions[3 * i + 2] = z;
    }
  }
  const tris: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      // Winding gives outward normals (+z at centre front).
      tris.push(i, i + cols, i + 1, i + 1, i + cols, i + cols + 1);
    }
  }
  return { mesh: { positions, triangles: new Uint32Array(tris) }, rows, cols, ys };
}
