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
