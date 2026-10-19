import { describe, expect, it } from 'vitest';
import { uniformEase } from './ease';
import { FLATTEN_TOLERANCE, alignToUp, countFlips, flatten } from './flatten';
import { type Mesh, meshEdges } from './mesh';

/** Half cylinder (radius 14.3 -> half circumference ~45 cm), a developable surface. */
function halfCylinder(rows = 7, cols = 9, radius = 14.3, height = 60): Mesh {
  const positions = new Float64Array(rows * cols * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = (Math.PI * c) / (cols - 1);
      positions.set([radius * Math.cos(t), (height * r) / (rows - 1), radius * Math.sin(t)], 3 * (r * cols + c));
    }
  }
  const tris: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      tris.push(i, i + cols, i + 1, i + 1, i + cols, i + cols + 1);
    }
  }
  return { positions, triangles: new Uint32Array(tris) };
}

function bounds(uv: Float64Array) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < uv.length; i += 2) {
    x0 = Math.min(x0, uv[i]); x1 = Math.max(x1, uv[i]);
    y0 = Math.min(y0, uv[i + 1]); y1 = Math.max(y1, uv[i + 1]);
  }
  return { w: x1 - x0, h: y1 - y0 };
}

function run(mesh: Mesh, horizontal: number, vertical: number) {
  const r = flatten(mesh, { ease: uniformEase(horizontal, vertical) });
  return { r, ...bounds(r.uv) };
}

describe('flatten', () => {
  const cyl = halfCylinder();

  it('zero ease on a developable surface keeps lengths', () => {
    const { r, w, h } = run(cyl, 0, 0);
    expect(r.flippedTriangles).toBe(0);
    expect(r.rmsEdgeError).toBeLessThan(0.02);
    expect(w).toBeCloseTo(Math.PI * 14.3, 0);
    expect(h).toBeCloseTo(60, 0);
  });

  it('horizontal ease % scales the panel width', () => {
    const base = run(cyl, 0, 0).w;
    expect(run(cyl, 10, 0).w / base).toBeCloseTo(1.1, 2);
    expect(run(cyl, -10, 0).w / base).toBeCloseTo(0.9, 2);
  });

  it('vertical ease % scales the panel height', () => {
    const base = run(cyl, 0, 0).h;
    expect(run(cyl, 0, -10).h / base).toBeCloseTo(0.9, 2);
    expect(run(cyl, 0, 10).h / base).toBeCloseTo(1.1, 2);
  });
});

/** Flat w x h grid of 1 cm squares standing up in the xy plane (x across, y up, normal +z). */
function wall(w: number, h: number): Mesh {
  const pos: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pos.push(i, j, 0);
  const tris: number[] = [];
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const a = j * w + i;
    tris.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
  }
  return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) };
}

