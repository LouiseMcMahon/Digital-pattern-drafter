import { describe, expect, it, vi } from 'vitest';
import type { Mesh } from './mesh';
import { computePanels } from './panelPipeline';
import { type Seam, SurfaceGraph, raycast } from './seam';

// flatten is replaced by one that fails, to check a piece that cannot be flattened is reported and the others carry on.
let failWith: unknown = new Error('no solution');
vi.mock('./flatten', () => ({ flatten: () => { throw failWith; } }));

function grid(n: number, size: number): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push((i * size) / n, (j * size) / n, 0);
  const tris: number[] = [];
  const id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}
const m = grid(8, 8);
const graph = new SurfaceGraph(m.triangles, m.positions.length / 3);
const at = (x: number, y: number) => raycast(m, [x, y, 5], [0, 0, -1])!;
const seam: Seam = { points: [at(2, 2), at(6, 2), at(6, 6), at(2, 6)], closed: true };

describe('computePanels when flattening fails', () => {
  it('says so, with the reason, and keeps the size and triangles', () => {
    failWith = new Error('no solution');
    const [p] = computePanels(m, graph, [seam], [{ seed: at(4, 4), horizontal: 0, vertical: 0 }]).panels;
    expect(p.error).toBe('This piece could not be flattened (no solution). Check its seams and make the panel again.');
    expect(p.size).toBeCloseTo(16, 6);
    expect(p.triangles.length).toBeGreaterThan(0);
  });
  it('copes with something thrown that is not an Error', () => {
    failWith = 'plain text';
    const [p] = computePanels(m, graph, [seam], [{ seed: at(4, 4), horizontal: 0, vertical: 0 }]).panels;
    expect(p.error).toBe('This piece could not be flattened (unknown error). Check its seams and make the panel again.');
  });
});
