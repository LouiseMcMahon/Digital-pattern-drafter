/** A polyline from a plane/mesh intersection. points are xyz interleaved. */
export interface Loop {
  points: number[];
  closed: boolean;
}

export type Plane = { point: [number, number, number]; normal: [number, number, number] };

/**
 * Intersect a triangle mesh (optionally a subset of its triangles) with a plane and chain the
 * segments into loops. Each segment end sits on a mesh edge, so segments link by edge id.
 */
export function slicePlane(positions: Float64Array, triangles: Uint32Array, plane: Plane, subset?: ArrayLike<number>): Loop[] {
  const [px, py, pz] = plane.point;
  const [nx, ny, nz] = plane.normal;
  const nv = positions.length / 3;
  const dist = new Float64Array(nv);
  for (let i = 0; i < nv; i++) dist[i] = (positions[3 * i] - px) * nx + (positions[3 * i + 1] - py) * ny + (positions[3 * i + 2] - pz) * nz;

  const pts: number[] = [];
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
    let prev = -1;
    let cur = start;
    let closed = false;
    while (true) {
      visited.add(cur);
      order.push(cur);
      const next = adj.get(cur)!.find((n) => n !== prev && !visited.has(n));
      if (next === undefined) {
        closed = adj.get(cur)!.includes(start) && order.length > 2 && prev !== -1;
        break;
      }
      prev = cur;
      cur = next;
    }
    const points: number[] = [];
    for (const id of order) points.push(pts[3 * id], pts[3 * id + 1], pts[3 * id + 2]);
    return { points, closed };
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
