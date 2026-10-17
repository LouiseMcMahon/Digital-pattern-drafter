import { type Vec3, len, sub } from './mesh';
import type { PathNode, SurfacePoint } from './seam';

/** Which triangles touch an edge or a vertex of the mesh. */
export interface Adjacency {
  edgeTriangles(a: number, b: number): number[];
  vertexTriangles(v: number): number[];
}

type V2 = [number, number];
interface Portal { l: V2; r: V2 }

const orient = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a: V2, b: V2) => a[0] === b[0] && a[1] === b[1];
const EPS = 1e-9;

/**
 * Pulls a surface path taut. The input is a path found over the mesh edges and extra points on them (see
 * SurfaceGraph): it crosses a sequence of triangles but wanders inside them, and favours whichever way the mesh's
 * diagonals run (so it zigzags, and a path and its mirror image differ). This keeps that sequence of triangles
 * (where it passes through a vertex, the triangles around the vertex), unfolds it flat, and finds the exact shortest
 * line through it with the funnel algorithm: as straight as the surface allows, whatever the mesh's triangulation.
 * Returns the path as nodes again (start, each edge it crosses or vertex it bends at, end); unchanged if the
 * input cannot be turned into a strip of triangles (a path along an edge, or the open border of the mesh).
 */
export function straighten(positions: Float64Array, triangles: Uint32Array, path: PathNode[], adj: Adjacency): PathNode[] {
  // Each pass can only turn a vertex the path passes through, so repeat on the result until it stops getting shorter.
  let current = path;
  for (let pass = 0; pass < 4; pass++) {
    const next = straightenOnce(positions, triangles, current, adj);
    if (next === current) break;
    current = next;
  }
  return current;
}

