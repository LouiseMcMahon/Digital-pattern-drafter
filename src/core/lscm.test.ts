import { describe, expect, it } from 'vitest';
import { lscm } from './lscm';
import type { Mesh } from './mesh';

const dist2 = (uv: Float64Array, a: number, b: number) => Math.hypot(uv[2 * a] - uv[2 * b], uv[2 * a + 1] - uv[2 * b + 1]);
const dist3 = (m: Mesh, a: number, b: number) =>
  Math.hypot(m.positions[3 * a] - m.positions[3 * b], m.positions[3 * a + 1] - m.positions[3 * b + 1], m.positions[3 * a + 2] - m.positions[3 * b + 2]);

/** A w x h grid of unit-spaced vertices in a plane given by two axis vectors. */
function grid(w: number, h: number, ex: number[], ey: number[], scale = 1): Mesh {
  const pos: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pos.push(...[0, 1, 2].map((k) => scale * (i * ex[k] + j * ey[k])));
  const tris: number[] = [];
  for (let j = 0; j + 1 < h; j++) {
    for (let i = 0; i + 1 < w; i++) {
      const a = j * w + i;
      tris.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
    }
  }
  return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) };
}

function expectIsometric(m: Mesh, uv: Float64Array, tol: number) {
  const n = m.positions.length / 3;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) expect(Math.abs(dist2(uv, a, b) - dist3(m, a, b))).toBeLessThan(tol);
}

describe('lscm', () => {
  it('returns two coordinates per vertex', () => {
    const m = grid(3, 3, [1, 0, 0], [0, 1, 0]);
    expect(lscm(m)).toHaveLength(18);
  });
  it('flat patch in the xy plane maps isometrically (all pairwise distances kept)', () => {
    const m = grid(4, 3, [1, 0, 0], [0, 1, 0]);
    expectIsometric(m, lscm(m), 1e-6);
  });
  it('flat patch in a tilted plane maps isometrically', () => {
    const s = Math.SQRT1_2;
    const m = grid(4, 4, [1, 0, 0], [0, s, s], 2.5);
    expectIsometric(m, lscm(m), 1e-6);
  });
  it('pins two far-apart vertices: one at the origin, the other on the +u axis at their 3D distance', () => {
    const m = grid(5, 2, [1, 0, 0], [0, 1, 0]);
    const uv = lscm(m);
    // Farthest-from-farthest pair on a 5x2 grid is a diagonal corner pair at distance sqrt(17).
    const D = Math.sqrt(17);
    let found = false;
    for (let a = 0; a < 10; a++) {
      if (uv[2 * a] === 0 && uv[2 * a + 1] === 0) {
        for (let b = 0; b < 10; b++) if (b !== a && uv[2 * b] === D && uv[2 * b + 1] === 0) found = true;
      }
    }
    expect(found).toBe(true);
  });
  it('does not flip any triangle on a flat patch', () => {
    const m = grid(5, 4, [1, 0, 0], [0, 1, 0]);
    const uv = lscm(m);
    const signs = new Set<number>();
    for (let t = 0; t < m.triangles.length / 3; t++) {
      const [a, b, c] = [m.triangles[3 * t], m.triangles[3 * t + 1], m.triangles[3 * t + 2]];
      const area = (uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * b + 1] - uv[2 * a + 1]) * (uv[2 * c] - uv[2 * a]);
      signs.add(Math.sign(area));
    }
    expect(signs.size).toBe(1);
  });
  it('unrolls a developable half-cylinder with edge lengths preserved to within the facet error', () => {
    // Half cylinder of radius 5 sampled every 15 degrees, 3 rows of 1.3 cm.
    const r = 5;
    const cols = 13;
    const pos: number[] = [];
    for (let j = 0; j < 3; j++) for (let i = 0; i < cols; i++) {
      const th = (i * Math.PI) / 12;
      pos.push(r * Math.cos(th), 1.3 * j, r * Math.sin(th));
    }
    const tris: number[] = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i + 1 < cols; i++) {
      const a = j * cols + i;
      tris.push(a, a + 1, a + cols + 1, a, a + cols + 1, a + cols);
    }
    const m: Mesh = { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) };
    const uv = lscm(m);
    // The map is only defined up to scale (the pins sit at their 3D distance, the chord, not the arc), so compare edge
    // lengths after fitting one common scale; being conformal it is close but not exactly isometric on facets.
    const edges: [number, number][] = [];
    for (let t = 0; t < tris.length / 3; t++) for (let k = 0; k < 3; k++) edges.push([tris[3 * t + k], tris[3 * t + ((k + 1) % 3)]]);
    const scale = edges.reduce((s, [a, b]) => s + dist3(m, a, b), 0) / edges.reduce((s, [a, b]) => s + dist2(uv, a, b), 0);
    for (const [a, b] of edges) expect(Math.abs(scale * dist2(uv, a, b) - dist3(m, a, b)) / dist3(m, a, b)).toBeLessThan(0.05);
  });
});
