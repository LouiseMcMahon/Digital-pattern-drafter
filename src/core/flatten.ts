import { type Mesh, type Vec3, cross, dot, getVertex, len, normalize, sub, triangleCount, vertexCount, vertexNormals } from './mesh';
import { lscm } from './lscm';
import { type EaseField, type Fabric, scalesAt } from './ease';

export interface FlattenOptions {
  ease: EaseField;
  /** Circumference of the body at height y (cm); needed to turn ease cm into a scale. */
  circumferenceAt: (y: number) => number;
  up?: Vec3;
  iterations?: number;
}

export interface FlattenResult {
  /** xy-interleaved 2D positions (cm). */
  uv: Float64Array;
  /** RMS error of flat edge lengths vs eased 3D targets, relative. */
  rmsEdgeError: number;
  flippedTriangles: number;
}

/**
 * Local frame on the surface: horizontal follows the weft (perpendicular to
 * `up` in the tangent plane), vertical follows the warp.
 */
function frame(normal: Vec3, up: Vec3): { h: Vec3; v: Vec3 } {
  let h = normalize(cross(up, normal));
  if (h[0] === 0 && h[1] === 0 && h[2] === 0) h = [1, 0, 0];
  return { h, v: normalize(cross(normal, h)) };
}

export function flatten(mesh: Mesh, opts: FlattenOptions): FlattenResult {
  const up = opts.up ?? [0, 1, 0];
  const n = vertexCount(mesh);
  const normals = vertexNormals(mesh);

  // Unique edges with eased target lengths.
  const seen = new Set<number>();
  const ea: number[] = [];
  const eb: number[] = [];
  const target: number[] = [];
  const addEdge = (a: number, b: number) => {
    const key = a < b ? a * n + b : b * n + a;
    if (seen.has(key)) return;
    seen.add(key);
    const pa = getVertex(mesh, a);
    const pb = getVertex(mesh, b);
    const e = sub(pb, pa);
    const nm = normalize([normals[a][0] + normals[b][0], normals[a][1] + normals[b][1], normals[a][2] + normals[b][2]]);
    const { h, v } = frame(nm, up);
    const dh = dot(e, h);
    const dv = dot(e, v);
    const rest = Math.max(0, dot(e, e) - dh * dh - dv * dv);
    const ymid = (pa[1] + pb[1]) / 2;
    const s = scalesAt(opts.ease, ymid, opts.circumferenceAt(ymid));
    ea.push(a);
    eb.push(b);
    target.push(Math.sqrt((s.horizontal * dh) ** 2 + (s.vertical * dv) ** 2 + rest));
  };
  for (let t = 0; t < triangleCount(mesh); t++) {
    const [a, b, c] = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  // Initial layout: conformal unwrap, rotated so +y follows the body's up axis,
  // mirrored if needed so it reads as seen from outside, scaled to the target edge lengths.
  const uv = lscm(mesh);
  alignToUp(mesh, uv, up);
  if (countFlips(mesh, uv) > triangleCount(mesh) / 2) for (let i = 0; i < n; i++) uv[2 * i] = -uv[2 * i];
  let cur = 0;
  let want = 0;
  for (let k = 0; k < ea.length; k++) {
    cur += Math.hypot(uv[2 * eb[k]] - uv[2 * ea[k]], uv[2 * eb[k] + 1] - uv[2 * ea[k] + 1]);
    want += target[k];
  }
  for (let i = 0; i < uv.length; i++) uv[i] *= want / cur;

  // Gauss-Seidel edge-length projection (position-based dynamics without time).
  const iterations = opts.iterations ?? 600;
  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < ea.length; k++) {
      const a = ea[k];
      const b = eb[k];
      const dx = uv[2 * b] - uv[2 * a];
      const dy = uv[2 * b + 1] - uv[2 * a + 1];
      const d = Math.hypot(dx, dy) || 1e-12;
      const corr = (0.5 * (d - target[k])) / d;
      uv[2 * a] += dx * corr;
      uv[2 * a + 1] += dy * corr;
      uv[2 * b] -= dx * corr;
      uv[2 * b + 1] -= dy * corr;
    }
  }

  let se = 0;
  for (let k = 0; k < ea.length; k++) {
    const d = Math.hypot(uv[2 * eb[k]] - uv[2 * ea[k]], uv[2 * eb[k] + 1] - uv[2 * ea[k] + 1]);
    se += ((d - target[k]) / target[k]) ** 2;
  }

  const flipped = countFlips(mesh, uv);
  return { uv, rmsEdgeError: Math.sqrt(se / ea.length), flippedTriangles: flipped };
}

