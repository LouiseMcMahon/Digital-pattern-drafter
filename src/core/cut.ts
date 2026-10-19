import { type Mesh, type Vec3, boundaryLoops, cross, dot, extractSubmesh, getVertex, len, normalize, sub, triangleCount } from './mesh';
import { type PathNode, type Seam, type SurfacePoint, SurfaceGraph, closestBary, pointOnSurface } from './seam';

/**
 * Cutting a mesh along seams, so a panel is a set of whole triangles.
 *
 * A seam path runs through the triangles of the body mesh (straight between points on triangle edges), so it does
 * not follow mesh edges. To make the seam a boundary, every triangle it touches is re-triangulated with the seam's
 * points as vertices and the seam's segments as edges; nothing else moves, so the surface (and its area) is
 * unchanged. The edges that lie on a seam are recorded, and a region is then a flood fill over triangles that
 * never crosses one.
 */
export interface CutMesh {
  /** The new mesh: the original vertices first, then the vertices added along the seams. */
  mesh: Mesh;
  /** For each new triangle, the triangle of the original mesh it was cut from. */
  parent: number[];
  /** Mesh edges that lie on a seam, as `min * vertexCount + max`. */
  seamEdges: Set<number>;
  /** For each seam edge, the seams (indices into the list given to cutMesh) it lies on: one, or more where seams run together. */
  seamsOfEdge: Map<number, number[]>;
  /** Vertices where a seam has a control point (including where seams meet): they stay put when the seams are pulled taut. */
  pins: Set<number>;
  /** The vertex a seam point became (for tests and display). */
  vertexCount: number;
}

type V2 = [number, number];
const EPS = 1e-6;
/** An interior point of the original triangle used as the fan centre. Not the centroid: seams commonly run along medians, and a centre on a seam would make a degenerate triangle. */
const FAN_CENTRE: Vec3 = [0.3711, 0.3257, 0.3032];

/** A node resolved to the mesh: its vertex id, and where it lives (for finding the triangle a segment is in). */
interface Resolved {
  vertex: number;
  /** Set when the point is an original mesh vertex. */
  original?: number;
  /** Set when the point is on the edge (a < b). */
  edge?: [number, number];
  /** Set when the point is inside a triangle. */
  tri?: number;
}

