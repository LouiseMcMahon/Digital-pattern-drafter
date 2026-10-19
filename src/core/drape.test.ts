import { describe, expect, it } from 'vitest';
import { cutMesh } from './cut';
import { drape, drapeSeams } from './drape';
import { SurfaceGraph, raycast } from './seam';
import { type Mesh, getVertex, len, sub, triangleCount } from './mesh';

/** A square patch [-half, half]^2 with n x n cells, height z = h(x, y), normals up. */
function heightField(half: number, n: number, h: (x: number, y: number) => number): Mesh {
  const pos: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = -half + (2 * half * i) / n; const y = -half + (2 * half * j) / n; pos.push(x, y, h(x, y)); }
  const tris: number[] = [];
  const id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) };
}
const area = (m: Mesh) => {
  let s = 0;
  for (let t = 0; t < triangleCount(m); t++) {
    const [a, b, c] = [0, 1, 2].map((k) => getVertex(m, m.triangles[3 * t + k]));
    const u = sub(b, a); const v = sub(c, a);
    s += 0.5 * len([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
  }
  return s;
};
const bump = (cx: number, cy: number, height: number, sigma: number) => (x: number, y: number) => height * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));
const zAt = (m: Mesh, x: number, y: number) => {
  let best = 0; let bd = Infinity;
  for (let v = 0; v < m.positions.length / 3; v++) { const d = Math.hypot(m.positions[3 * v] - x, m.positions[3 * v + 1] - y); if (d < bd) { bd = d; best = m.positions[3 * v + 2]; } }
  return best;
};

describe('drape', () => {
  it('leaves a flat panel alone', () => {
    const flat = heightField(5, 10, () => 0);
    const out = drape(flat);
    for (let i = 0; i < flat.positions.length; i++) expect(out.mesh.positions[i]).toBeCloseTo(flat.positions[i], 6);
  });

  it('keeps the boundary fixed, never goes below the skin, and has less area than the skin', () => {
    const n = 24;
    const skin = heightField(10, n, bump(0, 0, 3, 2.5));
    const out = drape(skin);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const v = j * (n + 1) + i;
      if (i === 0 || j === 0 || i === n || j === n) for (let k = 0; k < 3; k++) expect(out.mesh.positions[3 * v + k]).toBe(skin.positions[3 * v + k]);
      expect(out.mesh.positions[3 * v + 2]).toBeGreaterThanOrEqual(skin.positions[3 * v + 2] - 1e-9);
    }
    expect(area(out.mesh)).toBeLessThan(area(skin));
    expect(zAt(out.mesh, 0, 0)).toBeGreaterThan(2.95); // still resting on the top of the bump
  });

  it('bridges the hollow between two bumps, clear of the skin there, resting on each bump', () => {
    const [f1, f2] = [bump(-4, 0, 3, 1.8), bump(4, 0, 3, 1.8)];
    const skin = heightField(10, 30, (x, y) => f1(x, y) + f2(x, y));
    const out = drape(skin);
    const mid = zAt(out.mesh, 0, 0);
    expect(mid).toBeGreaterThan(zAt(skin, 0, 0) + 0.3);
    expect(mid).toBeLessThan(3);
    expect(zAt(out.mesh, -4, 0)).toBeGreaterThan(2.95);
    expect(zAt(out.mesh, 4, 0)).toBeGreaterThan(2.95);
    const v = [...Array(out.gap.length).keys()].find((i) => Math.abs(skin.positions[3 * i]) < 0.1 && Math.abs(skin.positions[3 * i + 1]) < 0.1)!;
    expect(out.gap[v]).toBeGreaterThan(0.3);
  });

  it('reports the boundary lift when the boundary is moved off the skin', () => {
    const skin = heightField(5, 6, () => 0);
    const boundary = Float64Array.from(skin.positions, (p, k) => (k % 3 === 2 ? 0.7 : p));
    const out = drape(skin, { boundary });
    expect(out.gap[0]).toBeCloseTo(0.7, 9); // a corner vertex, on the boundary
    expect(out.mesh.positions[2]).toBeCloseTo(0.7, 9);
  });

  it('keeps the cloth off the skin by the standoff', () => {
    const skin = heightField(10, 20, bump(0, 0, 3, 2.5));
    const out = drape(skin, { standoff: 0.5 });
    const v = 10 * 21 + 10;
    expect(out.mesh.positions[3 * v + 2]).toBeGreaterThanOrEqual(3.5 - 1e-6);
  });
});

describe('drapeSeams', () => {
  it('pulls a seam taut across a hollow, keeps its control points, never goes below the skin, and moves nothing else', () => {
    const [f1, f2] = [bump(-4, 0, 3, 1.2), bump(4, 0, 3, 1.2)];
    const skin = heightField(10, 20, (x, y) => f1(x, y) + f2(x, y));
    const point = (x: number, y: number) => { const h = raycast(skin, [x, y, 50], [0, 0, -1])!; return { tri: h.tri, bary: h.bary }; };
    const seam = { points: [point(-4, 0), point(4, 0)], closed: false };
    const cut = cutMesh(skin, new SurfaceGraph(skin.triangles, skin.positions.length / 3), [seam]);
    const taut = drapeSeams(cut);
    const onSeam = new Set<number>();
    for (const key of cut.seamEdges) { onSeam.add(Math.floor(key / cut.vertexCount)); onSeam.add(key % cut.vertexCount); }
    const lengthOf = (positions: ArrayLike<number>) => {
      const order = [...onSeam].sort((a, b) => positions[3 * a] - positions[3 * b]);
      return order.slice(1).reduce((s, v, i) => s + Math.hypot(positions[3 * v] - positions[3 * order[i]], positions[3 * v + 1] - positions[3 * order[i] + 1], positions[3 * v + 2] - positions[3 * order[i] + 2]), 0);
    };
    expect(cut.pins.size).toBe(2);
    for (const v of cut.pins) for (let k = 0; k < 3; k++) expect(taut.positions[3 * v + k]).toBe(cut.mesh.positions[3 * v + k]);
    for (let v = 0; v < cut.vertexCount; v++) if (!onSeam.has(v)) for (let k = 0; k < 3; k++) expect(taut.positions[3 * v + k]).toBe(cut.mesh.positions[3 * v + k]);
    for (const v of onSeam) expect(taut.gap[v]).toBeGreaterThanOrEqual(0);
    expect(Math.max(...[...onSeam].map((v) => taut.gap[v]))).toBeGreaterThan(0.5); // lifted clear of the valley floor
    expect(lengthOf(taut.positions)).toBeLessThan(lengthOf(cut.mesh.positions) - 0.5);
  });
  it('leaves a seam with only control points alone', () => {
    const flat = heightField(5, 6, () => 0);
    const cut = cutMesh(flat, new SurfaceGraph(flat.triangles, flat.positions.length / 3), []);
    expect(Array.from(drapeSeams(cut).positions)).toEqual(Array.from(cut.mesh.positions));
  });
});
