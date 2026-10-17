import type { Mesh } from './mesh';

/**
 * Procedural torso built from tape measurements. Licence-clean (no scanned
 * body-model data), so the app can be published freely.
 *
 * Coordinates are cm: x = wearer's left (+), y = up (waist at 0), z = front.
 * The torso is a loft of rings. Each ring is two half super-ellipses (front and
 * back depth can differ) sharing the same half-width, so side seams always sit
 * at z = 0. Ring perimeters are fitted to the measured circumferences by
 * reading them back off the generated mesh (bust bump included).
 */
export interface Measurements {
  /** Full circumferences, cm. */
  bust: number;
  underbust: number;
  waist: number;
  hip: number;
  /** Chest above the bust, at armpit level. */
  chest: number;
  neck: number;
  /** Across the shoulder points, cm. */
  shoulderWidth: number;
  /** Distance between bust apexes and how far each protrudes beyond the ring, cm. */
  bustApexSeparation: number;
  bustProminence: number;
  /** Landmark heights relative to the waist (cm, up positive). */
  hemHeight: number;
  hipHeight: number;
  underbustHeight: number;
  bustHeight: number;
  chestHeight: number;
  shoulderHeight: number;
  neckBaseHeight: number;
  neckTopHeight: number;
  /** Depth/width ratio of the cross-section at bust, waist, hip. */
  depthRatio: { bust: number; waist: number; hip: number };
}

export const defaultMeasurements: Measurements = {
  bust: 92,
  underbust: 78,
  waist: 74,
  hip: 98,
  chest: 88,
  neck: 37,
  shoulderWidth: 39,
  bustApexSeparation: 19,
  bustProminence: 5,
  hemHeight: -25,
  hipHeight: -20,
  underbustHeight: 13,
  bustHeight: 24,
  chestHeight: 29,
  shoulderHeight: 37,
  neckBaseHeight: 41.5,
  neckTopHeight: 47,
  depthRatio: { bust: 0.72, waist: 0.68, hip: 0.66 },
};

const EXPONENT = 2.6; // >2 squares the ellipse slightly, closer to a real torso

/** Point on a unit super-ellipse; t = 0 is +x, pi/2 is +z (front). */
function ringPoint(a: number, b: number, t: number): [number, number] {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [a * Math.sign(c) * Math.abs(c) ** (2 / EXPONENT), b * Math.sign(s) * Math.abs(s) ** (2 / EXPONENT)];
}

