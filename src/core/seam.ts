import { type Mesh, type Vec3, cross, dot, getVertex, len, sub } from './mesh';

/**
 * A point on the surface of a mesh, stored as a triangle and barycentric weights (a, b, c for the
 * triangle's three vertices, summing to 1). It follows the surface when the body is edited, because
 * the topology does not change: only the vertex positions do.
 */
export interface SurfacePoint {
  tri: number;
  bary: Vec3;
}

/** A seam is a chain of control points; the path between them is recomputed from the surface. */
export interface Seam {
  points: SurfacePoint[];
  closed: boolean;
}

export function pointOnSurface(m: Mesh, p: SurfacePoint): Vec3 {
  const [a, b, c] = [0, 1, 2].map((k) => getVertex(m, m.triangles[3 * p.tri + k]));
  return [0, 1, 2].map((k) => p.bary[0] * a[k] + p.bary[1] * b[k] + p.bary[2] * c[k]) as Vec3;
}

/** Nearest hit of a ray on the mesh (Moller-Trumbore, both faces), or undefined. t is the distance along `dir`. */
export function raycast(m: Mesh, origin: Vec3, dir: Vec3): (SurfacePoint & { t: number }) | undefined {
  let best: (SurfacePoint & { t: number }) | undefined;
  for (let tri = 0; tri < m.triangles.length / 3; tri++) {
    const a = getVertex(m, m.triangles[3 * tri]);
    const e1 = sub(getVertex(m, m.triangles[3 * tri + 1]), a);
    const e2 = sub(getVertex(m, m.triangles[3 * tri + 2]), a);
    const h = cross(dir, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(origin, a);
    const u = dot(s, h) / det;
    if (u < 0) continue; // (u > 1 is caught by u + v > 1 below, since v >= 0)
    const q = cross(s, e1);
    const v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) / det;
    if (t > 0 && (!best || t < best.t)) best = { tri, bary: [1 - u - v, u, v], t };
  }
  return best;
}

/** The surface point at a vertex (the first triangle that uses it). */
export function vertexPoint(m: Mesh, vertex: number): SurfacePoint {
  const i = m.triangles.indexOf(vertex);
  if (i < 0) throw new Error(`Vertex ${vertex} is not used by any triangle`);
  const bary: Vec3 = [0, 0, 0];
  bary[i % 3] = 1;
  return { tri: Math.floor(i / 3), bary };
}

/**
 * If the point is within `radius` of a vertex, the surface point at that vertex; otherwise the point itself.
 * Lets a click land exactly on a landmark or on a seam that already ends there.
 */
export function snapToVertex(m: Mesh, p: SurfacePoint, radius: number): SurfacePoint {
  const at = pointOnSurface(m, p);
  let best = -1;
  let bd = radius;
  for (let k = 0; k < 3; k++) {
    const v = m.triangles[3 * p.tri + k];
    const d = len(sub(getVertex(m, v), at));
    if (d <= bd) { bd = d; best = v; }
  }
  return best < 0 ? p : vertexPoint(m, best);
}

/**
 * The point of triangle (a, b, c) closest to p, as barycentric weights (Ericson, Real-Time Collision Detection 5.1.5).
 * Works for p above or below the triangle, and clamps to an edge or corner when p projects outside.
 */
export function closestBary(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [0, 1 - w, w]; }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [1 - v - w, v, w];
}

/** The point on the mesh surface closest to a point in space, and how far away it is. */
export function closestSurfacePoint(m: Mesh, p: Vec3): SurfacePoint & { distance: number } {
  let best: (SurfacePoint & { distance: number }) | undefined;
  for (let tri = 0; tri < m.triangles.length / 3; tri++) {
    const [a, b, c] = [0, 1, 2].map((k) => getVertex(m, m.triangles[3 * tri + k]));
    const bary = closestBary(p, a, b, c);
    const q: Vec3 = [0, 1, 2].map((k) => bary[0] * a[k] + bary[1] * b[k] + bary[2] * c[k]) as Vec3;
    const distance = len(sub(q, p));
    if (!best || distance < best.distance) best = { tri, bary, distance };
  }
  if (!best) throw new Error('Mesh has no triangles');
  return best;
}

/** A named place a seam point can snap to (a landmark such as the neck point, or the end of another seam). */
export interface SnapTarget {
  name: string;
  point: Vec3;
}

/**
 * Snaps a surface point to the nearest target within `radius` (cm), else to a mesh vertex within `vertexRadius`,
 * else leaves it. Targets win over vertices because a landmark is rarely exactly on a vertex.
 */