/** Rotate the layout so +y follows the 3D up axis (centred on its centroid). */
function alignToUp(mesh: Mesh, uv: Float64Array, up: Vec3) {
  const n = vertexCount(mesh);
  let mu = 0, mv = 0, mh = 0;
  const hgt = (i: number) => dot(getVertex(mesh, i), up);
  for (let i = 0; i < n; i++) { mu += uv[2 * i]; mv += uv[2 * i + 1]; mh += hgt(i); }
  mu /= n; mv /= n; mh /= n;
  let gx = 0, gy = 0;
  for (let i = 0; i < n; i++) {
    const w = hgt(i) - mh;
    gx += w * (uv[2 * i] - mu);
    gy += w * (uv[2 * i + 1] - mv);
  }
  const ang = Math.PI / 2 - Math.atan2(gy, gx);
  const [c, s] = [Math.cos(ang), Math.sin(ang)];
  for (let i = 0; i < n; i++) {
    const x = uv[2 * i] - mu;
    const y = uv[2 * i + 1] - mv;
    uv[2 * i] = c * x - s * y;
    uv[2 * i + 1] = s * x + c * y;
  }
}

/** Triangles whose flat orientation disagrees with their (outward) 3D winding. */
function countFlips(mesh: Mesh, uv: Float64Array): number {
  let flipped = 0;
  for (let t = 0; t < triangleCount(mesh); t++) {
    const [a, b, c] = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    const area2 = (uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1]);
    if (area2 < 0) flipped++;
  }
  return flipped;
}

export interface StretchReport {
  /** Worst stretch the fabric must give (fraction), measured pattern -> body. */
  maxH: number;
  maxV: number;
  fabricOk: boolean;
}

/**
 * How far each triangle of the flat pattern must stretch to reach the body,
 * measured along the weft and warp directions.
 */
export function stretchDemand(mesh: Mesh, uv: Float64Array, fabric: Fabric, up: Vec3 = [0, 1, 0]): StretchReport {
  const normals = vertexNormals(mesh);
  let maxH = -Infinity;
  let maxV = -Infinity;
  for (let t = 0; t < triangleCount(mesh); t++) {
    const idx = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    const [pa, pb, pc] = idx.map((i) => getVertex(mesh, i));
    const e1 = sub(pb, pa);
    const e2 = sub(pc, pa);
    const nm = normalize(normals[idx[0]].map((_, k) => normals[idx[0]][k] + normals[idx[1]][k] + normals[idx[2]][k]) as Vec3);
    const { h, v } = frame(nm, up);
    const f1: [number, number] = [uv[2 * idx[1]] - uv[2 * idx[0]], uv[2 * idx[1] + 1] - uv[2 * idx[0] + 1]];
    const f2: [number, number] = [uv[2 * idx[2]] - uv[2 * idx[0]], uv[2 * idx[2] + 1] - uv[2 * idx[0] + 1]];
    // Express a 3D tangent direction d as a*e1 + b*e2 (least squares), then map to flat as a*f1 + b*f2.
    const g11 = dot(e1, e1);
    const g12 = dot(e1, e2);
    const g22 = dot(e2, e2);
    const det = g11 * g22 - g12 * g12;
    if (Math.abs(det) < 1e-12) continue;
    const stretchAlong = (d: Vec3) => {
      const r1 = dot(d, e1);
      const r2 = dot(d, e2);
      const a = (r1 * g22 - r2 * g12) / det;
      const b = (r2 * g11 - r1 * g12) / det;
      const flat = Math.hypot(a * f1[0] + b * f2[0], a * f1[1] + b * f2[1]);
      const real = len([a * e1[0] + b * e2[0], a * e1[1] + b * e2[1], a * e1[2] + b * e2[2]]);
      return flat > 1e-9 ? real / flat - 1 : 0;
    };
    maxH = Math.max(maxH, stretchAlong(h));
    maxV = Math.max(maxV, stretchAlong(v));
  }
  return { maxH, maxV, fabricOk: maxH <= fabric.maxStretchH + 1e-6 && maxV <= fabric.maxStretchV + 1e-6 };
}
