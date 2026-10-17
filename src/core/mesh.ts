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
