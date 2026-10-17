import { describe, expect, it } from 'vitest';
import { buildTorso, defaultMeasurements } from './body';
import { uniformEase } from './ease';
import { flatten } from './flatten';
import { extractSubmesh, type Mesh } from './mesh';

/** Half cylinder (radius 14.3 -> half circumference ~45 cm), a developable surface. */
function halfCylinder(rows = 30, cols = 33, radius = 14.3, height = 60): Mesh {
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

  it('torso panels (hem to shoulder, front and back) flatten without flips, with mixed ease', () => {
    const torso = buildTorso(defaultMeasurements);
    const belowShoulder = (t: number) => Math.floor(torso.mesh.triangles[3 * t] / torso.cols) < torso.rowOf.shoulder;
    for (const tris of [torso.frontTriangles, torso.backTriangles]) {
      const panel = extractSubmesh(torso.mesh, tris.filter(belowShoulder));
      const { r } = run(panel.mesh, -8, -3);
      expect(r.flippedTriangles).toBe(0);
      expect(r.rmsEdgeError).toBeLessThan(0.08);
    }
  });
});