describe('flatten on a flat wall', () => {
  const rowWidth = (uv: Float64Array, row: number, w: number) => Math.abs(uv[2 * (row * w + w - 1)] - uv[2 * row * w]);

  it('with no ease reproduces the wall (width, height, no error)', () => {
    const r = flatten(wall(6, 5), { ease: uniformEase(0, 0) });
    expect(r.flippedTriangles).toBe(0);
    expect(r.rmsEdgeError).toBeLessThan(1e-6);
    expect(rowWidth(r.uv, 0, 6)).toBeCloseTo(5, 4);
  });

  it('reads the ease at each edge\'s own height: bottom row unchanged, top row 20% wider, between them in order', () => {
    const w = 6;
    const ease = { knots: [{ y: 0, horizontal: 0, vertical: 0 }, { y: 4, horizontal: 20, vertical: 0 }] };
    const r = flatten(wall(w, 5), { ease });
    const widths = [0, 1, 2, 3, 4].map((row) => rowWidth(r.uv, row, w));
    expect(widths[0]).toBeCloseTo(5, 1);
    expect(widths[4]).toBeCloseTo(6, 1);
    for (let i = 0; i < 4; i++) expect(widths[i + 1]).toBeGreaterThan(widths[i]);
    // Smoothstep at the middle row (t = .5) is exactly half way.
    expect(widths[2]).toBeCloseTo(5.5, 1);
  });

  it('honours the `up` axis: with up = +x, ease "vertical" acts along x', () => {
    const r = flatten(wall(6, 5), { ease: uniformEase(0, 20), up: [1, 0, 0] });
    const x = (i: number) => r.uv[2 * i];
    const y = (i: number) => r.uv[2 * i + 1];
    const spanX = Math.hypot(x(5) - x(0), y(5) - y(0));
    const spanY = Math.hypot(x(24) - x(0), y(24) - y(0));
    expect(spanX).toBeCloseTo(6, 1); // along x: stretched 20%
    expect(spanY).toBeCloseTo(4, 1); // along y: untouched
  });

  it('lays a panel out as seen from outside: x grows to the right for a +z face, and the other way for a -z face', () => {
    const front = wall(6, 5);
    const a = flatten(front, { ease: uniformEase(0, 0) });
    expect(a.uv[2 * 5] - a.uv[0]).toBeGreaterThan(4.9); // along +x on the body is along +x on the flat
    const back: Mesh = { positions: front.positions, triangles: Uint32Array.from(front.triangles, (_, i) => front.triangles[i - (i % 3) + [0, 2, 1][i % 3]]) }; // reversed winding: the face looks toward -z
    const b = flatten(back, { ease: uniformEase(0, 0) });
    expect(b.flippedTriangles).toBe(0);
    expect(b.uv[2 * 5] - b.uv[0]).toBeLessThan(-4.9); // seen from -z, +x on the body is to the left
    expect(a.uv[2 * 29 + 1] - a.uv[1]).toBeGreaterThan(3.9); // up on the body is up on the flat, either way
    expect(b.uv[2 * 29 + 1] - b.uv[1]).toBeGreaterThan(3.9);
    // The starting layout alone (no refinement) already has the right way round and up, so the solve starts unfolded.
    const [a0, b0] = [front, back].map((m) => flatten(m, { ease: uniformEase(0, 0), iterations: 0 }));
    expect(a0.uv[2 * 5] - a0.uv[0]).toBeGreaterThan(4.9);
    expect(b0.uv[2 * 5] - b0.uv[0]).toBeLessThan(-4.9);
    expect(a0.uv[2 * 29 + 1] - a0.uv[1]).toBeGreaterThan(3.9);
    expect(b0.uv[2 * 29 + 1] - b0.uv[1]).toBeGreaterThan(3.9);
    expect(a0.flippedTriangles + b0.flippedTriangles).toBe(0);
  });
  it('keeps an isolated vertex (used by no triangle) out of the solve without failing', () => {
    const m = wall(3, 3);
    const positions = new Float64Array(m.positions.length + 3);
    positions.set(m.positions);
    positions.set([1, 1, 5], m.positions.length);
    expect(() => flatten({ positions, triangles: m.triangles }, { ease: uniformEase(0, 0) })).not.toThrow();
  });

  it('does not crash on an empty mesh or one with no triangles', () => {
    const empty = flatten({ positions: new Float64Array(0), triangles: new Uint32Array(0) }, { ease: uniformEase(0, 0) });
    expect(empty.uv.length).toBe(0);
    const points = flatten({ positions: Float64Array.from([0, 0, 0, 1, 0, 0]), triangles: new Uint32Array(0) }, { ease: uniformEase(0, 0) });
    expect(Array.from(points.uv)).toEqual([0, 0, 0, 0]);
  });

  it('returns finite positions for a triangle with a zero-length edge', () => {
    const m: Mesh = { positions: Float64Array.from([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]), triangles: Uint32Array.from([0, 1, 2, 0, 2, 3, 1, 2, 3]) };
    const r = flatten(m, { ease: uniformEase(0, 0) });
    expect(Array.from(r.uv).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(r.worstStrain)).toBe(true);
  });

  it('zero iterations returns the initial layout, already scaled to the body and mean ease', () => {
    const r = flatten(wall(6, 5), { ease: uniformEase(10, 0), iterations: 0 });
    expect(rowWidth(r.uv, 0, 6)).toBeCloseTo(5.5, 3);
  });
});

