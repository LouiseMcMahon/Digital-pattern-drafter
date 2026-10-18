import { describe, expect, it } from 'vitest';
import { type Mesh, boundaryLoops, cross, dot, extractSubmesh, getVertex, len, meshEdges, normalize, sub, triangleCount, vertexCount, vertexNeighbours, vertexNormals } from './mesh';

// Unit square in z = 0 split into two triangles, counter-clockwise seen from +z.
//  3---2
//  | / |
//  0---1
const square = (): Mesh => ({
  positions: Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]),
});

describe('vector helpers', () => {
  it('sub, dot, cross, len', () => {
    expect(sub([5, 7, 9], [1, 2, 3])).toEqual([4, 5, 6]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(cross([0, 1, 0], [0, 0, 1])).toEqual([1, 0, 0]);
    expect(cross([0, 0, 1], [1, 0, 0])).toEqual([0, 1, 0]);
    expect(cross([1, 2, 3], [4, 5, 6])).toEqual([-3, 6, -3]);
    expect(len([2, 3, 6])).toBe(7);
  });
  it('normalize gives unit length and maps (near-)zero to zero', () => {
    expect(normalize([0, 3, 4])).toEqual([0, 0.6, 0.8]);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
    expect(normalize([1e-13, 0, 0])).toEqual([0, 0, 0]);
    const small = normalize([1e-6, 0, 0]);
    expect(small[0]).toBeCloseTo(1, 12);
  });
  it('counts and vertex lookup', () => {
    const m = square();
    expect(vertexCount(m)).toBe(4);
    expect(triangleCount(m)).toBe(2);
    expect(getVertex(m, 2)).toEqual([1, 1, 0]);
  });
});

describe('vertexNormals', () => {
  it('points along +z for a counter-clockwise flat patch', () => {
    for (const n of vertexNormals(square())) expect(n).toEqual([0, 0, 1]);
  });
  it('flips with the winding', () => {
    const m = square();
    m.triangles = Uint32Array.from([0, 2, 1, 0, 3, 2]);
    for (const n of vertexNormals(m)) expect(n).toEqual([0, 0, -1]);
  });
  it('weights by area: a big face dominates a small one at a shared vertex', () => {
    // Big triangle in z = 0 (area 2), small one in x = 0 (area 0.5) sharing vertex 0.
    const m: Mesh = {
      positions: Float64Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, -1, 0]),
      triangles: Uint32Array.from([0, 1, 2, 0, 3, 4]),
    };
    const n = vertexNormals(m)[0];
    // Face normals (unnormalised, 2*area): big = (0,0,4), small = cross((0,0,1),(0,-1,0)) = (1,0,0).
    const l = Math.hypot(4, 1);
    expect(n[0]).toBeCloseTo(1 / l, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(n[2]).toBeCloseTo(4 / l, 12);
  });
  it('gives a vertex used by no triangle a zero normal', () => {
    const m: Mesh = { positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5]), triangles: Uint32Array.from([0, 1, 2]) };
    expect(vertexNormals(m)[3]).toEqual([0, 0, 0]);
  });
});

describe('extractSubmesh', () => {
  it('renumbers vertices in first-use order and maps them back', () => {
    const { mesh, vertexMap } = extractSubmesh(square(), [1]); // triangle 0,2,3
    expect(vertexMap).toEqual([0, 2, 3]);
    expect(Array.from(mesh.triangles)).toEqual([0, 1, 2]);
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0]);
  });
  it('shares vertices between selected triangles and respects the id order', () => {
    const { mesh, vertexMap } = extractSubmesh(square(), [1, 0]);
    expect(vertexMap).toEqual([0, 2, 3, 1]);
    expect(Array.from(mesh.triangles)).toEqual([0, 1, 2, 0, 3, 1]);
    expect(vertexCount(mesh)).toBe(4);
  });
  it('an empty selection gives an empty mesh', () => {
    const { mesh, vertexMap } = extractSubmesh(square(), []);
    expect(vertexMap).toEqual([]);
    expect(mesh.triangles.length).toBe(0);
    expect(mesh.positions.length).toBe(0);
  });
});

describe('boundaryLoops', () => {
  it('finds the outline of a quad in winding order', () => {
    const loops = boundaryLoops(square());
    expect(loops).toHaveLength(1);
    // Edges in winding order: 0->1, 1->2, 2->3, 3->0 (the diagonal is shared and so interior).
    const l = loops[0];
    expect(l).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(l[(i + 1) % 4]).toBe((l[i] + 1) % 4);
  });
  it('a closed tetrahedron has no boundary', () => {
    const m: Mesh = {
      positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
    };
    expect(boundaryLoops(m)).toEqual([]);
  });
  it('an annulus has two loops, one of each ring', () => {
    // Outer square 0..3, inner square 4..7, joined by 8 triangles.
    const pos: number[] = [];
    for (const r of [2, 1]) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pos.push(x * r, y * r, 0);
    const tris: number[] = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tris.push(i, j, 4 + j, i, 4 + j, 4 + i);
    }
    const loops = boundaryLoops({ positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) });
    expect(loops).toHaveLength(2);
    expect(loops.map((l) => l.length)).toEqual([4, 4]);
    const sets = loops.map((l) => [...l].sort().join());
    expect(sets.sort()).toEqual(['0,1,2,3', '4,5,6,7']);
  });
  it('two disjoint triangles give two loops', () => {
    const m: Mesh = {
      positions: new Float64Array(18),
      triangles: Uint32Array.from([0, 1, 2, 3, 4, 5]),
    };
    expect(boundaryLoops(m).map((l) => l.length)).toEqual([3, 3]);
  });
});

describe('meshEdges and vertexNeighbours', () => {
  it('lists each edge once, with the vertex opposite it in every triangle that has it', () => {
    const e = meshEdges(square()); // two triangles sharing the 0-2 diagonal
    expect(e.a).toHaveLength(5);
    const diagonal = e.a.findIndex((a, i) => [a, e.b[i]].sort().join() === '0,2');
    expect([...e.opposite[diagonal]].sort()).toEqual([1, 3]);
    const border = e.a.findIndex((a, i) => [a, e.b[i]].sort().join() === '0,1');
    expect(e.opposite[border]).toEqual([2]);
    expect(e.opposite.filter((o) => o.length === 2)).toHaveLength(1);
  });
  it('lists the neighbours of each vertex without repeats', () => {
    const nb = vertexNeighbours(square()).map((l) => [...l].sort());
    expect(nb).toEqual([[1, 2, 3], [0, 2], [0, 1, 3], [0, 2]]);
  });
  it('is empty for an empty mesh', () => {
    const e = meshEdges({ positions: new Float64Array(0), triangles: new Uint32Array(0) });
    expect(e.a).toEqual([]);
    expect(vertexNeighbours({ positions: new Float64Array(0), triangles: new Uint32Array(0) })).toEqual([]);
  });
});