export function snapPoint(m: Mesh, p: SurfacePoint, targets: readonly SnapTarget[], radius: number, vertexRadius = radius): { point: SurfacePoint; target?: string } {
  const at = pointOnSurface(m, p);
  let best: SnapTarget | undefined;
  let bd = radius;
  for (const t of targets) {
    const d = len(sub(t.point, at));
    if (d <= bd) { bd = d; best = t; }
  }
  if (best) return { point: closestSurfacePoint(m, best.point), target: best.name };
  return { point: snapToVertex(m, p, vertexRadius) };
}

/**
 * The control point (seam and index) nearest under a caller-supplied distance, within `radius`. The viewer measures
 * distance on screen (what the user sees), tests measure it in space.
 */
export function findControlPoint(m: Mesh, seams: readonly Seam[], distance: (point: Vec3) => number, radius: number): { seam: number; index: number } | undefined {
  let best: { seam: number; index: number } | undefined;
  let bd = radius;
  seams.forEach((seam, si) => seam.points.forEach((pt, i) => {
    const d = distance(pointOnSurface(m, pt));
    if (d <= bd) { bd = d; best = { seam: si, index: i }; }
  }));
  return best;
}

/** A place on the mesh: at a vertex, on the edge between two vertices (a < b) at fraction t from a, or inside a triangle. */
export type PathNode =
  | { kind: 'vertex'; vertex: number }
  | { kind: 'edge'; a: number; b: number; t: number }
  | { kind: 'face'; point: SurfacePoint };

/** Minimal binary min-heap of (key, node). */
export class Heap {
  private keys: number[] = [];
  private nodes: number[] = [];
  get size() { return this.keys.length; }
  peekKey() { return this.keys[0]; }
  push(key: number, node: number) {
    let i = this.keys.length;
    this.keys.push(key);
    this.nodes.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p]; this.nodes[i] = this.nodes[p];
      i = p;
    }
    this.keys[i] = key; this.nodes[i] = node;
  }
  pop(): [number, number] {
    const top: [number, number] = [this.keys[0], this.nodes[0]];
    const key = this.keys.pop()!;
    const node = this.nodes.pop()!;
    const n = this.keys.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.keys[c + 1] < this.keys[c]) c++;
        if (this.keys[c] >= key) break;
        this.keys[i] = this.keys[c]; this.nodes[i] = this.nodes[c];
        i = c;
      }
      this.keys[i] = key; this.nodes[i] = node;
    }
    return top;
  }
}

/**
 * Shortest paths over a mesh surface. The mesh edges are cut into `steiner + 1` pieces; every pair of points
 * on the boundary of one triangle is joined by a straight segment (which lies in that triangle), and Dijkstra
 * runs on that graph. With only mesh edges a path can be 10-15% too long and zigzags; with the extra points the
 * error is a few percent at the default of 3. The graph holds topology only: positions are passed per call, so
 * one graph serves every shape of the same mesh (the body after each fit).
 */
export class SurfaceGraph {
  private readonly nv: number;
  private readonly ntri: number;
  private readonly edgeVerts: number[] = []; // 2 per edge, smaller vertex first
  private readonly triEdges: Int32Array; // 3 per triangle: edge k joins its vertex k and k + 1
  private readonly edgeTris: number[][] = [];
  private readonly vertexTris: number[][];

  constructor(private readonly triangles: Uint32Array, vertexCount: number, private readonly steiner = 3) {
    this.nv = vertexCount;
    this.ntri = triangles.length / 3;
    this.triEdges = new Int32Array(3 * this.ntri);
    this.vertexTris = Array.from({ length: vertexCount }, () => []);
    const edgeOf = new Map<number, number>();
    for (let t = 0; t < this.ntri; t++) {
      for (let k = 0; k < 3; k++) {
        const a = triangles[3 * t + k];
        const b = triangles[3 * t + ((k + 1) % 3)];
        this.vertexTris[a].push(t);
        const key = Math.min(a, b) * vertexCount + Math.max(a, b);
        let e = edgeOf.get(key);
        if (e === undefined) {
          e = this.edgeTris.length;
          edgeOf.set(key, e);
          this.edgeVerts.push(Math.min(a, b), Math.max(a, b));
          this.edgeTris.push([]);
        }
        this.edgeTris[e].push(t);
        this.triEdges[3 * t + k] = e;
      }
    }
  }

  private position(pos: Float64Array, node: number): Vec3 {
    if (node < this.nv) return [pos[3 * node], pos[3 * node + 1], pos[3 * node + 2]];
    const rel = node - this.nv;
    const e = Math.floor(rel / this.steiner);
    const t = ((rel % this.steiner) + 1) / (this.steiner + 1);
    const [a, b] = [this.edgeVerts[2 * e], this.edgeVerts[2 * e + 1]];
    return [0, 1, 2].map((k) => pos[3 * a + k] + t * (pos[3 * b + k] - pos[3 * a + k])) as Vec3;
  }

