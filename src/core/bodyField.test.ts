import { describe, expect, it } from 'vitest';
import { SurfaceField } from './bodyField';
import type { Mesh } from './mesh';

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