describe('flatten of a doubly curved patch (a square cut from a sphere)', () => {
  /** (2n + 1)^2 vertices on a sphere of radius R, x and y in [-half, half], cut into triangles one way or the other. */
  function cap(n: number, half: number, R: number, diagonal: 'same' | 'mirrored' | 'other'): Mesh {
    const positions: number[] = [];
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const x = (i * half) / n;
      const y = (j * half) / n;
      positions.push(x, y, Math.sqrt(R * R - x * x - y * y));
    }
    const id = (i: number, j: number) => (j + n) * (2 * n + 1) + (i + n);
    const tris: number[] = [];
    for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) {
      const flip = diagonal === 'same' ? false : diagonal === 'other' ? true : i >= 0;
      if (!flip) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
      else tris.push(id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
    }
    return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
  }
  /** The boundary of a grid patch, as flat points, in order. */
  const outline = (m: Mesh, uv: Float64Array, n: number) => {
    const id = (i: number, j: number) => (j + n) * (2 * n + 1) + (i + n);
    const ring: number[] = [];
    for (let i = -n; i < n; i++) ring.push(id(i, -n));
    for (let j = -n; j < n; j++) ring.push(id(n, j));
    for (let i = n; i > -n; i--) ring.push(id(i, n));
    for (let j = n; j > -n; j--) ring.push(id(-n, j));
    return ring.map((v) => [uv[2 * v], uv[2 * v + 1]] as [number, number]);
  };
  const distToPolygon = (p: [number, number], poly: [number, number][]) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
    }
    return best;
  };
  const n = 5;

  it('keeps edge lengths to within a few percent, flip-free', () => {
    const m = cap(n, 12, 30, 'same');
    const r = flatten(m, { ease: uniformEase(0, 0) });
    expect(r.flippedTriangles).toBe(0);
    expect(r.rmsEdgeError).toBeLessThan(0.03);
  });
  it('gives (nearly) the same panel however the mesh is cut into triangles', () => {
    const a = flatten(cap(n, 12, 30, 'same'), { ease: uniformEase(0, 0) });
    const b = flatten(cap(n, 12, 30, 'other'), { ease: uniformEase(0, 0) });
    const [oa, ob] = [outline(cap(n, 12, 30, 'same'), a.uv, n), outline(cap(n, 12, 30, 'other'), b.uv, n)];
    // The two layouts differ by a rigid motion: compare after moving the centres together and aligning the first edge.
    const centre = (o: [number, number][]) => [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length];
    const [ca, cb] = [centre(oa), centre(ob)];
    const angle = (o: [number, number][], c: number[]) => Math.atan2(o[0][1] - c[1], o[0][0] - c[0]);
    const turn = angle(oa, ca) - angle(ob, cb);
    const placed = ob.map(([x, y]) => {
      const [dx, dy] = [x - cb[0], y - cb[1]];
      return [ca[0] + Math.cos(turn) * dx - Math.sin(turn) * dy, ca[1] + Math.sin(turn) * dx + Math.cos(turn) * dy] as [number, number];
    });
    const worst = Math.max(...placed.map((p) => distToPolygon(p, oa)));
    expect(worst).toBeLessThan(0.02 * 24); // 2% of the patch width
  });
  it('a mirror-symmetric patch flattens to a mirror-symmetric outline, even on a lopsided mesh', () => {
    const m = cap(n, 12, 30, 'same');
    const r = flatten(m, { ease: uniformEase(0, 0) });
    const o = outline(m, r.uv, n);
    const xs = o.map((p) => p[0]);
    const ys = o.map((p) => p[1]);
    // The axis of symmetry is the line through the middle of the top and bottom edges: use the outline's own centre line after aligning "up" with y.
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const mirrored = o.map(([x, y]) => [2 * cx - x, y] as [number, number]);
    const worst = Math.max(...o.map((p) => distToPolygon(p, mirrored)));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
    expect(worst).toBeLessThan(0.02 * 24);
  });
  it('holds the border to its true length (the curvature goes into the inside), so a neighbouring panel can match it', () => {
    const m = cap(n, 12, 30, 'same');
    const ring = outline(m, flatten(m, { ease: uniformEase(0, 0) }).uv, n);
    const perimeter = (o: [number, number][]) => o.reduce((s, p, i) => s + Math.hypot(p[0] - o[(i + 1) % o.length][0], p[1] - o[(i + 1) % o.length][1]), 0);
    const body = (() => {
      const id = (i: number, j: number) => (j + n) * (2 * n + 1) + (i + n);
      const ids: number[] = [];
      for (let i = -n; i < n; i++) ids.push(id(i, -n));
      for (let j = -n; j < n; j++) ids.push(id(n, j));
      for (let i = n; i > -n; i--) ids.push(id(i, n));
      for (let j = n; j > -n; j--) ids.push(id(-n, j));
      return ids.reduce((s, v, k) => { const w = ids[(k + 1) % ids.length]; return s + Math.hypot(...[0, 1, 2].map((q) => m.positions[3 * v + q] - m.positions[3 * w + q])); }, 0);
    })();
    expect(Math.abs(perimeter(ring) - body) / body).toBeLessThan(0.003);
    // With the border free, the sphere's curvature changes it by a couple of percent instead (here it comes out longer).
    const free = outline(m, flatten(m, { ease: uniformEase(0, 0), borderWeight: 0 }).uv, n);
    expect(Math.abs(body - perimeter(free)) / body).toBeGreaterThan(0.01);
  });
  it('border edges follow the ease like the rest: 10% horizontal ease lengthens a horizontal border by 10%', () => {
    const w = wall(6, 5);
    const r = flatten(w, { ease: uniformEase(10, 0) });
    expect(Math.abs(r.uv[2 * 5] - r.uv[0])).toBeCloseTo(5.5, 3);
  });
  it('stays accurate with a very short edge in the mesh (the error is length-weighted)', () => {
    const m = wall(6, 5);
    m.positions[3 * 8] += 0.97; // vertex 8 (2, 1) almost on top of vertex 9 (3, 1): one edge of 0.03 cm
    const r = flatten(m, { ease: uniformEase(0, 0) });
    expect(r.rmsEdgeError).toBeLessThan(0.02);
    expect(r.flippedTriangles).toBe(0);
  });
});

