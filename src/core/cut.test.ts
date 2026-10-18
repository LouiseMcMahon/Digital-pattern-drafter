import { describe, expect, it } from 'vitest';
import { area, cutMesh, locateInCut, panelEdges, regionFrom, triangleArea } from './cut';
import { type Mesh, boundaryLoops, extractSubmesh } from './mesh';
import { type Seam, type SurfacePoint, SurfaceGraph, polylineLength, raycast, vertexPoint } from './seam';

/** n x n squares of side `size` in z = 0, each cut along one diagonal. Vertex (i, j) has id j * (n + 1) + i. */
function grid(n: number, size: number): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push((i * size) / n, (j * size) / n, 0);
  const tris: number[] = [];
  const id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}

/** Open tube of radius r and height h: `around` segments, `rows` bands. */
function tube(around: number, rows: number, r: number, h: number): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i < around; i++) positions.push(r * Math.cos((2 * Math.PI * i) / around), (h * j) / rows, r * Math.sin((2 * Math.PI * i) / around));
  const tris: number[] = [];
  const id = (i: number, j: number) => j * around + (i % around);
  for (let j = 0; j < rows; j++) for (let i = 0; i < around; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}

const graphOf = (m: Mesh) => new SurfaceGraph(m.triangles, m.positions.length / 3);
const pointAt = (m: Mesh, x: number, y: number): SurfacePoint => raycast(m, [x, y, 5], [0, 0, -1])!;
const closed = (m: Mesh, pts: [number, number][]): Seam => ({ points: pts.map(([x, y]) => pointAt(m, x, y)), closed: true });
const open = (m: Mesh, pts: [number, number][]): Seam => ({ points: pts.map(([x, y]) => pointAt(m, x, y)), closed: false });
const shoelace = (poly: number[]) => {
  let s = 0;
  const n = poly.length / 3;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += poly[3 * i] * poly[3 * j + 1] - poly[3 * j] * poly[3 * i + 1]; }
  return Math.abs(s) / 2;
};
const allTriangles = (m: Mesh) => Array.from({ length: m.triangles.length / 3 }, (_, i) => i);

/** Distance from a point to a polyline (xyz interleaved). */
function distanceToPolyline(p: number[], line: number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < line.length; i += 3) {
    const d = [line[i + 3] - line[i], line[i + 4] - line[i + 1], line[i + 5] - line[i + 2]];
    const l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - line[i]) * d[0] + (p[1] - line[i + 1]) * d[1] + (p[2] - line[i + 2]) * d[2]) / l2)) : 0;
    best = Math.min(best, Math.hypot(line[i] + t * d[0] - p[0], line[i + 1] + t * d[1] - p[1], line[i + 2] + t * d[2] - p[2]));
  }
  return best;
}
const seamEdgeList = (cut: ReturnType<typeof cutMesh>) =>
  [...cut.seamEdges].map((key) => [Math.floor(key / cut.vertexCount), key % cut.vertexCount] as [number, number]);