  /** Every graph node on the boundary of a triangle: its 3 vertices and the Steiner points of its 3 edges. */
  private triangleNodes(t: number): number[] {
    const out = [this.triangles[3 * t], this.triangles[3 * t + 1], this.triangles[3 * t + 2]];
    for (let k = 0; k < 3; k++) for (let s = 0; s < this.steiner; s++) out.push(this.nv + this.triEdges[3 * t + k] * this.steiner + s);
    return out;
  }

  private trianglesAt(node: number): number[] {
    return node < this.nv ? this.vertexTris[node] : this.edgeTris[Math.floor((node - this.nv) / this.steiner)];
  }

  /** The graph nodes of the shortest route from a to b (see `path`); `straight` when one triangle holds both points. */
  private route(positions: Float64Array, a: SurfacePoint, b: SurfacePoint): number[] {
    const m: Mesh = { positions, triangles: this.triangles };
    const [pa, pb] = [pointOnSurface(m, a), pointOnSurface(m, b)];
    let best = a.tri === b.tri ? len(sub(pa, pb)) : Infinity;
    let bestLast = -1; // graph node the best route leaves from, or -1 for the straight segment
    const toTarget = new Map<number, number>();
    for (const n of this.triangleNodes(b.tri)) toTarget.set(n, len(sub(this.position(positions, n), pb)));

    const nodeCount = this.nv + this.edgeTris.length * this.steiner;
    const dist = new Float64Array(nodeCount).fill(Infinity);
    const prev = new Int32Array(nodeCount).fill(-1);
    const heap = new Heap();
    for (const n of this.triangleNodes(a.tri)) {
      const d = len(sub(this.position(positions, n), pa));
      if (d < dist[n]) { dist[n] = d; heap.push(d, n); }
    }
    while (heap.size > 0 && heap.peekKey() < best) {
      const [d, n] = heap.pop();
      if (d > dist[n]) continue;
      const tail = toTarget.get(n);
      if (tail !== undefined && d + tail < best) { best = d + tail; bestLast = n; }
      const here = this.position(positions, n);
      for (const t of this.trianglesAt(n)) {
        for (const o of this.triangleNodes(t)) {
          if (o === n) continue;
          const nd = d + len(sub(this.position(positions, o), here));
          if (nd < dist[o]) { dist[o] = nd; prev[o] = n; heap.push(nd, o); }
        }
      }
    }

    const nodes: number[] = [];
    for (let n = bestLast; n >= 0; n = prev[n]) nodes.push(n);
    return nodes.reverse();
  }

  /**
   * The shortest path over the surface from a to b, as an xyz polyline that starts at a and ends at b.
   * Its length is within a few percent of the true geodesic and never shorter than it.
   */
  path(positions: Float64Array, a: SurfacePoint, b: SurfacePoint): number[] {
    const m: Mesh = { positions, triangles: this.triangles };
    const out: number[] = [...pointOnSurface(m, a)];
    for (const n of this.route(positions, a, b)) out.push(...this.position(positions, n));
    out.push(...pointOnSurface(m, b));
    return out;
  }

  /**
   * The same path as `path`, as places on the mesh: the start, then each mesh vertex or point on a mesh edge it
   * passes through, then the end. Consecutive entries lie in one triangle, joined by a straight segment (this is what
   * cutting the mesh along a seam needs).
   */
  pathNodes(positions: Float64Array, a: SurfacePoint, b: SurfacePoint): PathNode[] {
    const mid = this.route(positions, a, b).map((n): PathNode => {
      if (n < this.nv) return { kind: 'vertex', vertex: n };
      const rel = n - this.nv;
      const e = Math.floor(rel / this.steiner);
      return { kind: 'edge', a: this.edgeVerts[2 * e], b: this.edgeVerts[2 * e + 1], t: ((rel % this.steiner) + 1) / (this.steiner + 1) };
    });
    return [{ kind: 'face', point: a }, ...mid, { kind: 'face', point: b }];
  }

  /** The polyline of a whole seam: the shortest path between each consecutive pair of control points. */
  seamPath(positions: Float64Array, seam: Seam): number[] {
    const out: number[] = [];
    const pts = seam.closed && seam.points.length > 2 ? [...seam.points, seam.points[0]] : seam.points;
    if (pts.length === 1) return [...pointOnSurface({ positions, triangles: this.triangles }, pts[0])];
    for (let i = 0; i + 1 < pts.length; i++) {
      const leg = this.path(positions, pts[i], pts[i + 1]);
      out.push(...(i === 0 ? leg : leg.slice(3)));
    }
    return out;
  }
}

export function polylineLength(points: ArrayLike<number>): number {
  let s = 0;
  for (let i = 3; i < points.length; i += 3) s += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
  return s;
}