describe('countFlips', () => {
  // Two unit triangles forming a square, counter-clockwise: (0,0) (1,0) (1,1) and (0,0) (1,1) (0,1).
  const square: Mesh = { positions: new Float64Array(12), triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
  const layout = (pts: number[]) => Float64Array.from(pts);
  it('is 0 for a layout that keeps the winding', () => {
    expect(countFlips(square, layout([0, 0, 1, 0, 1, 1, 0, 1]))).toBe(0);
  });
  it('counts each triangle laid out the wrong way round', () => {
    expect(countFlips(square, layout([0, 0, 0, 1, 1, 1, 1, 0]))).toBe(2); // mirrored
    expect(countFlips(square, layout([0, 0, 1, 0, 1, 1, 2, 0.5]))).toBe(1); // vertex 3 pushed through: only the second triangle folds
  });
  it('ignores a fold that is under 5% of an average triangle, and counts one that is over', () => {
    // Vertex 2 moved so the first triangle is a sliver folded by 0.01 (the average triangle is 0.25 of a unit square).
    expect(countFlips(square, layout([0, 0, 1, 0, 0.5, -0.01, 0, 1]))).toBe(0);
    expect(countFlips(square, layout([0, 0, 1, 0, 0.5, -0.2, 0, 1]))).toBe(1);
  });
  it('is 0 for an empty mesh', () => {
    expect(countFlips({ positions: new Float64Array(0), triangles: new Uint32Array(0) }, new Float64Array(0))).toBe(0);
  });
});

describe('worstStrain (R7: a piece must lie flat)', () => {
  it('is 0.5%', () => expect(FLATTEN_TOLERANCE).toBe(0.005));
  it('is far under the tolerance for a flat wall and a half cylinder (developable: they lie flat)', () => {
    expect(flatten(wall(6, 5), { ease: uniformEase(0, 0) }).worstStrain).toBeLessThan(0.001);
    expect(flatten(halfCylinder(), { ease: uniformEase(0, 0) }).worstStrain).toBeLessThan(0.002);
  });
  const sphere = (() => {
    const n = 5;
    const positions: number[] = [];
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const x = (i * 12) / n, y = (j * 12) / n; positions.push(x, y, Math.sqrt(900 - x * x - y * y)); }
    const id = (i: number, j: number) => (j + n) * (2 * n + 1) + (i + n);
    const tris: number[] = [];
    for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
    return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) } as Mesh;
  })();
  it('is over the tolerance for a patch of a sphere: it cannot lie flat', () => {
    const r = flatten(sphere, { ease: uniformEase(0, 0) });
    expect(r.worstStrain).toBeGreaterThan(FLATTEN_TOLERANCE);
    expect(r.worstStrain).toBeLessThan(0.1);
  });
  it('measures against the eased length: asking for 10% ease on a flat wall is not stretch', () => {
    expect(flatten(wall(6, 5), { ease: uniformEase(10, -5) }).worstStrain).toBeLessThan(0.001);
  });
  it('vertexStrain has one value per vertex, about 0 on a flat wall and both signs on a curved patch', () => {
    const flat = flatten(wall(4, 3), { ease: uniformEase(0, 0) });
    expect(flat.vertexStrain).toHaveLength(12);
    for (const v of flat.vertexStrain) expect(Math.abs(v)).toBeLessThan(0.001);
    const curved = flatten(sphere, { ease: uniformEase(0, 0) });
    expect(Math.max(...curved.vertexStrain)).toBeGreaterThan(0.002);
    expect(Math.min(...curved.vertexStrain)).toBeLessThan(-0.002);
  });
});