export function cutMesh(m: Mesh, graph: SurfaceGraph, seams: readonly Seam[]): CutMesh {
  const nv = m.positions.length / 3;
  const pos: number[] = Array.from(m.positions);
  const newVertex = (p: Vec3) => { pos.push(p[0], p[1], p[2]); return pos.length / 3 - 1; };
  const at = (v: number): Vec3 => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
  const edgeKey = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);

  // Adjacency of the original mesh.
  const edgeTris = new Map<number, number[]>();
  const vertexTris: number[][] = Array.from({ length: nv }, () => []);
  const vertexEdges: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < triangleCount(m); t++) {
    for (let k = 0; k < 3; k++) {
      const a = m.triangles[3 * t + k];
      const b = m.triangles[3 * t + ((k + 1) % 3)];
      vertexTris[a].push(t);
      const key = edgeKey(a, b);
      const list = edgeTris.get(key);
      if (list) list.push(t);
      else { edgeTris.set(key, [t]); vertexEdges[a].push(key); vertexEdges[b].push(key); }
    }
  }

  // Resolve seam nodes to vertices, creating them as needed and sharing them between seams that meet.
  const edgePoints = new Map<number, { t: number; vertex: number }[]>(); // original edge -> points on it
  const facePoints = new Map<number, { bary: Vec3; vertex: number }[]>(); // original triangle -> interior points
  const onEdge = (a: number, b: number, t: number): Resolved => {
    if (a > b) { [a, b] = [b, a]; t = 1 - t; }
    if (t < EPS) return { vertex: a, original: a };
    if (t > 1 - EPS) return { vertex: b, original: b };
    const key = edgeKey(a, b);
    const list = edgePoints.get(key) ?? [];
    edgePoints.set(key, list);
    let found = list.find((p) => Math.abs(p.t - t) < EPS);
    if (!found) {
      const [pa, pb] = [at(a), at(b)];
      found = { t, vertex: newVertex([0, 1, 2].map((k) => pa[k] + t * (pb[k] - pa[k])) as Vec3) };
      list.push(found);
    }
    return { vertex: found.vertex, edge: [a, b] };
  };
  const resolve = (node: PathNode): Resolved => {
    if (node.kind === 'vertex') return { vertex: node.vertex, original: node.vertex };
    if (node.kind === 'edge') return onEdge(node.a, node.b, node.t);
    const { tri, bary } = node.point;
    const corners = [0, 1, 2].map((k) => m.triangles[3 * tri + k]);
    const near = bary.map((w) => w > 1 - EPS);
    if (near.some(Boolean)) { const v = corners[near.indexOf(true)]; return { vertex: v, original: v }; }
    const zero = bary.map((w) => w < EPS);
    if (zero.some(Boolean)) {
      const [i, j] = [0, 1, 2].filter((k) => !zero[k]);
      return onEdge(corners[i], corners[j], bary[j] / (bary[i] + bary[j]));
    }
    const list = facePoints.get(tri) ?? [];
    facePoints.set(tri, list);
    let found = list.find((p) => Math.abs(p.bary[0] - bary[0]) < EPS && Math.abs(p.bary[1] - bary[1]) < EPS);
    if (!found) {
      found = { bary, vertex: newVertex(pointOnSurface(m, node.point)) };
      list.push(found);
    }
    return { vertex: found.vertex, tri };
  };

  // Each seam is a chain of nodes; every consecutive pair is a segment inside one triangle (or along one edge).
  const chords = new Map<number, [number, number][]>(); // original triangle -> segments across or into it
  const alongEdge: { edge: number; u: number; w: number; seam: number }[] = [];
  const pins = new Set<number>();
  const chordSeams = new Map<string, number[]>(); // chord (smaller vertex:larger vertex) -> seams
  const segment = (u: Resolved, w: Resolved, seam: number) => {
    if (u.vertex === w.vertex) return;
    const edgesOf = (r: Resolved): number[] => (r.original !== undefined ? vertexEdges[r.original] : r.edge ? [edgeKey(r.edge[0], r.edge[1])] : []);
    const shared = edgesOf(u).find((e) => edgesOf(w).includes(e));
    if (shared !== undefined) { alongEdge.push({ edge: shared, u: u.vertex, w: w.vertex, seam }); return; }
    const trisOf = (r: Resolved): number[] => (r.original !== undefined ? vertexTris[r.original] : r.edge ? edgeTris.get(edgeKey(r.edge[0], r.edge[1]))! : [r.tri!]);
    const tri = trisOf(u).find((t) => trisOf(w).includes(t));
    if (tri === undefined) throw new Error('A seam segment does not lie inside one triangle');
    const list = chords.get(tri) ?? [];
    chords.set(tri, list);
    list.push([u.vertex, w.vertex]);
    const key = `${Math.min(u.vertex, w.vertex)}:${Math.max(u.vertex, w.vertex)}`;
    chordSeams.set(key, [...(chordSeams.get(key) ?? []), seam]);
  };
  seams.forEach((seam, seamIndex) => {
    if (seam.points.length < 2) return;
    const pts = seam.closed && seam.points.length > 2 ? [...seam.points, seam.points[0]] : seam.points;
    const nodes: Resolved[] = [];
    const legStarts: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const leg = graph.pathNodes(m.positions, pts[i], pts[i + 1]).map(resolve);
      legStarts.push(i === 0 ? 0 : nodes.length - 1);
      nodes.push(...(i === 0 ? leg : leg.slice(1)));
    }
    for (let i = 0; i + 1 < nodes.length; i++) segment(nodes[i], nodes[i + 1], seamIndex);
    for (const k of [0, ...legStarts.slice(1), nodes.length - 1]) if (nodes[k]) pins.add(nodes[k].vertex);
  });

  // The chain of vertices along each original edge, from the smaller vertex id to the larger.
  const chain = (a: number, b: number): number[] => {
    const pts = [...(edgePoints.get(edgeKey(a, b)) ?? [])].sort((p, q) => p.t - q.t).map((p) => p.vertex);
    return [Math.min(a, b), ...pts, Math.max(a, b)];
  };

  const seamEdges = new Set<number>();
  const seamList: [number, number, number][] = []; // vertex, vertex, seam
  for (const s of alongEdge) {
    const [a, b] = [Math.floor(s.edge / nv), s.edge % nv];
    const c = chain(a, b);
    const [i, j] = [c.indexOf(s.u), c.indexOf(s.w)];
    for (let k = Math.min(i, j); k < Math.max(i, j); k++) seamList.push([c[k], c[k + 1], s.seam]);
  }

  // Re-triangulate every triangle that has points on its edges, inside it, or segments across it.
  const triangles: number[] = [];
  const parent: number[] = [];
  for (let t = 0; t < triangleCount(m); t++) {
    const corners = [m.triangles[3 * t], m.triangles[3 * t + 1], m.triangles[3 * t + 2]];
    const boundary: number[] = [];
    for (let k = 0; k < 3; k++) {
      const [a, b] = [corners[k], corners[(k + 1) % 3]];
      const c = chain(a, b);
      boundary.push(...(a < b ? c : [...c].reverse()).slice(0, -1));
    }
    const interior = (facePoints.get(t) ?? []).map((p) => p.vertex);
    const segs = chords.get(t) ?? [];
    if (boundary.length === 3 && interior.length === 0 && segs.length === 0) {
      triangles.push(...corners);
      parent.push(t);
      continue;
    }
    for (const tri of triangulateCell(corners, boundary, interior, segs, at, newVertex)) {
      triangles.push(...tri);
      parent.push(t);
    }
    for (const [a, b] of segs) for (const seam of chordSeams.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? []) seamList.push([a, b, seam]);
  }

  const total = pos.length / 3;
  const seamsOfEdge = new Map<number, number[]>();
  for (const [a, b, seam] of seamList) {
    const key = Math.min(a, b) * total + Math.max(a, b);
    seamEdges.add(key);
    const list = seamsOfEdge.get(key) ?? [];
    if (!list.includes(seam)) list.push(seam);
    seamsOfEdge.set(key, list);
  }
  return { mesh: { positions: Float64Array.from(pos), triangles: Uint32Array.from(triangles) }, parent, seamEdges, seamsOfEdge, pins, vertexCount: total };
}

