import { describe, expect, it } from 'vitest';
import { MAX_PANEL_SHARE, type PanelFlat, computePanels } from './panelPipeline';
import type { Mesh } from './mesh';
import { type Seam, type SurfacePoint, SurfaceGraph, raycast } from './seam';

/** n x n squares of side `size` in z = 0. */
function grid(n: number, size: number): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push((i * size) / n, (j * size) / n, 0);
  const tris: number[] = [];
  const id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}
const m = grid(16, 16);
const graph = new SurfaceGraph(m.triangles, m.positions.length / 3);
const at = (x: number, y: number): SurfacePoint => raycast(m, [x, y, 5], [0, 0, -1])!;
const loop = (...pts: [number, number][]): Seam => ({ points: pts.map(([x, y]) => at(x, y)), closed: true });
const panel = (x: number, y: number, horizontal = 0, vertical = 0) => ({ seed: at(x, y), horizontal, vertical });
const flatOf = (r: ReturnType<typeof computePanels>['panels'][number]) => { if (r.error) throw new Error(r.error); return r as PanelFlat; };
/** Area of the flat outline (shoelace). The flat piece may be turned any way round, so its bounding box says little: area does not. */
const outlineArea = (p: PanelFlat) => {
  let sum = 0;
  p.loop.forEach((v, i) => {
    const w = p.loop[(i + 1) % p.loop.length];
    sum += p.flat.uv[2 * v] * p.flat.uv[2 * w + 1] - p.flat.uv[2 * w] * p.flat.uv[2 * v + 1];
  });
  return Math.abs(sum) / 2;
};

