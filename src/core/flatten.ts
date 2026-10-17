import { type Mesh, type Vec3, cross, dot, getVertex, len, normalize, sub, triangleCount, vertexCount, vertexNormals } from './mesh';
import { lscm } from './lscm';
import { type EaseField, scalesAt } from './ease';

export interface FlattenOptions {
  ease: EaseField;
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

  // Per-vertex Gauss-Seidel stress minimisation (edge-length targets). Each vertex moves
  // toward the average of the positions its neighbours ask for, but a move is backtracked
  // if it would flip an incident triangle, so a flip-free start stays flip-free.
  const nbrStart = new Int32Array(n + 1);
  for (let k = 0; k < ea.length; k++) { nbrStart[ea[k] + 1]++; nbrStart[eb[k] + 1]++; }
  for (let i = 0; i < n; i++) nbrStart[i + 1] += nbrStart[i];
  const fill = nbrStart.slice(0, n);
  const nbr = new Int32Array(2 * ea.length);
  const nbrT = new Float64Array(2 * ea.length);
  for (let k = 0; k < ea.length; k++) {
    nbr[fill[ea[k]]] = eb[k]; nbrT[fill[ea[k]]++] = target[k];
    nbr[fill[eb[k]]] = ea[k]; nbrT[fill[eb[k]]++] = target[k];
  }
  const triStart = new Int32Array(n + 1);
  for (let k = 0; k < mesh.triangles.length; k++) triStart[mesh.triangles[k] + 1]++;
  for (let i = 0; i < n; i++) triStart[i + 1] += triStart[i];
  const tfill = triStart.slice(0, n);
  const incident = new Int32Array(mesh.triangles.length);
  for (let t = 0; t < triangleCount(mesh); t++) for (let k = 0; k < 3; k++) incident[tfill[mesh.triangles[3 * t + k]]++] = t;

  const area2 = (t: number, vi: number, x: number, y: number) => {
    const ids = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    const px = ids.map((id) => (id === vi ? x : uv[2 * id]));
    const py = ids.map((id) => (id === vi ? y : uv[2 * id + 1]));
    return (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
  };
  const iterations = opts.iterations ?? 600;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const deg = nbrStart[i + 1] - nbrStart[i];
      if (deg === 0) continue;
      let dx = 0;
      let dy = 0;
      const [xi, yi] = [uv[2 * i], uv[2 * i + 1]];
      for (let q = nbrStart[i]; q < nbrStart[i + 1]; q++) {
        const j = nbr[q];
        const ex = xi - uv[2 * j];
        const ey = yi - uv[2 * j + 1];
        const d = Math.hypot(ex, ey) || 1e-12;
        dx += uv[2 * j] + (nbrT[q] * ex) / d;
        dy += uv[2 * j + 1] + (nbrT[q] * ey) / d;
      }
      dx = dx / deg - xi;
      dy = dy / deg - yi;
      for (let alpha = 1; alpha > 0.1; alpha *= 0.5) {
        const [nx, ny] = [xi + alpha * dx, yi + alpha * dy];
        let ok = true;
        for (let q = triStart[i]; q < triStart[i + 1] && ok; q++) {
          const t = incident[q];
          // Don't reject moves in triangles that were already flipped, only new flips.
          if (area2(t, i, nx, ny) <= 1e-9 && area2(t, i, xi, yi) > 0) ok = false;
        }
        if (ok) { uv[2 * i] = nx; uv[2 * i + 1] = ny; break; }
      }
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