describe('alignToUp (the starting layout is turned so +y follows the 3D up axis)', () => {
  const meshOf = (heights: number[]): Mesh => ({ positions: Float64Array.from(heights.flatMap((h) => [0, h, 0])), triangles: new Uint32Array(0) });

  it('turns a layout whose height grows along +u so that it grows along +v, about the centroid', () => {
    const uv = Float64Array.from([0, 0, 1, 0, 2, 0]);
    alignToUp(meshOf([0, 1, 2]), uv, [0, 1, 0]);
    expect(Array.from(uv).map((x) => Math.round(1e9 * x) / 1e9 + 0)).toEqual([0, -1, 0, 0, 0, 1]);
  });

  it('turns a layout whose height grows along -u the other way, and one that already points up stays', () => {
    const down = Float64Array.from([0, 0, 1, 0, 2, 0]);
    alignToUp(meshOf([2, 1, 0]), down, [0, 1, 0]);
    expect(Array.from(down).map((x) => Math.round(1e9 * x) / 1e9 + 0)).toEqual([0, 1, 0, 0, 0, -1]);
    const up = Float64Array.from([0, 0, 0, 1, 0, 2]);
    alignToUp(meshOf([0, 1, 2]), up, [0, 1, 0]);
    expect(Array.from(up).map((x) => Math.round(1e9 * x) / 1e9 + 0)).toEqual([0, -1, 0, 0, 0, 1]);
  });

  it('on a scattered layout: centres it, keeps every distance, and leaves height uncorrelated with u and rising with v', () => {
    const pts = [[0.3, 1.2], [2.1, -0.4], [1.1, 2.6], [-1.5, 0.7], [0.9, -1.8], [2.8, 1.9]];
    const heights = [3, 1, 4, 1.5, 9, 2.6];
    const uv = Float64Array.from(pts.flat());
    const before = Float64Array.from(uv);
    alignToUp(meshOf(heights), uv, [0, 1, 0]);
    const n = pts.length;
    const mean = (k: number) => Array.from({ length: n }, (_, i) => uv[2 * i + k]).reduce((a, b) => a + b, 0) / n;
    expect(mean(0)).toBeCloseTo(0, 9);
    expect(mean(1)).toBeCloseTo(0, 9);
    const mh = heights.reduce((a, b) => a + b, 0) / n;
    const cov = (k: number) => heights.reduce((s, h, i) => s + (h - mh) * uv[2 * i + k], 0);
    expect(cov(0)).toBeCloseTo(0, 9);
    expect(cov(1)).toBeGreaterThan(1);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      expect(Math.hypot(uv[2 * i] - uv[2 * j], uv[2 * i + 1] - uv[2 * j + 1])).toBeCloseTo(Math.hypot(before[2 * i] - before[2 * j], before[2 * i + 1] - before[2 * j + 1]), 9);
    }
  });
});

