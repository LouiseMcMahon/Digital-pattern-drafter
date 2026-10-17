/** A polyline from a plane/mesh intersection. points are xyz interleaved. */
export interface Loop {
  points: number[];
  closed: boolean;
  /** Optional per-point scalar interpolated from a per-vertex attribute (see slicePlane's attr). */
  attr?: number[];
}

export type Plane = { point: [number, number, number]; normal: [number, number, number] };

/**
 * Intersect a triangle mesh (optionally a subset of its triangles) with a plane and chain the
 * segments into loops. Each segment end sits on a mesh edge, so segments link by edge id.
 */
export function slicePlane(positions: Float64Array, triangles: Uint32Array, plane: Plane, subset?: ArrayLike<number>, attr?: ArrayLike<number>): Loop[] {
  const [px, py, pz] = plane.point;
  const [nx, ny, nz] = plane.normal;
  const nv = positions.length / 3;
  const dist = new Float64Array(nv);
  for (let i = 0; i < nv; i++) dist[i] = (positions[3 * i] - px) * nx + (positions[3 * i + 1] - py) * ny + (positions[3 * i + 2] - pz) * nz;

  const pts: number[] = [];
  const ptAttr: number[] = [];
  const edgePoint = new Map<number, number>(); // edge key -> point index
  const pointFor = (a: number, b: number) => {
    const key = a < b ? a * nv + b : b * nv + a;
    let id = edgePoint.get(key);
    if (id === undefined) {
      const t = dist[a] / (dist[a] - dist[b]);
      id = pts.length / 3;
      pts.push(
        positions[3 * a] + t * (positions[3 * b] - positions[3 * a]),
        positions[3 * a + 1] + t * (positions[3 * b + 1] - positions[3 * a + 1]),
        positions[3 * a + 2] + t * (positions[3 * b + 2] - positions[3 * a + 2]),
      );
      if (attr) ptAttr.push(attr[a] + t * (attr[b] - attr[a]));
      edgePoint.set(key, id);
    }
    return id;
  };

  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  const count = subset ? subset.length : triangles.length / 3;
  for (let q = 0; q < count; q++) {
    const t = subset ? subset[q] : q;
    const v = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
    const side = v.map((i) => dist[i] >= 0);
    if (side[0] === side[1] && side[1] === side[2]) continue;
    // The odd vertex out is alone on its side; its two edges carry the segment.
    const odd = side[0] !== side[1] ? (side[0] !== side[2] ? 0 : 1) : 2;
    const [a, b, c] = [v[odd], v[(odd + 1) % 3], v[(odd + 2) % 3]];
    link(pointFor(a, b), pointFor(a, c));
  }

  const visited = new Set<number>();
  const loops: Loop[] = [];
  const walk = (start: number): Loop => {
    const order: number[] = [];
    let cur = start;
    while (true) {
      visited.add(cur);
      order.push(cur);
      // Everything already walked is visited, so this never steps back onto the point it came from.
      const next = adj.get(cur)!.find((n) => !visited.has(n));
      if (next === undefined) break;
      cur = next;
    }
    // Closed when the walk ended next to where it started (two points that merely touch are a chain, not a loop).
    const closed = order.length > 2 && adj.get(cur)!.includes(start);
    const points: number[] = [];
    for (const id of order) points.push(pts[3 * id], pts[3 * id + 1], pts[3 * id + 2]);
    return attr ? { points, closed, attr: order.map((id) => ptAttr[id]) } : { points, closed };
  };
  // Open chains first (start at degree-1 points), then closed loops.
  for (const [id, n] of adj) if (n.length === 1 && !visited.has(id)) loops.push(walk(id));
  for (const id of adj.keys()) if (!visited.has(id)) loops.push(walk(id));
  return loops;
}

export function loopLength(l: Loop): number {
  const p = l.points;
  const n = p.length / 3;
  let s = 0;
  for (let i = 0; i + 1 < n; i++) s += Math.hypot(p[3 * i + 3] - p[3 * i], p[3 * i + 4] - p[3 * i + 1], p[3 * i + 5] - p[3 * i + 2]);
  if (l.closed) s += Math.hypot(p[0] - p[3 * n - 3], p[1] - p[3 * n - 2], p[2] - p[3 * n - 1]);
  return s;
}

export function loopCentroid(l: Loop): [number, number, number] {
  const n = l.points.length / 3;
  let [x, y, z] = [0, 0, 0];
  for (let i = 0; i < n; i++) { x += l.points[3 * i]; y += l.points[3 * i + 1]; z += l.points[3 * i + 2]; }
  return [x / n, y / n, z / n];
}

/**
 * Position of the point on the loop closest to p, as arc length from the loop's first point
 * (fractional: it projects onto segments, so it varies smoothly as the loop moves).
 */
export function arcPositionOf(l: Loop, p: [number, number, number]): number {
  const pts = l.points;
  const n = pts.length / 3;
  const segs = l.closed ? n : n - 1;
  let best = Infinity;
  let bestPos = 0;
  let cum = 0;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const [ax, ay, az] = [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]];
    const [dx, dy, dz] = [pts[3 * j] - ax, pts[3 * j + 1] - ay, pts[3 * j + 2] - az];
    const len2 = dx * dx + dy * dy + dz * dz;
    // A zero-length segment (repeated point) projects to its start and contributes no length.
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz) / len2)) : 0;
    const d = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1], az + t * dz - p[2]);
    const segLen = Math.sqrt(len2);
    if (d < best) { best = d; bestPos = cum + t * segLen; }
    cum += segLen;
  }
  return bestPos;
}

/** Arc length along a loop between the points closest to p and q (shorter way round if closed). */
export function arcBetweenPoints(l: Loop, p: [number, number, number], q: [number, number, number]): number {
  const d = Math.abs(arcPositionOf(l, p) - arcPositionOf(l, q));
  return l.closed ? Math.min(d, loopLength(l) - d) : d;
}

/**
 * The polyline of a loop between the points closest to p and q (the shorter way round if closed), for
 * display. Always runs in loop order (from the smaller arc position to the larger, or across the loop's
 * start when that is shorter), whichever order p and q are given in.
 */
export function arcPoints(l: Loop, p: [number, number, number], q: [number, number, number]): number[] {
  const total = loopLength(l);
  let [from, to] = [arcPositionOf(l, p), arcPositionOf(l, q)];
  if (from > to) [from, to] = [to, from];
  if (l.closed && to - from > total / 2) [from, to] = [to, from + total];
  const steps = Math.max(2, Math.ceil((to - from) / 0.5));
  const out: number[] = [];
  for (let k = 0; k <= steps; k++) out.push(...pointAtArc(l, from + ((to - from) * k) / steps));
  return out;
}

/** The point at arc length `pos` from the loop's first point (wraps if closed). */
export function pointAtArc(l: Loop, pos: number): [number, number, number] {
  const pts = l.points;
  const n = pts.length / 3;
  const segs = l.closed ? n : n - 1;
  const total = loopLength(l);
  pos = l.closed ? ((pos % total) + total) % total : Math.max(0, Math.min(total, pos));
  let cum = 0;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(pts[3 * j] - pts[3 * i], pts[3 * j + 1] - pts[3 * i + 1], pts[3 * j + 2] - pts[3 * i + 2]);
    if (pos <= cum + len || i === segs - 1) {
      const t = len > 0 ? (pos - cum) / len : 0;
      return [0, 1, 2].map((k) => pts[3 * i + k] + t * (pts[3 * j + k] - pts[3 * i + k])) as [number, number, number];
    }
    cum += len;
  }
  return [pts[0], pts[1], pts[2]];
}