/**
 * Triangulate one original triangle whose boundary has extra points, with interior points and segments (chords)
 * that must be edges: fan from an interior point, insert any other interior points, then force each chord in by
 * flipping the edges it crosses (Sloan's constrained insertion).
 */
function triangulateCell(
  corners: number[],
  boundary: number[],
  interior: number[],
  chords: [number, number][],
  at: (v: number) => Vec3,
  newVertex: (p: Vec3) => number,
): [number, number, number][] {
  const [c0, c1, c2] = corners.map(at);
  const ex = normalize(sub(c1, c0));
  const nrm = normalize(cross(sub(c1, c0), sub(c2, c0)));
  const ey = cross(nrm, ex);
  const uv = (v: number): V2 => { const d = sub(at(v), c0); return [dot(d, ex), dot(d, ey)]; };
  const orient = (a: number, b: number, c: number) => {
    const [pa, pb, pc] = [uv(a), uv(b), uv(c)];
    return (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
  };

  const centre = interior.length > 0 ? interior[0] : newVertex([0, 1, 2].map((k) => FAN_CENTRE[0] * c0[k] + FAN_CENTRE[1] * c1[k] + FAN_CENTRE[2] * c2[k]) as Vec3);
  let tris: [number, number, number][] = boundary.map((p, i) => [centre, p, boundary[(i + 1) % boundary.length]]);

  for (const p of interior.slice(1)) {
    const i = tris.findIndex(([a, b, c]) => orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0);
    if (i < 0) throw new Error('An interior seam point is outside its triangle');
    const [a, b, c] = tris[i];
    tris.splice(i, 1, [a, b, p], [b, c, p], [c, a, p]);
  }

  for (const [u, w] of chords) {
    const has = (a: number, b: number) => tris.some((t) => [0, 1, 2].some((k) => t[k] === a && t[(k + 1) % 3] === b) || [0, 1, 2].some((k) => t[k] === b && t[(k + 1) % 3] === a));
    if (has(u, w)) continue;
    const crosses = (a: number, b: number) => a !== u && a !== w && b !== u && b !== w && orient(u, w, a) * orient(u, w, b) < 0 && orient(a, b, u) * orient(a, b, w) < 0;
    for (let guard = 0; guard < 1000; guard++) {
      // Find a crossing edge that can be flipped (its quad is convex).
      let flipped = false;
      let any = false;
      outer: for (let i = 0; i < tris.length; i++) {
        for (let k = 0; k < 3; k++) {
          const [a, b] = [tris[i][k], tris[i][(k + 1) % 3]];
          if (!crosses(a, b)) continue;
          any = true;
          const c = tris[i][(k + 2) % 3];
          const j = tris.findIndex((t, jj) => jj !== i && [0, 1, 2].some((q) => t[q] === b && t[(q + 1) % 3] === a));
          if (j < 0) throw new Error('A seam leaves its triangle');
          const d = tris[j][([0, 1, 2].find((q) => tris[j][q] === b)! + 2) % 3];
          if (orient(c, a, d) > 0 && orient(c, d, b) > 0) { // convex quad c a d b: flip a-b to c-d
            tris[i] = [c, a, d];
            tris[j] = [c, d, b];
            flipped = true;
            break outer;
          }
        }
      }
      if (!any) break;
      if (!flipped) throw new Error('Could not insert a seam segment into its triangle (points too close together?)');
    }
  }
  return tris;
}

/** The triangles reachable from `start` without crossing a seam edge. */
export function regionFrom(cut: CutMesh, start: number): number[] {
  const { triangles } = cut.mesh;
  const n = cut.vertexCount;
  const byEdge = new Map<number, number[]>();
  for (let t = 0; t < triangles.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * t + k];
      const b = triangles[3 * t + ((k + 1) % 3)];
      const key = Math.min(a, b) * n + Math.max(a, b);
      const list = byEdge.get(key);
      if (list) list.push(t);
      else byEdge.set(key, [t]);
    }
  }
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * t + k];
      const b = triangles[3 * t + ((k + 1) % 3)];
      const key = Math.min(a, b) * n + Math.max(a, b);
      if (cut.seamEdges.has(key)) continue;
      for (const o of byEdge.get(key)!) if (!seen.has(o)) { seen.add(o); stack.push(o); }
    }
  }
  return [...seen].sort((p, q) => p - q);
}