function straightenOnce(positions: Float64Array, triangles: Uint32Array, original: PathNode[], adj: Adjacency): PathNode[] {
  const P = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  /** The mesh vertex a node sits at, if it does (a point in a triangle can sit exactly on a corner). */
  const vertexOf = (n: PathNode | undefined): number | undefined => {
    if (n?.kind === 'vertex') return n.vertex;
    if (n?.kind === 'face') { const k = n.point.bary.findIndex((w) => w > 1 - EPS); return k >= 0 ? triangles[3 * n.point.tri + k] : undefined; }
    return undefined;
  };
  // A point on an edge right next to one of that edge's ends is just the path running along the edge: drop it.
  const alongEdge = (i: number) => {
    const n = original[i];
    return n.kind === 'edge' && [original[i - 1], original[i + 1]].some((o) => { const v = vertexOf(o); return v !== undefined && (v === n.a || v === n.b); });
  };
  const nodes = original.filter((_, i) => i === 0 || i === original.length - 1 || !alongEdge(i));
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (nodes.length < 3 || first.kind !== 'face' || last.kind !== 'face') return original;
  const startPoint = first.point;
  const endPoint = last.point;
  const corners = (t: number) => [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
  const has = (t: number, v: number) => corners(t).includes(v);

  // The strip of triangles, and the edge crossed between each pair of them. A vertex on the path can be passed
  // on either side: `sides` says which way round each one is turned (1, -1), 0 meaning the shorter way.
  const vertexNodes = nodes.map((n, i) => (n.kind === 'vertex' ? i : -1)).filter((i) => i >= 0);
  const layout = (sides: Map<number, number>): { strip: number[]; crossed: [number, number][] } | undefined => {
    const strip: number[] = [startPoint.tri];
    const crossed: [number, number][] = [];
    const cross = (a: number, b: number): boolean => {
      const cur = strip[strip.length - 1];
      if (!has(cur, a) || !has(cur, b)) return false;
      const next = adj.edgeTriangles(a, b).find((t) => t !== cur);
      if (next === undefined) return false; // the border of the mesh
      crossed.push([a, b]);
      strip.push(next);
      return true;
    };
    /** Turn around vertex v from the current triangle until `done` holds, one way or the other. */
    const turnAround = (i: number, v: number, done: (t: number) => boolean): boolean => {
      const start = strip[strip.length - 1];
      if (!has(start, v)) return false;
      if (done(start)) return true;
      const attempt = (dir: number) => {
        const steps: { edge: [number, number]; to: number }[] = [];
        let t = start;
        for (let n = 0; n < adj.vertexTriangles(v).length; n++) {
          const c = corners(t);
          const at = c.indexOf(v);
          const x = c[(at + (dir > 0 ? 1 : 2)) % 3];
          const next = adj.edgeTriangles(v, x).find((o) => o !== t);
          if (next === undefined) return undefined;
          steps.push({ edge: [v, x], to: next });
          t = next;
          if (done(t)) return steps;
        }
        return undefined;
      };
      const options = [attempt(1), attempt(-1)];
      const want = sides.get(i) ?? 0;
      let pick: number;
      if (want !== 0 && options[want > 0 ? 0 : 1]) pick = want > 0 ? 0 : 1;
      else if (options[0] && options[1]) pick = options[0].length <= options[1].length ? 0 : 1;
      else pick = options[0] ? 0 : 1;
      const steps = options[pick];
      if (!steps) return false;
      sides.set(i, pick === 0 ? 1 : -1);
      for (const step of steps) { crossed.push(step.edge); strip.push(step.to); }
      return true;
    };
    for (let i = 1; i < nodes.length - 1; i++) {
      const n = nodes[i];
      const next = nodes[i + 1];
      if (n.kind === 'edge') { if (!cross(n.a, n.b)) return undefined; continue; }
      if (n.kind !== 'vertex') return undefined;
      const done = (t: number) => (next.kind === 'edge' ? has(t, next.a) && has(t, next.b) : next.kind === 'vertex' ? has(t, next.vertex) : t === next.point.tri);
      if (!turnAround(i, n.vertex, done)) return undefined;
    }
    if (strip[strip.length - 1] !== endPoint.tri || crossed.length === 0) return undefined;
    return { strip, crossed };
  };

  const sides = new Map<number, number>();
  const first0 = layout(sides);
  if (!first0) return original;
  let best = pull(first0.strip, first0.crossed);
  // Try the other way round each vertex; keep a change when the path gets shorter.
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (const i of vertexNodes) {
      if (!sides.has(i)) continue;
      const trial = new Map(sides);
      trial.set(i, -(sides.get(i)!));
      const laid = layout(trial);
      if (!laid) continue;
      const candidate = pull(laid.strip, laid.crossed);
      if (candidate.length < best.length - 1e-9) { best = candidate; sides.set(i, trial.get(i)!); improved = true; }
    }
    if (!improved) break;
  }
  // Never longer than what we were given (the strip can only be as good as the path that chose it).
  return length3d(best.nodes) <= length3d(original) ? best.nodes : original;

  function length3d(list: PathNode[]): number {
    const at = (n: PathNode): Vec3 => {
      if (n.kind === 'vertex') return P(n.vertex);
      if (n.kind === 'edge') { const [pa, pb] = [P(n.a), P(n.b)]; return [0, 1, 2].map((k) => pa[k] + n.t * (pb[k] - pa[k])) as Vec3; }
      const c = [0, 1, 2].map((k) => P(triangles[3 * n.point.tri + k]));
      return [0, 1, 2].map((k) => n.point.bary[0] * c[0][k] + n.point.bary[1] * c[1][k] + n.point.bary[2] * c[2][k]) as Vec3;
    };
    let sum = 0;
    for (let i = 0; i + 1 < list.length; i++) sum += len(sub(at(list[i]), at(list[i + 1])));
    return sum;
  }

  function pull(strip: number[], crossed: [number, number][]): { nodes: PathNode[]; length: number } {
  // Unfold the strip into the plane, one triangle after another across the crossed edges.
  const d = (a: number, b: number) => len(sub(P(a), P(b)));
  const [v0, v1, v2] = corners(strip[0]);
  const x2 = (d(v0, v1) ** 2 + d(v0, v2) ** 2 - d(v1, v2) ** 2) / (2 * d(v0, v1));
  const flat: Map<number, V2>[] = [new Map<number, V2>([[v0, [0, 0]], [v1, [d(v0, v1), 0]], [v2, [x2, Math.sqrt(Math.max(0, d(v0, v2) ** 2 - x2 * x2))]]])];
  const portals: Portal[] = [];
  for (let k = 1; k < strip.length; k++) {
    const [a, b] = crossed[k - 1];
    const prev = flat[k - 1];
    const [pa, pb] = [prev.get(a)!, prev.get(b)!];
    const behind = prev.get(corners(strip[k - 1]).find((v) => v !== a && v !== b)!)!;
    const r = corners(strip[k]).find((v) => v !== a && v !== b)!;
    const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const u: V2 = [(pb[0] - pa[0]) / L, (pb[1] - pa[1]) / L];
    const along = (d(a, r) ** 2 - d(b, r) ** 2 + L * L) / (2 * L);
    const across = Math.sqrt(Math.max(0, d(a, r) ** 2 - along * along));
    const sgn = orient(pa, pb, behind) > 0 ? -1 : 1; // the new vertex lies on the far side of the edge from the triangle behind
    const pr: V2 = [pa[0] + along * u[0] - sgn * across * u[1], pa[1] + along * u[1] + sgn * across * u[0]];
    flat.push(new Map<number, V2>([[a, pa], [b, pb], [r, pr]]));
    // Facing the new triangle, the edge's start is on the left when the new vertex lies to the left of the edge.
    portals.push(orient(pa, pb, pr) > 0 ? { l: pa, r: pb } : { l: pb, r: pa });
  }

  const place = (p: SurfacePoint, k: number): V2 => {
    const c = corners(p.tri).map((v) => flat[k].get(v)!);
    return [0, 1].map((i) => p.bary[0] * c[0][i] + p.bary[1] * c[1][i] + p.bary[2] * c[2][i]) as V2;
  };
  const s2 = place(startPoint, 0);
  const z2 = place(endPoint, strip.length - 1);

  // Funnel algorithm over [start, portals..., end]: the bends of the shortest path, each at a portal end.
  const all: Portal[] = [{ l: s2, r: s2 }, ...portals, { l: z2, r: z2 }];
  const bends: { at: V2; index: number }[] = [{ at: s2, index: 0 }];
  let apex = s2;
  let left = s2;
  let right = s2;
  let leftIndex = 0;
  let rightIndex = 0;
  for (let i = 1; i < all.length; i++) {
    const { l, r } = all[i];
    if (orient(apex, right, r) >= 0) {
      if (same(apex, right) || orient(apex, left, r) < 0) { right = r; rightIndex = i; }
      else { // the right side crossed over the left: the left end becomes a bend
        bends.push({ at: left, index: leftIndex });
        apex = left; right = left; rightIndex = leftIndex;
        i = leftIndex;
        continue;
      }
    }
    if (orient(apex, left, l) <= 0) {
      if (same(apex, left) || orient(apex, right, l) > 0) { left = l; leftIndex = i; }
      else {
        bends.push({ at: right, index: rightIndex });
        apex = right; left = right; leftIndex = rightIndex;
        i = rightIndex;
        continue;
      }
    }
  }
  bends.push({ at: z2, index: all.length - 1 });

  // Where the straight pieces cross each portal (a bend sits exactly on a portal end).
  const result: PathNode[] = [first];
  const push = (n: PathNode) => {
    const prev = result[result.length - 1];
    if (n.kind === 'vertex' && prev.kind === 'vertex' && prev.vertex === n.vertex) return;
    result.push(n);
  };
  for (let k = 1; k <= crossed.length; k++) {
    const [a, b] = crossed[k - 1];
    const [pa, pb] = [flat[k].get(a)!, flat[k].get(b)!];
    const j = bends.findIndex((q, i) => i + 1 < bends.length && q.index < k && k <= bends[i + 1].index);
    const [A, B] = [bends[j].at, bends[j + 1].at];
    // Where segment A-B crosses the line through the portal's two ends, as a fraction along the portal.
    const dir: V2 = [B[0] - A[0], B[1] - A[1]];
    const e: V2 = [pb[0] - pa[0], pb[1] - pa[1]];
    const den = e[0] * dir[1] - e[1] * dir[0];
    let t = Math.abs(den) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, ((A[0] - pa[0]) * dir[1] - (A[1] - pa[1]) * dir[0]) / den));
    if (t < EPS) push({ kind: 'vertex', vertex: a });
    else if (t > 1 - EPS) push({ kind: 'vertex', vertex: b });
    else if (a < b) push({ kind: 'edge', a, b, t });
    else { t = 1 - t; push({ kind: 'edge', a: b, b: a, t }); }
  }
  result.push(last);
  let length = 0;
  for (let i = 0; i + 1 < bends.length; i++) length += Math.hypot(bends[i + 1].at[0] - bends[i].at[0], bends[i + 1].at[1] - bends[i].at[1]);
  return { nodes: result, length };
  }
}