describe('computePanels', () => {
  const square = loop([4.5, 4.5], [10.5, 4.5], [10.5, 10.5], [4.5, 10.5]); // off the mesh lines, so the mesh has to be cut

  it('flattens the area inside a closed seam and reports its size, outline and sides', () => {
    const { cut, panels } = computePanels(m, graph, [square], [panel(7, 7)]);
    expect(panels).toHaveLength(1);
    const p = flatOf(panels[0]);
    expect(p.size).toBeCloseTo(36, 6);
    expect(p.flat.worstStrain).toBeLessThan(1e-6); // flat stays flat
    expect(p.flat.flippedTriangles).toBe(0);
    expect(p.flat.rmsEdgeError).toBeLessThan(1e-6);
    expect(p.flat.uv).toHaveLength(2 * p.sub.mesh.positions.length / 3);
    expect(p.flat.vertexStrain).toHaveLength(p.sub.mesh.positions.length / 3);
    expect(outlineArea(p)).toBeCloseTo(36, 3);
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].seam).toBe(0);
    expect(p.edges[0].length).toBeCloseTo(24, 6);
    expect(p.edges[0].flatLength).toBeCloseTo(24, 6);
    // the panel's triangles index into the cut mesh, and the cut mesh has the vertices the seam added
    expect(cut.triangles.length).toBeGreaterThan(m.triangles.length);
    expect(p.triangles.every((t) => t >= 0 && 3 * t < cut.triangles.length)).toBe(true);
    expect(p.sub.vertexMap).toHaveLength(p.sub.mesh.positions.length / 3);
    expect(p.loop.length).toBeGreaterThanOrEqual(4);
  });

  it('without draping the panel is cut straight from the skin: the draped mesh is the panel itself and nothing stands off', () => {
    const r = computePanels(m, graph, [square], [panel(7, 7)]);
    const p = flatOf(r.panels[0]);
    expect(p.draped.positions).toEqual(p.sub.mesh.positions);
    expect(p.gap).toHaveLength(p.sub.mesh.positions.length / 3);
    expect(Math.max(...p.gap)).toBe(0);
    expect(r.taut).toHaveLength(r.cut.positions.length);
  });

  it('with draping on, a flat body stays flat: the cloth rests on it, the seams are not moved, the pattern is the same size', () => {
    const r = computePanels(m, graph, [square], [panel(7, 7)], true);
    const p = flatOf(r.panels[0]);
    expect(Math.max(...p.gap)).toBeLessThan(1e-3);
    expect(p.draped.positions).toHaveLength(p.sub.mesh.positions.length);
    for (let i = 2; i < p.draped.positions.length; i += 3) expect(Math.abs(p.draped.positions[i])).toBeLessThan(1e-3);
    expect(outlineArea(p)).toBeCloseTo(36, 1);
    expect(r.taut).toHaveLength(r.cut.positions.length);
    expect(p.draped.triangles).toEqual(p.sub.mesh.triangles);
  });

  it('applies the ease of each panel on its own, across (x) and down (y)', () => {
    const { panels } = computePanels(m, graph, [square], [panel(7, 7, 10, -5), panel(7, 7, 0, 0)]);
    const [eased, plain] = [flatOf(panels[0]), flatOf(panels[1])];
    expect(outlineArea(plain)).toBeCloseTo(36, 3);
    expect(outlineArea(eased) / 36).toBeGreaterThan(1.1 * 0.95 * 0.98); // 10% wider and 5% shorter: 4.5% more area
    expect(outlineArea(eased) / 36).toBeLessThan(1.1 * 0.95 * 1.02);
    expect(eased.edges[0].flatLength).toBeGreaterThan(22.8); // between 5% shorter and 10% longer than 24
    expect(eased.edges[0].flatLength).toBeLessThan(26.4);
    expect(eased.edges[0].length).toBeCloseTo(24, 6); // the body length does not change with ease
    expect(eased.edges[0].flatLength).not.toBeCloseTo(24, 1); // the flat one does
  });

  it('gives each panel between two seams its own sides and says which seam each side is', () => {
    const left = loop([2, 2], [8, 2], [8, 12], [2, 12]);
    const right = loop([8, 2], [14, 2], [14, 12], [8, 12]);
    const { panels } = computePanels(m, graph, [left, right], [panel(5, 7), panel(11, 7)]);
    const [a, b] = [flatOf(panels[0]), flatOf(panels[1])];
    expect(a.size).toBeCloseTo(60, 6);
    expect(b.size).toBeCloseTo(60, 6);
    // the shared side is seam 0 on the left panel's outline and seam 1 on the right's, equal in length
    const shared = (p: PanelFlat) => p.edges.filter((e) => e.seam !== undefined);
    expect(shared(a).map((e) => e.seam).sort()).toContain(0);
    expect(shared(b).map((e) => e.seam).sort()).toContain(1);
    const lengths = (p: PanelFlat) => p.edges.map((e) => e.length).sort((x, y) => x - y);
    expect(lengths(a).reduce((s, v) => s + v, 0)).toBeCloseTo(32, 6);
  });

  it('reports a region the seams do not close in, without flattening it', () => {
    const { panels } = computePanels(m, graph, [square], [panel(1, 1)]);
    const p = panels[0];
    expect(p.error).toMatch(/do not enclose/);
    expect(p.size).toBeGreaterThan(MAX_PANEL_SHARE * 256 - 1e-9);
    expect(p.triangles.length).toBeGreaterThan(0);
    expect('flat' in p).toBe(false);
  });

  it('uses the share limit exactly: just under it flattens, over it does not', () => {
    // a square taking 144 of 256 cm² (56%), and one taking 169 (66%)
    const under = computePanels(m, graph, [loop([2, 2], [14, 2], [14, 14], [2, 14])], [panel(8, 8)]).panels[0];
    expect(under.error).toBeUndefined();
    expect(MAX_PANEL_SHARE).toBe(0.6);
    const over = computePanels(m, graph, [loop([1.5, 1.5], [14.5, 1.5], [14.5, 14.5], [1.5, 14.5])], [panel(8, 8)]).panels[0];
    expect(over.error).toMatch(/do not enclose/);
  });

  it('reports a region with more than one edge (a ring between two closed seams)', () => {
    const outer = loop([2, 2], [12, 2], [12, 12], [2, 12]);
    const inner = loop([5, 5], [9, 5], [9, 9], [5, 9]);
    const { panels } = computePanels(m, graph, [outer, inner], [panel(3, 7), panel(7, 7)]);
    expect(panels[0].error).toMatch(/This area has 2 edges/);
    expect(panels[0].size).toBeCloseTo(100 - 16, 6);
    expect(panels[1].error).toBeUndefined(); // the inside is fine on its own
  });

  it('one bad panel does not stop the others', () => {
    const { panels } = computePanels(m, graph, [square], [panel(1, 1), panel(7, 7), panel(1, 1)]);
    expect(panels.map((p) => p.error === undefined)).toEqual([false, true, false]);
  });

  it('returns nothing to show for no panels, and still returns the cut', () => {
    const r = computePanels(m, graph, [square], []);
    expect(r.panels).toEqual([]);
    expect(r.cut.triangles.length).toBeGreaterThan(m.triangles.length);
    const none = computePanels(m, graph, [], []);
    expect(none.cut.triangles.length).toBe(m.triangles.length);
  });

  it('is plain data: it survives a structured clone (what a worker needs)', () => {
    const r = computePanels(m, graph, [square], [panel(7, 7)]);
    const copy = structuredClone(r);
    expect(flatOf(copy.panels[0]).flat.uv).toEqual(flatOf(r.panels[0]).flat.uv);
    expect(copy.cut.positions).toEqual(r.cut.positions);
  });
});