function halfPerimeter(a: number, b: number, samples = 360): number {
  let p = 0;
  let prev = ringPoint(a, b, 0);
  for (let i = 1; i <= samples; i++) {
    const cur = ringPoint(a, b, (Math.PI * i) / samples);
    p += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
  return p;
}

interface Axes {
  a: number; // half width
  bf: number; // front depth
  bb: number; // back depth
}

interface RingSpec {
  name: string;
  y: number;
  /** total depth / width */
  ratio: number;
  /** fraction of the depth that is in front of the side seams */
  frontFrac: number;
  /** Fit to this circumference... */
  circ?: number;
  /** ...or fix the half width (shoulders). */
  halfWidth?: number;
}

function baseAxes(r: RingSpec): Axes {
  const unit: Axes = r.halfWidth
    ? { a: r.halfWidth, bf: 2 * r.halfWidth * r.ratio * r.frontFrac, bb: 2 * r.halfWidth * r.ratio * (1 - r.frontFrac) }
    : { a: 1, bf: 2 * r.ratio * r.frontFrac, bb: 2 * r.ratio * (1 - r.frontFrac) };
  if (r.halfWidth) return unit;
  const k = r.circ! / (halfPerimeter(unit.a, unit.bf) + halfPerimeter(unit.a, unit.bb));
  return { a: unit.a * k, bf: unit.bf * k, bb: unit.bb * k };
}

function rings(m: Measurements): RingSpec[] {
  const { bust, waist, hip } = m.depthRatio;
  const under = (waist + bust) / 2;
  return [
    { name: 'hem', y: m.hemHeight, ratio: hip, frontFrac: 0.48, circ: m.hip * 0.97 },
    { name: 'hip', y: m.hipHeight, ratio: hip, frontFrac: 0.46, circ: m.hip },
    { name: 'waist', y: 0, ratio: waist, frontFrac: 0.5, circ: m.waist },
    { name: 'underbust', y: m.underbustHeight, ratio: under, frontFrac: 0.5, circ: m.underbust },
    { name: 'bust', y: m.bustHeight, ratio: bust, frontFrac: 0.54, circ: m.bust },
    { name: 'chest', y: m.chestHeight, ratio: bust, frontFrac: 0.5, circ: m.chest },
    { name: 'shoulder', y: m.shoulderHeight, ratio: 0.4, frontFrac: 0.45, halfWidth: m.shoulderWidth / 2 },
    { name: 'neckBase', y: m.neckBaseHeight, ratio: 0.95, frontFrac: 0.5, circ: m.neck },
    { name: 'neckTop', y: m.neckTopHeight, ratio: 0.95, frontFrac: 0.5, circ: m.neck },
  ].sort((p, q) => p.y - q.y);
}

/** Monotone cubic (Fritsch-Carlson) interpolation: smooth, never overshoots the knots. */
function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const h = xs.slice(1).map((x, i) => x - xs[i]);
  const d = ys.slice(1).map((y, i) => (y - ys[i]) / h[i]);
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const [t2, t3] = [t * t, t * t * t];
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface Landmark {
  name: string;
  /** Vertex of the torso mesh this landmark sits on. */
  vertex: number;
}

export interface Torso {
  mesh: Mesh;
  rows: number;
  /** Vertices per ring. Column c is at angle 2*pi*c/cols, so 0 = wearer's left side, cols/4 = centre front, cols/2 = right side, 3*cols/4 = centre back. */
  cols: number;
  ys: number[];
  /** Row index of each named ring (hem, hip, waist, underbust, bust, chest, shoulder, neckBase, neckTop). */
  rowOf: Record<string, number>;
  landmarks: Landmark[];
  /** Triangle ids of the front half (side seam to side seam via centre front) and the back half. */
  frontTriangles: number[];
  backTriangles: number[];
}

const vid = (cols: number, r: number, c: number) => r * cols + (((c % cols) + cols) % cols);

function generate(m: Measurements, scale: Record<string, number>, rowsPerCm: number, cols: number) {
  const specs = rings(m);
  const axes = specs.map((s) => {
    const b = baseAxes(s);
    const k = scale[s.name] ?? 1;
    return { a: b.a * k, bf: b.bf * k, bb: b.bb * k };
  });
  const yk = specs.map((s) => s.y);
  const fa = pchip(yk, axes.map((x) => x.a));
  const ff = pchip(yk, axes.map((x) => x.bf));
  const fb = pchip(yk, axes.map((x) => x.bb));

  // Row heights: every ring height is a row, with extra rows in between.
  const ys: number[] = [];
  const rowOf: Record<string, number> = {};
  specs.forEach((s, i) => {
    rowOf[s.name] = ys.length;
    ys.push(s.y);
    if (i + 1 < specs.length) {
      const steps = Math.max(2, Math.round((specs[i + 1].y - s.y) * rowsPerCm));
      for (let q = 1; q < steps; q++) ys.push(s.y + ((specs[i + 1].y - s.y) * q) / steps);
    }
  });

  const rows = ys.length;
  const positions = new Float64Array(rows * cols * 3);
  for (let r = 0; r < rows; r++) {
    const y = ys[r];
    const [a, bf, bb] = [fa(y), ff(y), fb(y)];
    for (let c = 0; c < cols; c++) {
      const t = (2 * Math.PI * c) / cols;
      const [x, z] = ringPoint(a, Math.sin(t) >= 0 ? bf : bb, t);
      let zz = z;
      if (z > 0) {
        // Bust bump on the front, centred on each apex.
        for (const sign of [1, -1]) {
          const dx = x - (sign * m.bustApexSeparation) / 2;
          const dy = y - m.bustHeight;
          zz += m.bustProminence * Math.exp(-(dx * dx) / (2 * 5 * 5) - (dy * dy) / (2 * 5 * 5)) * smoothstep(0.3, 0.7, z / bf);
        }
      }
      positions.set([x, y, zz], 3 * (r * cols + c));
    }
  }
  return { positions, rows, ys, rowOf, specs };
}

function rowPerimeter(positions: Float64Array, cols: number, r: number): number {
  let p = 0;
  for (let c = 0; c < cols; c++) {
    const a = vid(cols, r, c);
    const b = vid(cols, r, c + 1);
    p += Math.hypot(positions[3 * b] - positions[3 * a], positions[3 * b + 1] - positions[3 * a + 1], positions[3 * b + 2] - positions[3 * a + 2]);
  }
  return p;
}

export function buildTorso(m: Measurements, opts: { rowsPerCm?: number; cols?: number } = {}): Torso {
  const rowsPerCm = opts.rowsPerCm ?? 0.6;
  const cols = opts.cols ?? 64;

  // Fit: rescale each circumference ring until the mesh reads back the tape measurement.
  const scale: Record<string, number> = {};
  let g = generate(m, scale, rowsPerCm, cols);
  for (let it = 0; it < 6; it++) {
    for (const s of g.specs) {
      if (!s.circ) continue;
      const measured = rowPerimeter(g.positions, cols, g.rowOf[s.name]);
      scale[s.name] = (scale[s.name] ?? 1) * (s.circ / measured);
    }
    g = generate(m, scale, rowsPerCm, cols);
  }

  const tris: number[] = [];
  const frontTriangles: number[] = [];
  const backTriangles: number[] = [];
  for (let r = 0; r < g.rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      // Winding gives outward normals.
      const i = vid(cols, r, c);
      const j = vid(cols, r, c + 1);
      const t0 = tris.length / 3;
      tris.push(i, i + cols, j, j, i + cols, j + cols);
      (c < cols / 2 ? frontTriangles : backTriangles).push(t0, t0 + 1);
    }
  }

  const mesh: Mesh = { positions: g.positions, triangles: new Uint32Array(tris) };
  const landmarks: Landmark[] = [];
  for (const [name, r] of Object.entries(g.rowOf)) {
    landmarks.push(
      { name: `${name}.left`, vertex: vid(cols, r, 0) },
      { name: `${name}.frontCentre`, vertex: vid(cols, r, cols / 4) },
      { name: `${name}.right`, vertex: vid(cols, r, cols / 2) },
      { name: `${name}.backCentre`, vertex: vid(cols, r, (3 * cols) / 4) },
    );
  }
  // Bust apexes: the front vertex on the bust row closest to x = +-separation/2.
  const br = g.rowOf.bust;
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    let best = vid(cols, br, cols / 4);
    let bd = Infinity;
    for (let c = 1; c < cols / 2; c++) {
      const v = vid(cols, br, c);
      const d = Math.abs(mesh.positions[3 * v] - (sign * m.bustApexSeparation) / 2);
      if (d < bd) { bd = d; best = v; }
    }
    landmarks.push({ name: `bustApex.${side}`, vertex: best });
  }

  return { mesh, rows: g.rows, cols, ys: g.ys, rowOf: g.rowOf, landmarks, frontTriangles, backTriangles };
}

/** Circumference of the generated torso at a named ring (tape-measure read-back). */
export function measureRing(t: Torso, name: string): number {
  return rowPerimeter(t.mesh.positions, t.cols, t.rowOf[name]);
}
