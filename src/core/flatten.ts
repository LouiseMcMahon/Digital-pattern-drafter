import { type Mesh, type Vec3, cross, dot, getVertex, len, normalize, sub, triangleCount, vertexCount, vertexNormals } from './mesh';
import { lscm } from './lscm';
import { type EaseField, scalesAt, sortedField } from './ease';

export interface FlattenOptions {
  ease: EaseField;
  up?: Vec3;
  iterations?: number;
  /** How strongly the panel's border edges are held to their true length, against 1 for the inside (default 30). */
  borderWeight?: number;
}

export interface FlattenResult {
  /** xy-interleaved 2D positions (cm). */
  uv: Float64Array;
  /** Root-mean-square error of flat edge lengths against the eased 3D lengths, as a fraction of those lengths (length-weighted). */
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

export function flatten(mesh: Mesh, options: FlattenOptions): FlattenResult {
  const opts = { ...options, ease: sortedField(options.ease) };
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
    const s = scalesAt(opts.ease, ymid);
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
  // Scale to the body's own edge lengths, then by the mean ease so the solver starts close.
  // (A global axis-aligned scale cannot flip anything.)
  let cur = 0;
  let base = 0;
  for (let k = 0; k < ea.length; k++) {
    cur += Math.hypot(uv[2 * eb[k]] - uv[2 * ea[k]], uv[2 * eb[k] + 1] - uv[2 * ea[k] + 1]);
    base += len(sub(getVertex(mesh, eb[k]), getVertex(mesh, ea[k])));
  }
  let sh = 0;
  let sv = 0;
  for (let i = 0; i < n; i++) {
    const s = scalesAt(opts.ease, getVertex(mesh, i)[1]);
    sh += s.horizontal / n;
    sv += s.vertical / n;
  }
  for (let i = 0; i < n; i++) {
    uv[2 * i] *= (base / cur) * sh;
    uv[2 * i + 1] *= (base / cur) * sv;
  }

  // As-rigid-as-possible refinement (Liu et al. 2008, "local-global"). Each triangle has a target shape in the plane,
  // built from its eased edge lengths. Alternate: (local) turn each target shape to best fit the current layout;
  // (global) move every vertex so the layout fits all those turned shapes in the least-squares sense, which is one
  // sparse symmetric solve. The result depends only on the surface and the ease, not on how the mesh happens to
  // be cut into triangles or which vertex comes first, so mirrored surfaces flatten to mirrored panels.
  const edgeTarget = new Map<number, number>();
  for (let k = 0; k < ea.length; k++) edgeTarget.set(ea[k] < eb[k] ? ea[k] * n + eb[k] : eb[k] * n + ea[k], target[k]);
  const lengthOf = (a: number, b: number) => edgeTarget.get(a < b ? a * n + b : b * n + a)!;
  const nt = triangleCount(mesh);
  const rest = new Float64Array(nt * 6); // target 2D shape of each triangle: x0 y0 x1 y1 x2 y2
  const cot = new Float64Array(nt * 3); // weight of edge (1,2), (2,0), (0,1): the cotangent of the opposite angle
  for (let t = 0; t < nt; t++) {
    const [i, j, k] = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    const [a, b, c] = [lengthOf(i, j), lengthOf(i, k), lengthOf(j, k)]; // |ij|, |ik|, |jk|
    const x = (a * a + b * b - c * c) / (2 * a);
    const y = Math.sqrt(Math.max(b * b - x * x, (1e-4 * a) ** 2)); // a triangle that cannot close is flattened to a sliver, not NaN
    rest.set([0, 0, a, 0, x, y], 6 * t);
    const p = [[0, 0], [a, 0], [x, y]];
    for (let q = 0; q < 3; q++) {
      const o = p[q];
      const u = p[(q + 1) % 3];
      const v = p[(q + 2) % 3];
      const du: [number, number] = [u[0] - o[0], u[1] - o[1]];
      const dv: [number, number] = [v[0] - o[0], v[1] - o[1]];
      cot[3 * t + ((q + 1) % 3)] = Math.max(1e-3, (du[0] * dv[0] + du[1] * dv[1]) / Math.abs(du[0] * dv[1] - du[1] * dv[0])); // angle at o weights the edge opposite it
    }
  }
  // Edges on the border of the panel (used by one triangle) are pinned to their eased 3D length: a seam must be as
  // long on the flat as on the body, so the panel next to it (which shares the seam) matches. A curved surface cannot
  // lie flat, so the strain goes into the inside of the panel instead, where the edge-length error shows it.
  const uses = new Map<number, number>();
  for (let t = 0; t < nt; t++) for (let q = 0; q < 3; q++) {
    const [a, b] = [mesh.triangles[3 * t + q], mesh.triangles[3 * t + ((q + 1) % 3)]];
    const key = a < b ? a * n + b : b * n + a;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const border: { a: number; b: number; length: number }[] = [];
  for (const [key, count] of uses) if (count === 1) { const [a, b] = [Math.floor(key / n), key % n]; border.push({ a, b, length: lengthOf(a, b) }); }
  const BORDER_END = opts.borderWeight ?? 1000; // against cotangent weights of about 1
  let BORDER_WEIGHT = BORDER_END;
  const tri = mesh.triangles;
  const applyL = (v: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let t = 0; t < nt; t++) {
      for (let q = 0; q < 3; q++) {
        const [a, b] = [tri[3 * t + ((q + 1) % 3)], tri[3 * t + ((q + 2) % 3)]];
        const f = cot[3 * t + ((q + 1) % 3)] * (v[a] - v[b]);
        out[a] += f;
        out[b] -= f;
      }
    }
    for (const e of border) {
      const f = BORDER_WEIGHT * (v[e.a] - v[e.b]);
      out[e.a] += f;
      out[e.b] -= f;
    }
  };
  const iterations = opts.iterations ?? 40;
  const settled = 2e-3; // stop when no vertex moves more than this (cm, 0.02 mm) in a step
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  const solve = (x: Float64Array, rhs: Float64Array) => {
    const r = new Float64Array(n);
    const p = new Float64Array(n);
    const Ap = new Float64Array(n);
    applyL(x, Ap);
    for (let i = 0; i < n; i++) { r[i] = rhs[i] - Ap[i]; p[i] = r[i]; }
    let rs = r.reduce((s2, v) => s2 + v * v, 0);
    const stop = 1e-10 * (rhs.reduce((s2, v) => s2 + v * v, 0) + 1e-30);
    for (let it = 0; it < 100 && rs > stop; it++) {
      applyL(p, Ap);
      const pAp = p.reduce((s2, v, i) => s2 + v * Ap[i], 0);
      if (!(pAp > 0)) break;
      const alpha = rs / pAp;
      let rsNew = 0;
      for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rsNew += r[i] * r[i]; }
      for (let i = 0; i < n; i++) p[i] = r[i] + (rsNew / rs) * p[i];
      rs = rsNew;
    }
  };
  for (let i = 0; i < n; i++) { X[i] = uv[2 * i]; Y[i] = uv[2 * i + 1]; }
  for (let it = 0; it < iterations; it++) {
    // Start with the border held loosely and tighten it step by step, so the layout adapts without folding over.
    BORDER_WEIGHT = BORDER_END * Math.pow(0.03, Math.max(0, 1 - it / Math.max(1, iterations * 0.6)));
    bx.fill(0);
    by.fill(0);
    for (let t = 0; t < nt; t++) {
      const id = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]];
      // Local step: the rotation that best maps the target shape's edges onto the current edges.
      let s00 = 0, s01 = 0, s10 = 0, s11 = 0;
      for (let q = 0; q < 3; q++) {
        const [a, b] = [(q + 1) % 3, (q + 2) % 3];
        const w = cot[3 * t + a];
        const [rx, ry] = [rest[6 * t + 2 * a] - rest[6 * t + 2 * b], rest[6 * t + 2 * a + 1] - rest[6 * t + 2 * b + 1]];
        const [cx, cy] = [X[id[a]] - X[id[b]], Y[id[a]] - Y[id[b]]];
        s00 += w * rx * cx; s01 += w * ry * cx; s10 += w * rx * cy; s11 += w * ry * cy;
      }
      const ang = Math.atan2(s10 - s01, s00 + s11);
      const [co, si] = [Math.cos(ang), Math.sin(ang)];
      for (let q = 0; q < 3; q++) {
        const [a, b] = [(q + 1) % 3, (q + 2) % 3];
        const w = cot[3 * t + a];
        const [rx, ry] = [rest[6 * t + 2 * a] - rest[6 * t + 2 * b], rest[6 * t + 2 * a + 1] - rest[6 * t + 2 * b + 1]];
        const [vx, vy] = [w * (co * rx - si * ry), w * (si * rx + co * ry)];
        bx[id[a]] += vx; by[id[a]] += vy;
        bx[id[b]] -= vx; by[id[b]] -= vy;
      }
    }
    for (const e of border) {
      // A border edge wants its true length in whatever direction it currently points.
      const [dx, dy] = [X[e.a] - X[e.b], Y[e.a] - Y[e.b]];
      const norm = Math.hypot(dx, dy) || 1;
      const [vx, vy] = [(BORDER_WEIGHT * e.length * dx) / norm, (BORDER_WEIGHT * e.length * dy) / norm];
      bx[e.a] += vx; by[e.a] += vy;
      bx[e.b] -= vx; by[e.b] -= vy;
    }
    // Global step. The system fixes the layout only up to a shift, so keep the centre where it was.
    const before = { x: Float64Array.from(X), y: Float64Array.from(Y) };
    const [mx, my] = [X.reduce((s2, v) => s2 + v, 0) / n, Y.reduce((s2, v) => s2 + v, 0) / n];
    solve(X, bx);
    solve(Y, by);
    const [nx, ny] = [X.reduce((s2, v) => s2 + v, 0) / n, Y.reduce((s2, v) => s2 + v, 0) / n];
    let moved = 0;
    for (let i = 0; i < n; i++) {
      X[i] += mx - nx;
      Y[i] += my - ny;
      moved = Math.max(moved, Math.hypot(X[i] - before.x[i], Y[i] - before.y[i]));
    }
    if (moved < settled) break;
  }
  for (let i = 0; i < n; i++) { uv[2 * i] = X[i]; uv[2 * i + 1] = Y[i]; }

  // Holding the border to its true length can fold a thin triangle just inside it. Untangle: move the inside vertices
  // of any folded triangle toward the average of their neighbours (a Laplacian step keeps a vertex among them).
  const onBorder = new Uint8Array(n);
  for (const e of border) { onBorder[e.a] = 1; onBorder[e.b] = 1; }
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  for (let k = 0; k < ea.length; k++) { neighbours[ea[k]].push(eb[k]); neighbours[eb[k]].push(ea[k]); }
  for (let pass = 0; pass < 100; pass++) {
    const fold = new Set<number>();
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]];
      if ((uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1]) < 0) for (const v of [a, b, c]) if (!onBorder[v]) fold.add(v);
    }
    if (fold.size === 0) break;
    for (const v of fold) {
      const ns = neighbours[v];
      uv[2 * v] = ns.reduce((s, q) => s + uv[2 * q], 0) / ns.length;
      uv[2 * v + 1] = ns.reduce((s, q) => s + uv[2 * q + 1], 0) / ns.length;
    }
  }

  // Length-weighted, so a handful of very short edges (a seam passing close to a vertex) cannot dominate the figure.
  let se = 0;
  let tt = 0;
  for (let k = 0; k < ea.length; k++) {
    const d = Math.hypot(uv[2 * eb[k]] - uv[2 * ea[k]], uv[2 * eb[k] + 1] - uv[2 * ea[k] + 1]);
    se += (d - target[k]) ** 2;
    tt += target[k] ** 2;
  }

  const flipped = countFlips(mesh, uv);
  return { uv, rmsEdgeError: Math.sqrt(se / tt), flippedTriangles: flipped };
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

/**
 * Triangles whose flat orientation disagrees with their (outward) 3D winding. A fold smaller than 5% of an average
 * triangle is not counted: holding a seam to its true length on a curved surface can leave a sliver on the border
 * folded by a tenth of a millimetre, which does not change the panel.
 */
function countFlips(mesh: Mesh, uv: Float64Array): number {
  const areas: number[] = [];
  for (let t = 0; t < triangleCount(mesh); t++) {
    const [a, b, c] = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    areas.push((uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1]));
  }
  const tolerance = (0.05 * areas.reduce((s, v) => s + Math.abs(v), 0)) / Math.max(1, areas.length);
  return areas.filter((v) => v < -tolerance).length;
}
