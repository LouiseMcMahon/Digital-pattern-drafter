import { describe, expect, it } from 'vitest';
import { buildHanging, polylineLengthOf, resample } from './hanging';
import type { Mesh } from './mesh';
import { type Seam, SurfaceGraph, raycast } from './seam';
import { computePanels, type PanelFlat } from './panelPipeline';

/** An open tube of radius r around the y axis, from y = 0 to 100, standing for a torso. */
function tube(r: number, sides = 48, rows = 40): Mesh {
  const positions: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i < sides; i++) positions.push(r * Math.cos((2 * Math.PI * i) / sides), (100 * j) / rows, r * Math.sin((2 * Math.PI * i) / sides));
  const tris: number[] = [];
  const id = (i: number, j: number) => j * sides + (i % sides);
  for (let j = 0; j < rows; j++) for (let i = 0; i < sides; i++) tris.push(id(i, j), id(i + 1, j + 1), id(i + 1, j), id(i, j), id(i, j + 1), id(i + 1, j + 1)); // outward-facing
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
}
const body = tube(10);
const graph = new SurfaceGraph(body.triangles, body.positions.length / 3);
const onTube = (angle: number, y: number) => { const h = raycast(body, [30 * Math.cos(angle), y, 30 * Math.sin(angle)], [-Math.cos(angle), 0, -Math.sin(angle)])!; return { tri: h.tri, bary: h.bary }; };
const waist: Seam = { points: [0, 1, 2, 3].map((k) => onTube((k * Math.PI) / 2, 60)), closed: true };
const flatOf = (r: ReturnType<typeof computePanels>['panels'][number]) => { if (r.error) throw new Error(r.error); return r as PanelFlat; };

describe('resample', () => {
  it('spaces points evenly along a polyline, ends included', () => {
    const pts = resample([0, 0, 0, 10, 0, 0, 10, 10, 0], 5);
    expect(pts[0]).toEqual([0, 0, 0]);
    expect(pts[4]).toEqual([10, 10, 0]);
    expect(pts[2]).toEqual([10, 0, 0]);
    expect(polylineLengthOf([0, 0, 0, 3, 4, 0])).toBe(5);
  });
});

describe('buildHanging', () => {
  it('drops straight down from the seam by the length and keeps clear of the body', () => {
    const path = graph.seamPath(body.positions, waist);
    const h = buildHanging(body, path, { length: 30, flare: 0 });
    const { positions } = h.mesh;
    for (let i = 0; i < h.columns; i++) {
      const top = i * h.rows;
      const bottom = top + h.rows - 1;
      expect(positions[3 * top + 1]).toBeCloseTo(60, 1);
      expect(positions[3 * bottom + 1]).toBeCloseTo(30, 0);
    }
    for (let v = 0; v < positions.length / 3; v++) if (v % h.rows !== 0) expect(Math.hypot(positions[3 * v], positions[3 * v + 2])).toBeGreaterThanOrEqual(9.9) // the tube is a 48-sided prism, so its faces are a little inside r = 10;
  });

  it('is pushed out over a part of the body that is wider than the seam', () => {
    const wide = tube(10);
    for (let v = 0; v < wide.positions.length / 3; v++) if (wide.positions[3 * v + 1] < 55) { wide.positions[3 * v] *= 1.5; wide.positions[3 * v + 2] *= 1.5; }
    const path = Array.from({ length: 25 }, (_, k) => [10 * Math.cos((Math.PI * k) / 24 - Math.PI / 2), 60, 10 * Math.sin((Math.PI * k) / 24 - Math.PI / 2)]).flat(); // half way round, front to back
    const h = buildHanging(wide, path, { length: 30, flare: 0 });
    const lowest = h.rows - 1;
    expect(Math.hypot(h.mesh.positions[3 * lowest], h.mesh.positions[3 * lowest + 2])).toBeGreaterThan(14);
    expect(h.flare).toBeGreaterThan(30); // widened from 0 to clear the wide part
  });

  it('clears the trunk but ignores an arm hanging beside it', () => {
    const trunk = tube(10);
    const arm = tube(4);
    for (let v = 0; v < arm.positions.length / 3; v++) arm.positions[3 * v] += 14; // right next to the trunk, in the way of a flared skirt
    const n = trunk.positions.length / 3;
    const both: Mesh = { positions: Float64Array.from([...trunk.positions, ...arm.positions]), triangles: Uint32Array.from([...trunk.triangles, ...Array.from(arm.triangles, (v) => v + n)]) };
    const path = Array.from({ length: 49 }, (_, k) => [10 * Math.cos((2 * Math.PI * k) / 48), 60, 10 * Math.sin((2 * Math.PI * k) / 48)]).flat();
    const h = buildHanging(both, path, { length: 30, flare: 0 });
    expect(h.flare).toBeLessThan(5); // only the standoff from the trunk
    const lowest = h.rows - 1;
    expect(Math.hypot(h.mesh.positions[3 * lowest], h.mesh.positions[3 * lowest + 2])).toBeCloseTo(10.3, 0);
  });

  it('rejects a missing length or a seam with one point', () => {
    expect(() => buildHanging(body, [0, 0, 0, 1, 0, 0], { length: 0, flare: 0 })).toThrow('length');
    expect(() => buildHanging(body, [0, 0, 0], { length: 10, flare: 0 })).toThrow('two points');
  });
});

describe('a hanging panel in computePanels', () => {
  const seed = waist.points[0];
  it('flattens a straight skirt to a rectangle as long as the waist is round', () => {
    const { panels } = computePanels(body, graph, [waist], [{ seed, horizontal: 0, vertical: 0, hang: { seam: 0, length: 30, flare: 0 } }]);
    const p = flatOf(panels[0]);
    expect(p.hanging).toBe(true);
    expect(p.flat.worstStrain).toBeLessThan(0.02);
    expect(p.flat.flippedTriangles).toBe(0);
    expect(p.edges.map((e) => e.seam)).toEqual([0, undefined, undefined, undefined]);
    expect(p.edges[0].length).toBeCloseTo(2 * Math.PI * 10, 0);
    expect(p.edges[2].length).toBeGreaterThanOrEqual(p.edges[0].length - 1); // the hem is at least as long as the waist
    expect(p.size).toBeGreaterThan(0.9 * 30 * 2 * Math.PI * 10);
  });

  it('flare makes the hem longer than the seam', () => {
    const { panels } = computePanels(body, graph, [waist], [{ seed, horizontal: 0, vertical: 0, hang: { seam: 0, length: 30, flare: 50 } }]);
    const p = flatOf(panels[0]);
    expect(p.edges[2].length / p.edges[0].length).toBeGreaterThan(1.3);
  });

  it('reports a panel whose seam is gone instead of throwing', () => {
    const { panels } = computePanels(body, graph, [], [{ seed, horizontal: 0, vertical: 0, hang: { seam: 0, length: 30, flare: 0 } }]);
    expect(panels[0].error).toMatch(/seam this panel hangs from/);
  });
});
