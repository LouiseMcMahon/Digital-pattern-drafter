import { type Mesh, type Vec3, getVertex, len, normalize, sub, triangleCount, vertexCount, vertexNormals } from './mesh';
import { closestBary } from './seam';

/**
 * Closest-point queries against a triangle mesh (the body), sped up with a uniform grid. Gives the signed distance of
 * a point to the surface (negative inside), using the smooth interpolated normal at the closest point to tell
 * which side the point is on.
 */
export class SurfaceField {
  private readonly origin: Vec3;
  private readonly dims: [number, number, number];
  private readonly cells = new Map<number, number[]>();
  private readonly normals: Vec3[];
  private readonly stamp: Int32Array;
  private query = 0;
  private readonly box: Float64Array; // per triangle: min xyz, max xyz

  constructor(private readonly mesh: Mesh, private readonly cell = 2) {
    const n = vertexCount(mesh);
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.positions[3 * v + k]); hi[k] = Math.max(hi[k], mesh.positions[3 * v + k]); }
    this.origin = lo;
    this.dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - lo[k]) / cell) + 1)) as [number, number, number];
    this.normals = vertexNormals(mesh);
    this.stamp = new Int32Array(triangleCount(mesh)).fill(-1);
    this.box = new Float64Array(6 * triangleCount(mesh));
    for (let t = 0; t < triangleCount(mesh); t++) {
      const pts = [0, 1, 2].map((k) => getVertex(mesh, mesh.triangles[3 * t + k]));
      for (let k = 0; k < 3; k++) { this.box[6 * t + k] = Math.min(pts[0][k], pts[1][k], pts[2][k]); this.box[6 * t + 3 + k] = Math.max(pts[0][k], pts[1][k], pts[2][k]); }
      const a = [0, 1, 2].map((k) => Math.floor((Math.min(pts[0][k], pts[1][k], pts[2][k]) - lo[k]) / cell));
      const b = [0, 1, 2].map((k) => Math.floor((Math.max(pts[0][k], pts[1][k], pts[2][k]) - lo[k]) / cell));
      for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
        const key = this.key(x, y, z);
        const list = this.cells.get(key);
        if (list) list.push(t); else this.cells.set(key, [t]);
      }
    }
  }

  private key(x: number, y: number, z: number) { return x + this.dims[0] * (y + this.dims[1] * z); }

  /** The closest point on the surface to p, its smooth outward normal, and the signed distance (negative inside). */
  closest(p: Vec3): { point: Vec3; normal: Vec3; signed: number } {
    const c = [0, 1, 2].map((k) => Math.floor((p[k] - this.origin[k]) / this.cell));
    const query = ++this.query;
    let best = Infinity;
    let bestTri = -1;
    let bestBary: Vec3 = [1, 0, 0];
    const maxRing = Math.max(...this.dims) + 2 + Math.max(0, ...c.map((v, k) => Math.max(-v, v - this.dims[k])));
    for (let r = 0; r <= maxRing; r++) {
      if (bestTri >= 0 && best <= (r - 1) * this.cell) break;
      for (let x = c[0] - r; x <= c[0] + r; x++) for (let y = c[1] - r; y <= c[1] + r; y++) for (let z = c[2] - r; z <= c[2] + r; z++) {
        if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== r) continue;
        if (x < 0 || y < 0 || z < 0 || x >= this.dims[0] || y >= this.dims[1] || z >= this.dims[2]) continue;
        for (const t of this.cells.get(this.key(x, y, z)) ?? []) {
          if (this.stamp[t] === query) continue;
          this.stamp[t] = query;
          // Skip triangles whose bounding box is already farther away than the best found.
          let box2 = 0;
          for (let k = 0; k < 3; k++) { const d = Math.max(this.box[6 * t + k] - p[k], p[k] - this.box[6 * t + 3 + k], 0); box2 += d * d; }
          if (box2 >= best * best) continue;
          const [va, vb, vc] = [0, 1, 2].map((k) => getVertex(this.mesh, this.mesh.triangles[3 * t + k]));
          const bary = closestBary(p, va, vb, vc);
          const d = len(sub([0, 1, 2].map((k) => bary[0] * va[k] + bary[1] * vb[k] + bary[2] * vc[k]) as Vec3, p));
          if (d < best) { best = d; bestTri = t; bestBary = bary; }
        }
      }
    }
    if (bestTri < 0) throw new Error('Mesh has no triangles');
    const ids = [0, 1, 2].map((k) => this.mesh.triangles[3 * bestTri + k]);
    const point = [0, 1, 2].map((k) => ids.reduce((s, v, i) => s + bestBary[i] * this.mesh.positions[3 * v + k], 0)) as Vec3;
    const normal = normalize([0, 1, 2].map((k) => ids.reduce((s, v, i) => s + bestBary[i] * this.normals[v][k], 0)) as Vec3);
    const off = sub(p, point);
    const sign = off[0] * normal[0] + off[1] * normal[1] + off[2] * normal[2] >= 0 ? 1 : -1;
    return { point, normal, signed: sign * best };
  }
}
