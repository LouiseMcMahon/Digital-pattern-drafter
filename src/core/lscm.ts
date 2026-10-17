import { type Mesh, type Vec3, cross, dot, getVertex, len, normalize, sub, triangleCount, vertexCount } from './mesh';

/**
 * Least-squares conformal map (Levy et al. 2002) of a disk-like patch.
 * Two far-apart vertices are pinned; the rest is a sparse least-squares solve
 * done with conjugate gradients on the normal equations.
 * Output has arbitrary rotation/mirroring/scale; the caller normalises it.
 */
export function lscm(mesh: Mesh): Float64Array {
  const n = vertexCount(mesh);
  const nt = triangleCount(mesh);

  // Rows: for each triangle two real equations over (u,v) of its 3 vertices.
  const rowIdx = new Int32Array(nt * 2 * 6);
  const rowVal = new Float64Array(nt * 2 * 6);
  for (let t = 0; t < nt; t++) {
    const ids = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    const [p1, p2, p3] = ids.map((i) => getVertex(mesh, i));
    // Local orthonormal frame of the triangle.
    const e1 = sub(p2, p1);
    const ex = normalize(e1);
    const nrm = normalize(cross(e1, sub(p3, p1)));
    const ey = cross(nrm, ex);
    const loc = [p1, p2, p3].map((p) => {
      const d = sub(p, p1);
      return [dot(d, ex), dot(d, ey)];
    });
    const dT = (loc[1][0] - loc[0][0]) * (loc[2][1] - loc[0][1]) - (loc[1][1] - loc[0][1]) * (loc[2][0] - loc[0][0]);
    const s = 1 / Math.sqrt(Math.abs(dT) || 1e-12);
    const W = [
      [loc[2][0] - loc[1][0], loc[2][1] - loc[1][1]],
      [loc[0][0] - loc[2][0], loc[0][1] - loc[2][1]],
      [loc[1][0] - loc[0][0], loc[1][1] - loc[0][1]],
    ].map(([a, b]) => [a * s, b * s]);
    for (let j = 0; j < 3; j++) {
      // Row A: Wre*u - Wim*v ; Row B: Wim*u + Wre*v
      const a = (2 * t) * 6 + 2 * j;
      const b = (2 * t + 1) * 6 + 2 * j;
      rowIdx[a] = 2 * ids[j]; rowVal[a] = W[j][0];
      rowIdx[a + 1] = 2 * ids[j] + 1; rowVal[a + 1] = -W[j][1];
      rowIdx[b] = 2 * ids[j]; rowVal[b] = W[j][1];
      rowIdx[b + 1] = 2 * ids[j] + 1; rowVal[b + 1] = W[j][0];
    }
  }

  // Pin two far-apart vertices.
  const pos = (i: number): Vec3 => getVertex(mesh, i);
  const far = (from: number) => {
    let best = 0;
    let bd = -1;
    for (let i = 0; i < n; i++) {
      const d = len(sub(pos(i), pos(from)));
      if (d > bd) { bd = d; best = i; }
    }
    return best;
  };
  const pa = far(far(0));
  const pb = far(pa);
  const D = len(sub(pos(pa), pos(pb)));
  const x = new Float64Array(2 * n);
  const pinned = new Uint8Array(2 * n);
  x[2 * pb] = D; // pa stays at the origin (x starts zeroed); both pins sit on the u axis
  for (const i of [pa, pb]) { pinned[2 * i] = 1; pinned[2 * i + 1] = 1; }

  const apply = (v: Float64Array, out: Float64Array) => {
    for (let r = 0; r < nt * 2; r++) {
      let acc = 0;
      for (let k = 0; k < 6; k++) acc += rowVal[r * 6 + k] * v[rowIdx[r * 6 + k]];
      out[r] = acc;
    }
  };
  const applyT = (r: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let q = 0; q < nt * 2; q++) for (let k = 0; k < 6; k++) out[rowIdx[q * 6 + k]] += rowVal[q * 6 + k] * r[q];
    for (let i = 0; i < out.length; i++) if (pinned[i]) out[i] = 0;
  };

  // rhs = -M_f^T (M_p x_p), then CG on M_f^T M_f.
  const tmpR = new Float64Array(nt * 2);
  const b = new Float64Array(2 * n);
  apply(x, tmpR);
  for (let i = 0; i < tmpR.length; i++) tmpR[i] = -tmpR[i];
  applyT(tmpR, b);

  const sol = new Float64Array(2 * n);
  const r = Float64Array.from(b);
  const p = Float64Array.from(r);
  const Ap = new Float64Array(2 * n);
  let rs = r.reduce((s, v) => s + v * v, 0);
  const rs0 = rs;
  for (let it = 0; it < 4000 && rs > 1e-18 * (rs0 + 1e-30); it++) {
    apply(p, tmpR);
    applyT(tmpR, Ap);
    const pAp = p.reduce((s, v, i) => s + v * Ap[i], 0);
    if (pAp <= 0) break;
    const alpha = rs / pAp;
    let rsNew = 0;
    for (let i = 0; i < 2 * n; i++) {
      sol[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
      rsNew += r[i] * r[i];
    }
    const beta = rsNew / rs;
    for (let i = 0; i < 2 * n; i++) p[i] = r[i] + beta * p[i];
    rs = rsNew;
  }
  for (let i = 0; i < 2 * n; i++) if (!pinned[i]) x[i] = sol[i];
  return x;
}