describe('countFlips tolerance (a fold under 5% of an average triangle does not count)', () => {
  const square: Mesh = { positions: new Float64Array(12), triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
  it('counts the second triangle exactly when its fold is over 5% of the average triangle area', () => {
    for (let k = 1; k <= 60; k++) {
      const push = 0.005 * k; // vertex 3 pushed to (push, 1 - 2 * ... ) through the diagonal: the second triangle folds by about this much
      const layout = Float64Array.from([0, 0, 1, 0, 1, 1, push, -push * 8]);
      const area = (a: number, b: number, c: number) => (layout[2 * b] - layout[2 * a]) * (layout[2 * c + 1] - layout[2 * a + 1]) - (layout[2 * c] - layout[2 * a]) * (layout[2 * b + 1] - layout[2 * a + 1]);
      const areas = [area(0, 1, 2), area(0, 2, 3)];
      const tolerance = (0.05 * (Math.abs(areas[0]) + Math.abs(areas[1]))) / 2;
      expect(countFlips(square, layout)).toBe(areas.filter((a) => a < -tolerance).length);
    }
  });
  it('is 0 on a layout that merely has a very small triangle among large ones', () => {
    const strip: Mesh = { positions: new Float64Array(15), triangles: Uint32Array.from([0, 1, 2, 0, 2, 3, 3, 2, 4]) };
    expect(countFlips(strip, Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10, 10, 10.0001]))).toBe(0);
  });
});

describe('flatten starting layout and frame', () => {
  const edgesOf = (m: Mesh) => {
    const out: [number, number][] = [];
    for (let t = 0; t < m.triangles.length; t += 3) for (let q = 0; q < 3; q++) out.push([m.triangles[t + q], m.triangles[t + ((q + 1) % 3)]]);
    return out;
  };
  it('with no iterations, a flat wall starts at exactly the eased edge lengths: horizontal x (1 + h), vertical x (1 + v), diagonal by Pythagoras', () => {
    const m = wall(5, 4);
    const r = flatten(m, { ease: uniformEase(20, 10), iterations: 0 });
    for (const [a, b] of edgesOf(m)) {
      const [dx, dy] = [m.positions[3 * b] - m.positions[3 * a], m.positions[3 * b + 1] - m.positions[3 * a + 1]];
      const want = Math.hypot(1.2 * dx, 1.1 * dy);
      expect(Math.hypot(r.uv[2 * a] - r.uv[2 * b], r.uv[2 * a + 1] - r.uv[2 * b + 1])).toBeCloseTo(want, 6);
    }
  });
  it('takes the horizontal direction from the surface even when it faces straight up (normal parallel to up): then horizontal is x', () => {
    // A 5 x 4 floor in the xz plane, normal +y, which is also `up`.
    const pos: number[] = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) pos.push(i, 0, -j);
    const tris: number[] = [];
    for (let j = 0; j + 1 < 4; j++) for (let i = 0; i + 1 < 5; i++) { const a = j * 5 + i; tris.push(a, a + 1, a + 6, a, a + 6, a + 5); }
    const floor: Mesh = { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) };
    const areaOf = (uv: Float64Array) => { let total = 0; for (let t = 0; t < floor.triangles.length; t += 3) { const [i, j, k] = [floor.triangles[t], floor.triangles[t + 1], floor.triangles[t + 2]]; total += Math.abs((uv[2 * j] - uv[2 * i]) * (uv[2 * k + 1] - uv[2 * i + 1]) - (uv[2 * k] - uv[2 * i]) * (uv[2 * j + 1] - uv[2 * i + 1])) / 2; } return total; };
    const plain = areaOf(flatten(floor, { ease: uniformEase(0, 0) }).uv);
    expect(plain).toBeCloseTo(12, 6); // 4 x 3
    // The horizontal ease acts along x (the fallback direction), so the area grows by about 20%; with no usable horizontal it would not grow at all.
    // (The starting layout's axes are not tied to x here, so the result is only approximately 1.2.)
    const ratio = areaOf(flatten(floor, { ease: uniformEase(20, 0) }).uv) / plain;
    expect(ratio).toBeGreaterThan(1.12);
    expect(ratio).toBeLessThan(1.25);
  });
});

