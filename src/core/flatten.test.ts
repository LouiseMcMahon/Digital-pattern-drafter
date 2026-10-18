import { describe, expect, it } from 'vitest';
import { uniformEase } from './ease';
import { flatten } from './flatten';
import type { Mesh } from './mesh';

/** Half cylinder (radius 14.3 -> half circumference ~45 cm), a developable surface. */
function halfCylinder(rows = 10, cols = 13, radius = 14.3, height = 60): Mesh {
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

  it('keeps an isolated vertex (used by no triangle) out of the solve without failing', () => {
    const m = wall(3, 3);
    const positions = new Float64Array(m.positions.length + 3);
    positions.set(m.positions);
    positions.set([1, 1, 5], m.positions.length);
    expect(() => flatten({ positions, triangles: m.triangles }, { ease: uniformEase(0, 0) })).not.toThrow();
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
  const n = 8;

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