/** Every edge is shared by at most two triangles, no triangle is degenerate, no two vertices coincide, and nothing is flipped over (flat z = 0 meshes face +z). */
function expectWellFormed(m: Mesh, facing?: 'up') {
  const seenAt = new Set<string>();
  for (let v = 0; v < m.positions.length / 3; v++) {
    const key = [0, 1, 2].map((k) => m.positions[3 * v + k].toFixed(7)).join(',');
    expect(seenAt.has(key)).toBe(false);
    seenAt.add(key);
  }
  if (facing) {
    for (let t = 0; t < m.triangles.length / 3; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => m.triangles[3 * t + k] * 3);
      const q = m.positions;
      expect((q[b] - q[a]) * (q[c + 1] - q[a + 1]) - (q[b + 1] - q[a + 1]) * (q[c] - q[a])).toBeGreaterThan(0);
    }
  }
  const uses = new Map<string, number>();
  const n = m.positions.length / 3;
  for (let t = 0; t < m.triangles.length / 3; t++) {
    expect(triangleArea(m, t)).toBeGreaterThan(1e-9);
    for (let k = 0; k < 3; k++) {
      const a = m.triangles[3 * t + k];
      const b = m.triangles[3 * t + ((k + 1) % 3)];
      expect(a).toBeLessThan(n);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  for (const c of uses.values()) expect(c).toBeLessThanOrEqual(2);
}

describe('cutMesh without seams', () => {
  it('returns the same triangles', () => {
    const m = grid(3, 3);
    const cut = cutMesh(m, graphOf(m), []);
    expect(Array.from(cut.mesh.triangles)).toEqual(Array.from(m.triangles));
    expect(cut.parent).toEqual(allTriangles(m));
    expect(cut.seamEdges.size).toBe(0);
  });
  it('ignores a seam with one point', () => {
    const m = grid(3, 3);
    const cut = cutMesh(m, graphOf(m), [open(m, [[1.3, 1.3]])]);
    expect(cut.mesh.triangles.length).toBe(m.triangles.length);
  });
});

describe('cutMesh with a closed seam on a flat grid', () => {
  const m = grid(6, 6);
  const g = graphOf(m);
  const seam = closed(m, [[1.3, 1.3], [4.7, 1.3], [4.7, 4.7], [1.3, 4.7]]);
  const cut = cutMesh(m, g, [seam]);
  const loop = g.seamPath(m.positions, seam);

  it('keeps the surface: same total area, nothing degenerate, no edge shared by three triangles, same facing', () => {
    expect(area(cut.mesh, allTriangles(cut.mesh))).toBeCloseTo(36, 9);
    expectWellFormed(cut.mesh, 'up');
  });
  it('marks exactly the edges on the seam: each lies on the path, and together they cover it', () => {
    const edges = seamEdgeList(cut);
    const p = cut.mesh.positions;
    for (const [a, b] of edges) {
      expect(distanceToPolyline([p[3 * a], p[3 * a + 1], p[3 * a + 2]], loop)).toBeLessThan(1e-9);
      expect(distanceToPolyline([p[3 * b], p[3 * b + 1], p[3 * b + 2]], loop)).toBeLessThan(1e-9);
      expect(distanceToPolyline([(p[3 * a] + p[3 * b]) / 2, (p[3 * a + 1] + p[3 * b + 1]) / 2, 0], loop)).toBeLessThan(1e-9);
    }
    // every vertex of the path polyline is a vertex of the cut
    for (let i = 0; i < loop.length; i += 3) {
      const used = edges.some(([a, b]) => [a, b].some((v) => Math.hypot(p[3 * v] - loop[i], p[3 * v + 1] - loop[i + 1]) < 1e-9));
      expect(used).toBe(true);
    }
  });
  it('a region is sorted and contains its starting triangle', () => {
    const start = locateInCut(cut, m, pointAt(m, 3, 3));
    const r = regionFrom(cut, start);
    expect(r).toContain(start);
    expect([...r].sort((x, y) => x - y)).toEqual(r);
  });
  it('every new triangle remembers the triangle it came from, and lies inside it', () => {
    expect(cut.parent.length).toBe(cut.mesh.triangles.length / 3);
    for (let t = 0; t < cut.parent.length; t++) expect(cut.parent[t]).toBeLessThan(m.triangles.length / 3);
    for (let p = 0; p < m.triangles.length / 3; p++) {
      const children = allTriangles(cut.mesh).filter((t) => cut.parent[t] === p);
      expect(area(cut.mesh, children)).toBeCloseTo(triangleArea(m, p), 9);
    }
  });
  it('the region inside is exactly the area the seam path encloses', () => {
    const start = locateInCut(cut, m, pointAt(m, 3, 3));
    const inside = regionFrom(cut, start);
    expect(area(cut.mesh, inside)).toBeCloseTo(shoelace(loop), 9);
  });
  it('the region outside is the rest', () => {
    const outside = regionFrom(cut, locateInCut(cut, m, pointAt(m, 0.4, 0.4)));
    expect(area(cut.mesh, outside)).toBeCloseTo(36 - shoelace(loop), 9);
  });
  it('the seam edges add up to the length of the seam', () => {
    let total = 0;
    for (const key of cut.seamEdges) {
      const [a, b] = [Math.floor(key / cut.vertexCount), key % cut.vertexCount];
      const p = cut.mesh.positions;
      total += Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
    }
    expect(total).toBeCloseTo(polylineLength(loop), 9);
  });
  it('the inside is a disc (one boundary loop) and the outside an annulus (two)', () => {
    const inside = extractSubmesh(cut.mesh, regionFrom(cut, locateInCut(cut, m, pointAt(m, 3, 3))));
    expect(boundaryLoops(inside.mesh)).toHaveLength(1);
    const outside = extractSubmesh(cut.mesh, regionFrom(cut, locateInCut(cut, m, pointAt(m, 0.4, 0.4))));
    expect(boundaryLoops(outside.mesh)).toHaveLength(2);
  });
});

describe('cutMesh details', () => {
  it('an open seam does not split the surface', () => {
    const m = grid(6, 6);
    const cut = cutMesh(m, graphOf(m), [open(m, [[1.3, 1.3], [4.7, 4.3]])]);
    expect(regionFrom(cut, 0)).toHaveLength(cut.mesh.triangles.length / 3);
    expect(cut.seamEdges.size).toBeGreaterThan(0);
    expectWellFormed(cut.mesh);
  });
  it('an open seam from edge to edge splits the surface in two', () => {
    const m = grid(6, 6);
    const seam = open(m, [[3.2, 0], [3.2, 6]]);
    const cut = cutMesh(m, graphOf(m), [seam]);
    const left = regionFrom(cut, locateInCut(cut, m, pointAt(m, 1, 3)));
    // The path zigzags a little, so the expected area is that of the polygon: the path, then back along the left side.
    expect(area(cut.mesh, left)).toBeCloseTo(shoelace([...graphOf(m).seamPath(m.positions, seam), 0, 6, 0, 0, 0, 0]), 9);
    const right = regionFrom(cut, locateInCut(cut, m, pointAt(m, 5, 3)));
    expect(area(cut.mesh, left) + area(cut.mesh, right)).toBeCloseTo(36, 9);
    expectWellFormed(cut.mesh);
  });
  it('a seam along mesh edges (vertex to vertex) makes rectangles', () => {
    const m = grid(6, 6); // vertex (i, j) = j * 7 + i
    const v = (i: number, j: number) => vertexPoint(m, j * 7 + i);
    const seam: Seam = { points: [v(2, 2), v(4, 2), v(4, 4), v(2, 4)], closed: true };
    const cut = cutMesh(m, graphOf(m), [seam]);
    expect(Array.from(cut.mesh.triangles).length).toBeGreaterThanOrEqual(m.triangles.length);
    const inside = regionFrom(cut, locateInCut(cut, m, pointAt(m, 3, 3)));
    expect(area(cut.mesh, inside)).toBeCloseTo(4, 9);
    expectWellFormed(cut.mesh);
  });
  it('two seams that meet at a shared point cut three regions (a T)', () => {
    const m = grid(6, 6);
    const junction = pointAt(m, 3.1, 2.9);
    const horizontal: Seam = { points: [pointAt(m, 0, 2.9), junction, pointAt(m, 6, 2.9)], closed: false };
    const vertical: Seam = { points: [junction, pointAt(m, 3.1, 6)], closed: false };
    const cut = cutMesh(m, graphOf(m), [horizontal, vertical]);
    const areas = [[1, 5], [5, 5], [1, 1]].map(([x, y]) => area(cut.mesh, regionFrom(cut, locateInCut(cut, m, pointAt(m, x, y)))));
    expect(areas[0] + areas[1] + areas[2]).toBeCloseTo(36, 9);
    // Left above: the horizontal seam up to the junction, the vertical seam up to the top, then round the corner.
    const g = graphOf(m);
    const h1 = g.seamPath(m.positions, { points: [horizontal.points[0], junction], closed: false });
    const v1 = g.seamPath(m.positions, vertical);
    expect(areas[0]).toBeCloseTo(shoelace([...h1, ...v1.slice(3), 0, 6, 0]), 9);
    expect(areas[0]).toBeGreaterThan(8);
    expect(areas[1]).toBeGreaterThan(8);
    expect(areas[2]).toBeGreaterThan(16);
    expectWellFormed(cut.mesh);
  });
  it('two control points inside one triangle (a short seam segment) are cut correctly', () => {
    const m = grid(6, 6);
    const seam: Seam = { points: [pointAt(m, 2.2, 2.1), pointAt(m, 2.45, 2.2), pointAt(m, 4.5, 3.9)], closed: false };
    const cut = cutMesh(m, graphOf(m), [seam]);
    expectWellFormed(cut.mesh);
    expect(area(cut.mesh, allTriangles(cut.mesh))).toBeCloseTo(36, 9);
  });
  it('a seam point that sits on an edge or vertex does not create a sliver', () => {
    const m = grid(4, 4);
    const onEdge = pointAt(m, 1.5, 1); // on a horizontal mesh edge
    const cut = cutMesh(m, graphOf(m), [{ points: [pointAt(m, 0.3, 0.3), onEdge, pointAt(m, 3.3, 2.6)], closed: false }]);
    expectWellFormed(cut.mesh);
  });
  it('a seam that crosses a curved surface keeps its area (tube, ring seam splits it in two)', () => {
    const m = tube(24, 8, 5, 16);
    const g = graphOf(m);
    const ring: Seam = {
      points: [0, 6, 12, 18].map((i) => ({ tri: 2 * 24 * 3 + 2 * i, bary: [1 / 3, 1 / 3, 1 / 3] as [number, number, number] })),
      closed: true,
    };
    const cut = cutMesh(m, g, [ring]);
    expectWellFormed(cut.mesh);
    const total = area(m, allTriangles(m));
    expect(area(cut.mesh, allTriangles(cut.mesh))).toBeCloseTo(total, 6);
    const top = regionFrom(cut, locateInCut(cut, m, { tri: 2 * 24 * 7 + 1, bary: [0.3, 0.3, 0.4] }));
    const bottom = regionFrom(cut, locateInCut(cut, m, { tri: 1, bary: [0.3, 0.3, 0.4] }));
    expect(area(cut.mesh, top) + area(cut.mesh, bottom)).toBeCloseTo(total, 6);
    expect(boundaryLoops(extractSubmesh(cut.mesh, top).mesh)).toHaveLength(2); // a band: top rim and the seam
  });
});

describe('cutMesh point placement', () => {
  const m = grid(4, 4);
  const g = graphOf(m);
  it('a control point at a vertex (to within rounding) uses the vertex and adds no vertex of its own', () => {
    const v = 2 * 5 + 2; // vertex (2, 2)
    const near: SurfacePoint = { tri: vertexPoint(m, v).tri, bary: (() => { const b = vertexPoint(m, v).bary; return b.map((w) => (w === 1 ? 1 - 2e-8 : 1e-8)) as [number, number, number]; })() };
    const seam: Seam = { points: [vertexPoint(m, v + 1), near], closed: false }; // vertex (3, 2) to the near-vertex point: one mesh edge
    const cut = cutMesh(m, g, [seam]);
    const p = cut.mesh.positions;
    const close = [...Array(p.length / 3).keys()].filter((i) => Math.hypot(p[3 * i] - 2, p[3 * i + 1] - 2) < 1e-4);
    expect(close).toEqual([v]);
    expect(cut.seamEdges.has(Math.min(v, v + 1) * cut.vertexCount + Math.max(v, v + 1))).toBe(true);
  });
  it('a control point on an edge (to within rounding) is placed on that edge', () => {
    // On the horizontal edge between vertices (1, 2) and (2, 2), a quarter of the way along.
    const a = 2 * 5 + 1;
    const t = raycast(m, [1.25, 2, 5], [0, 0, -1])!;
    const nudged: SurfacePoint = { tri: t.tri, bary: t.bary.map((w) => (w < 1e-9 ? 1e-9 : w)) as [number, number, number] };
    const cut = cutMesh(m, g, [{ points: [nudged, vertexPoint(m, a + 5 + 1)], closed: false }]);
    const p = cut.mesh.positions;
    const onEdge = [...Array(p.length / 3).keys()].filter((i) => Math.abs(p[3 * i] - 1.25) < 1e-6 && Math.abs(p[3 * i + 1] - 2) < 1e-6);
    expect(onEdge).toHaveLength(1);
    expect(Math.abs(p[3 * onEdge[0] + 2])).toBeLessThan(1e-12);
    expectWellFormed(cut.mesh, 'up');
  });
  it('two seams that pass through the same point on an edge share one vertex there', () => {
    const across: Seam = { points: [pointAt(m, 0.4, 2), pointAt(m, 3.6, 2)], closed: false };
    const cross: Seam = { points: [pointAt(m, 2.5, 0.4), pointAt(m, 2.5, 3.6)], closed: false };
    const cut = cutMesh(m, g, [across, cross]);
    expectWellFormed(cut.mesh, 'up'); // no duplicate vertices
    expect(area(cut.mesh, allTriangles(cut.mesh))).toBeCloseTo(16, 9);
  });
  it('a seam segment between two points inside one triangle is a mesh edge', () => {
    const a = pointAt(m, 0.7, 0.2);
    const b = pointAt(m, 0.9, 0.3);
    expect(a.tri).toBe(b.tri);
    const cut = cutMesh(m, g, [{ points: [a, b], closed: false }]);
    const p = cut.mesh.positions;
    const at = (x: number, y: number) => [...Array(p.length / 3).keys()].find((i) => Math.hypot(p[3 * i] - x, p[3 * i + 1] - y) < 1e-9)!;
    const [u, w] = [at(0.7, 0.2), at(0.9, 0.3)];
    expect(cut.seamEdges.has(Math.min(u, w) * cut.vertexCount + Math.max(u, w))).toBe(true);
    expect(cut.seamEdges.size).toBe(1);
    expectWellFormed(cut.mesh, 'up');
  });
  it('a seam through three points inside one triangle and out through its edge', () => {
    const pts = [pointAt(m, 0.55, 0.1), pointAt(m, 0.8, 0.2), pointAt(m, 0.9, 0.55), pointAt(m, 0.4, 1.4)];
    const cut = cutMesh(m, g, [{ points: pts, closed: false }]);
    expectWellFormed(cut.mesh, 'up');
    expect(cut.seamEdges.size).toBeGreaterThanOrEqual(4);
  });
});

describe('locateInCut', () => {
  it('finds the child triangle that holds the point', () => {
    const m = grid(6, 6);
    const cut = cutMesh(m, graphOf(m), [closed(m, [[1.3, 1.3], [4.7, 1.3], [4.7, 4.7], [1.3, 4.7]])]);
    const p = pointAt(m, 2.6, 3.1);
    const t = locateInCut(cut, m, p);
    expect(cut.parent[t]).toBe(p.tri);
    const [a, b, c] = [0, 1, 2].map((k) => cut.mesh.triangles[3 * t + k]);
    const q = cut.mesh.positions;
    const xs = [a, b, c].map((v) => q[3 * v]);
    const ys = [a, b, c].map((v) => q[3 * v + 1]);
    expect(Math.min(...xs)).toBeLessThanOrEqual(2.6 + 1e-9);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(2.6 - 1e-9);
    expect(Math.min(...ys)).toBeLessThanOrEqual(3.1 + 1e-9);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(3.1 - 1e-9);
  });
});

describe('seamsOfEdge and panelEdges', () => {
  const m = grid(6, 6);
  const g = graphOf(m);
  const total = (edges: { length: number }[]) => edges.reduce((s, e) => s + e.length, 0);

  it('each seam edge knows which seam it lies on', () => {
    const a = open(m, [[0.4, 1.7], [5.6, 1.9]]);
    const b = open(m, [[0.4, 4.2], [5.6, 4.4]]);
    const cut = cutMesh(m, g, [a, b]);
    const seamsSeen = new Set([...cut.seamsOfEdge.values()].flat());
    expect([...seamsSeen].sort()).toEqual([0, 1]);
    expect(cut.seamsOfEdge.size).toBe(cut.seamEdges.size);
    for (const key of cut.seamEdges) expect(cut.seamsOfEdge.get(key)!.length).toBe(1);
  });
  it('a panel bounded by one closed seam has one side, as long as the seam', () => {
    const seam = closed(m, [[1.3, 1.3], [4.7, 1.3], [4.7, 4.7], [1.3, 4.7]]);
    const cut = cutMesh(m, g, [seam]);
    const inside = regionFrom(cut, locateInCut(cut, m, pointAt(m, 3, 3)));
    const edges = panelEdges(cut, inside)!;
    expect(edges).toHaveLength(1);
    expect(edges[0].seam).toBe(0);
    expect(edges[0].length).toBeCloseTo(polylineLength(g.seamPath(m.positions, seam)), 9);
  });
  it('a panel bounded by several seams has one side per seam, in order round, and neighbouring panels share a side', () => {
    // A column between two vertical seams, running edge to edge: panels left, middle, right.
    const left = open(m, [[2, 0], [2, 6]]);
    const right = open(m, [[4, 0], [4, 6]]);
    const cut = cutMesh(m, g, [left, right]);
    const middle = panelEdges(cut, regionFrom(cut, locateInCut(cut, m, pointAt(m, 3, 3))))!;
    const leftPanel = panelEdges(cut, regionFrom(cut, locateInCut(cut, m, pointAt(m, 1, 3))))!;
    const seamsOf = (edges: { seam: number | undefined }[]) => edges.map((e) => e.seam);
    expect(middle.filter((e) => e.seam !== undefined).map((e) => e.seam).sort()).toEqual([0, 1]);
    expect(seamsOf(middle).some((q) => q === undefined)).toBe(true); // the top and bottom are the mesh border
    expect(leftPanel.some((e) => e.seam === 0)).toBe(true);
    const shared = (e: { seam: number | undefined; length: number }[], k: number) => e.find((x) => x.seam === k)!.length;
    expect(shared(middle, 0)).toBeCloseTo(shared(leftPanel, 0), 9); // the same line seen from both panels
    expect(total(middle)).toBeGreaterThan(6 * 2);
  });
  it('is undefined for a region that is not a disc (an annulus)', () => {
    const cut = cutMesh(m, g, [closed(m, [[1.3, 1.3], [4.7, 1.3], [4.7, 4.7], [1.3, 4.7]])]);
    expect(panelEdges(cut, regionFrom(cut, locateInCut(cut, m, pointAt(m, 0.4, 0.4))))).toBeUndefined();
  });
});