describe('flatten figures are what they say, worked out independently on a curved patch', () => {
  /** A square patch of a sphere with one vertex pulled almost onto its neighbour, so a few edges are very short. */
  function patch(): Mesh {
    const n = 4;
    const [half, R] = [10, 25];
    const positions: number[] = [];
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const x = (i * half) / n;
      const y = (j * half) / n;
      positions.push(x, y, Math.sqrt(R * R - x * x - y * y));
    }
    const id = (i: number, j: number) => (j + n) * (2 * n + 1) + (i + n);
    const tris: number[] = [];
    for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
    const [a, b] = [3 * id(0, 0), 3 * id(1, 0)];
    for (let k = 0; k < 3; k++) positions[a + k] += 0.97 * (positions[b + k] - positions[a + k]); // vertex (0,0) almost on vertex (1,0)
    return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
  }
  const m = patch();
  const r = flatten(m, { ease: uniformEase(0, 0) });
  const edges = meshEdges(m);
  const target = edges.a.map((a, k) => Math.hypot(m.positions[3 * edges.b[k]] - m.positions[3 * a], m.positions[3 * edges.b[k] + 1] - m.positions[3 * a + 1], m.positions[3 * edges.b[k] + 2] - m.positions[3 * a + 2]));
  const flatLen = edges.a.map((a, k) => Math.hypot(r.uv[2 * edges.b[k]] - r.uv[2 * a], r.uv[2 * edges.b[k] + 1] - r.uv[2 * a + 1]));
  const strain = flatLen.map((d, k) => d / target[k] - 1);

  it('rmsEdgeError is the length-weighted root mean square of the flat edge lengths against the targets', () => {
    const se = flatLen.reduce((s, d, k) => s + (d - target[k]) ** 2, 0);
    const tt = target.reduce((s, t) => s + t * t, 0);
    expect(r.rmsEdgeError).toBeCloseTo(Math.sqrt(se / tt), 12);
    expect(r.rmsEdgeError).toBeGreaterThan(1e-4); // a sphere does not flatten exactly
  });

  it('vertexStrain is the mean of the strains of the edges at each vertex', () => {
    const sum = new Float64Array(m.positions.length / 3);
    const count = new Float64Array(m.positions.length / 3);
    edges.a.forEach((a, k) => { sum[a] += strain[k]; sum[edges.b[k]] += strain[k]; count[a]++; count[edges.b[k]]++; });
    for (let v = 0; v < sum.length; v++) expect(r.vertexStrain[v]).toBeCloseTo(sum[v] / count[v], 12);
  });

  it('worstStrain is the 98th percentile of |strain| over the edges that are at least a quarter as long as the median edge', () => {
    const sorted = [...target].sort((p, q) => p - q);
    const typical = sorted[Math.floor(sorted.length / 2)];
    expect(target.some((t) => t < 0.25 * typical)).toBe(true); // the pulled-in vertex gives some short edges
    const counted = strain.filter((_, k) => target[k] >= 0.25 * typical).map(Math.abs).sort((p, q) => p - q);
    expect(r.worstStrain).toBeCloseTo(counted[Math.floor(0.98 * counted.length)], 12);
    const all = strain.map(Math.abs).sort((p, q) => p - q);
    expect(Math.abs(r.worstStrain - all[all.length - 1])).toBeGreaterThan(1e-6); // not the worst of every edge
  });

  it('keeps the layout centred where the starting layout was, however the solve moves things', () => {
    const start = flatten(m, { ease: uniformEase(0, 0), iterations: 0 });
    const centre = (uv: Float64Array) => [0, 1].map((k) => Array.from({ length: uv.length / 2 }, (_, i) => uv[2 * i + k]).reduce((a, b) => a + b, 0) / (uv.length / 2));
    expect(centre(r.uv)[0]).toBeCloseTo(centre(start.uv)[0], 9);
    expect(centre(r.uv)[1]).toBeCloseTo(centre(start.uv)[1], 9);
  });
});