/** The cut-mesh triangle that holds a point given on the original mesh. */
export function locateInCut(cut: CutMesh, original: Mesh, p: SurfacePoint): number {
  const at = pointOnSurface(original, p);
  let best = -1;
  let bd = Infinity;
  for (let t = 0; t < cut.parent.length; t++) {
    if (cut.parent[t] !== p.tri) continue;
    const [a, b, c] = [0, 1, 2].map((k) => getVertex(cut.mesh, cut.mesh.triangles[3 * t + k]));
    const w = closestBary(at, a, b, c);
    const q: Vec3 = [0, 1, 2].map((k) => w[0] * a[k] + w[1] * b[k] + w[2] * c[k]) as Vec3;
    const d = len(sub(q, at));
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

export function triangleArea(m: Mesh, t: number): number {
  const [a, b, c] = [0, 1, 2].map((k) => getVertex(m, m.triangles[3 * t + k]));
  return len(cross(sub(b, a), sub(c, a))) / 2;
}

export function area(m: Mesh, triangles: readonly number[]): number {
  return triangles.reduce((s, t) => s + triangleArea(m, t), 0);
}

/** One side of a panel: the run of its boundary that lies along one seam (or along no seam). */
export interface PanelEdge {
  /** Index of the seam (in the list given to cutMesh) this run follows; undefined where the border is not a seam. */
  seam: number | undefined;
  /** Vertices of the cut mesh along the run, in boundary order (consecutive runs share their end vertices). */
  vertices: number[];
  /** Length along the body (cm). */
  length: number;
}

/**
 * The sides of a panel, in order round its outline, each the run of boundary edges that follow one seam.
 * Returns undefined if the panel does not have exactly one boundary loop (it is not a disc).
 */
export function panelEdges(cut: CutMesh, triangles: readonly number[]): PanelEdge[] | undefined {
  const sub = extractSubmesh(cut.mesh, [...triangles]);
  const loops = boundaryLoops(sub.mesh);
  if (loops.length !== 1) return undefined;
  const loop = loops[0].map((v) => sub.vertexMap[v]);
  const n = loop.length;
  const seamOf = (i: number): number | undefined => {
    const [a, b] = [loop[i], loop[(i + 1) % n]];
    return cut.seamsOfEdge.get(Math.min(a, b) * cut.vertexCount + Math.max(a, b))?.[0];
  };
  const seams = loop.map((_, i) => seamOf(i));
  // Start where the seam changes, so a run is never split by the start of the loop.
  let start = seams.findIndex((q, i) => q !== seams[(i + n - 1) % n]);
  if (start < 0) start = 0;
  const edges: PanelEdge[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const [a, b] = [loop[i], loop[(i + 1) % n]];
    const last = edges[edges.length - 1];
    if (last && last.seam === seams[i]) { last.vertices.push(b); last.length += len(sub3(cut.mesh, a, b)); }
    else edges.push({ seam: seams[i], vertices: [a, b], length: len(sub3(cut.mesh, a, b)) });
  }
  return edges;
}
const sub3 = (m: Mesh, a: number, b: number): Vec3 => sub(getVertex(m, a), getVertex(m, b));
