import { describe, expect, it } from 'vitest';
import { SurfaceField } from './bodyField';
import type { Mesh } from './mesh';
import { getVertex, len, sub, triangleCount } from './mesh';
import { closestBary } from './seam';

// A 10 x 10 square in z = 0, normals up.
const square = (): Mesh => {
  const pos: number[] = []; const tris: number[] = [];
  for (let j = 0; j <= 5; j++) for (let i = 0; i <= 5; i++) pos.push(-5 + 2 * i, -5 + 2 * j, 0);
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { const a = j * 6 + i; tris.push(a, a + 1, a + 7, a, a + 7, a + 6); }
  return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) };
};

describe('SurfaceField', () => {
  const field = new SurfaceField(square(), 1);
  it('gives the closest point, the normal and a signed distance (positive on the normal side)', () => {
    const above = field.closest([1.3, -2.2, 0.7]);
    expect(above.signed).toBeCloseTo(0.7, 9);
    expect(above.point[2]).toBeCloseTo(0, 9);
    expect(above.normal[2]).toBeCloseTo(1, 9);
    expect(field.closest([1.3, -2.2, -0.4]).signed).toBeCloseTo(-0.4, 9);
  });
  it('finds the closest point beyond the grid, off the edge of the surface', () => {
    const away = field.closest([12, 0, 0]);
    expect(Math.abs(away.signed)).toBeCloseTo(7, 9);
    expect(away.point[0]).toBeCloseTo(5, 9);
  });
  it('rejects a mesh with no triangles', () => {
    expect(() => new SurfaceField({ positions: new Float64Array([0, 0, 0]), triangles: new Uint32Array(0) }).closest([0, 0, 0])).toThrow();
  });
});

describe('SurfaceField against a brute-force search', () => {
  // A sphere of radius 5 (outward normals): a pole at each end and 16 vertices around each of 7 rings between.
  const R = 5;
  const sphere = (): Mesh => {
    const [around, rings] = [16, 7];
    const pos: number[] = [0, R, 0, 0, -R, 0]; // vertex 0 is the north pole, 1 the south pole
    for (let j = 1; j <= rings; j++) for (let i = 0; i < around; i++) { const phi = (Math.PI * j) / (rings + 1); const th = (2 * Math.PI * i) / around; pos.push(R * Math.sin(phi) * Math.cos(th), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(th)); }
    const id = (i: number, j: number) => 2 + (j - 1) * around + (i % around);
    const tris: number[] = [];
    for (let i = 0; i < around; i++) { tris.push(0, id(i + 1, 1), id(i, 1)); tris.push(1, id(i, rings), id(i + 1, rings)); }
    for (let j = 1; j < rings; j++) for (let i = 0; i < around; i++) { tris.push(id(i, j), id(i + 1, j), id(i, j + 1)); tris.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)); }
    return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) };
  };
  const brute = (m: Mesh, p: [number, number, number]) => {
    let best = Infinity;
    for (let t = 0; t < triangleCount(m); t++) {
      const [a, b, c] = [0, 1, 2].map((k) => getVertex(m, m.triangles[3 * t + k]));
      const w = closestBary(p, a, b, c);
      best = Math.min(best, len(sub([0, 1, 2].map((k) => w[0] * a[k] + w[1] * b[k] + w[2] * c[k]) as [number, number, number], p)));
    }
    return best;
  };

  it('finds the same closest distance as testing every triangle, for points inside, near, far and outside the grid, with the right side', () => {
    const m = sphere();
    for (const cell of [1, 2.5, 20]) {
      const field = new SurfaceField(m, cell);
      let seed = 12345;
      const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let n = 0; n < 150; n++) {
        const p: [number, number, number] = [(rnd() - 0.5) * 40, (rnd() - 0.5) * 40, (rnd() - 0.5) * 40];
        const got = field.closest(p);
        expect(Math.abs(got.signed)).toBeCloseTo(brute(m, p), 9);
        expect(len(sub(got.point, p))).toBeCloseTo(Math.abs(got.signed), 9);
        if (Math.abs(len(p) - R) > 0.6) expect(Math.sign(got.signed)).toBe(Math.sign(len(p) - R));
      }
    }
  });
});
