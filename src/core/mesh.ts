export type Vec3 = [number, number, number];

/** Indexed triangle mesh. positions is xyz-interleaved; triangles is index triples. */
export interface Mesh {
  positions: Float64Array;
  triangles: Uint32Array;
}

export const vertexCount = (m: Mesh) => m.positions.length / 3;
export const triangleCount = (m: Mesh) => m.triangles.length / 3;

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

export function getVertex(m: Mesh, i: number): Vec3 {
  return [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
}

/** Area-weighted vertex normals. */
export function vertexNormals(m: Mesh): Vec3[] {
  const n = vertexCount(m);
  const acc = Array.from({ length: n }, () => [0, 0, 0] as Vec3);
  for (let t = 0; t < triangleCount(m); t++) {
    const [a, b, c] = [m.triangles[3 * t], m.triangles[3 * t + 1], m.triangles[3 * t + 2]];
    const fn = cross(sub(getVertex(m, b), getVertex(m, a)), sub(getVertex(m, c), getVertex(m, a)));
    for (const v of [a, b, c]) {
      acc[v][0] += fn[0];
      acc[v][1] += fn[1];
      acc[v][2] += fn[2];
    }
  }
  return acc.map(normalize);
}

/** A panel pulled out of a larger mesh. vertexMap[sub] = original vertex index. */
export interface Submesh {
  mesh: Mesh;
  vertexMap: number[];
}

export function extractSubmesh(m: Mesh, triangleIds: number[]): Submesh {
  const toSub = new Map<number, number>();
  const vertexMap: number[] = [];
  const tris: number[] = [];
  for (const t of triangleIds) {
    for (let k = 0; k < 3; k++) {
      const v = m.triangles[3 * t + k];
      let s = toSub.get(v);
      if (s === undefined) {
        s = vertexMap.length;
        toSub.set(v, s);
        vertexMap.push(v);
      }
      tris.push(s);
    }
  }
  const positions = new Float64Array(vertexMap.length * 3);
  vertexMap.forEach((v, s) => positions.set([m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]], 3 * s));
  return { mesh: { positions, triangles: new Uint32Array(tris) }, vertexMap };
}

/** Closed boundary loops (vertex indices, in triangle winding order). */
export function boundaryLoops(m: Mesh): number[][] {
  const directed = new Set<number>();
  const n = vertexCount(m);
  for (let t = 0; t < triangleCount(m); t++) {
    for (let k = 0; k < 3; k++) directed.add(m.triangles[3 * t + k] * n + m.triangles[3 * t + ((k + 1) % 3)]);
  }
  const next = new Map<number, number>();
  for (const e of directed) {
    const a = Math.floor(e / n);
    const b = e % n;
    if (!directed.has(b * n + a)) next.set(a, b);
  }
  const loops: number[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      loop.push(cur);
      cur = next.get(cur);
    }
    loops.push(loop);
  }
  return loops;
}

export interface MeshEdges {
  a: number[];
  b: number[];
  /** For each edge, the vertex opposite it in each triangle that has the edge (one on a border, two inside). */
  opposite: number[][];
}

/** The unique edges of a mesh, in order of first appearance, with the vertices opposite each. */
export function meshEdges(m: Mesh): MeshEdges {
  const n = vertexCount(m);
  const index = new Map<number, number>();
  const edges: MeshEdges = { a: [], b: [], opposite: [] };
  for (let t = 0; t < triangleCount(m); t++) {
    for (let k = 0; k < 3; k++) {
      const a = m.triangles[3 * t + k];
      const b = m.triangles[3 * t + ((k + 1) % 3)];
      const c = m.triangles[3 * t + ((k + 2) % 3)];
      const key = Math.min(a, b) * n + Math.max(a, b);
      const found = index.get(key);
      if (found === undefined) {
        index.set(key, edges.a.length);
        edges.a.push(a);
        edges.b.push(b);
        edges.opposite.push([c]);
      } else edges.opposite[found].push(c);
    }
  }
  return edges;
}

/** For each vertex, the vertices it shares an edge with. */
export function vertexNeighbours(m: Mesh, edges: MeshEdges = meshEdges(m)): number[][] {
  const out: number[][] = Array.from({ length: vertexCount(m) }, () => []);
  edges.a.forEach((a, i) => { out[a].push(edges.b[i]); out[edges.b[i]].push(a); });
  return out;
}
