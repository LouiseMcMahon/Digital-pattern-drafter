import { describe, expect, it } from 'vitest';
import { arcBetweenPoints, arcPoints, arcPositionOf, loopLength, slicePlane } from './slice';

/** Icosphere-free cylinder test: closed tube of radius r. */
function tube(r: number, rows: number, cols: number, height: number) {
  const positions = new Float64Array(rows * cols * 3);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const t = (2 * Math.PI * j) / cols;
    positions.set([r * Math.cos(t), (height * i) / (rows - 1), r * Math.sin(t)], 3 * (i * cols + j));
  }
  const tris: number[] = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
    const a = i * cols + j, b = i * cols + ((j + 1) % cols);
    tris.push(a, a + cols, b, b, a + cols, b + cols);
  }
  return { positions, triangles: new Uint32Array(tris) };
}

describe('slicePlane', () => {
  it('slices a tube into one closed loop with the polygon perimeter', () => {
    const { positions, triangles } = tube(10, 11, 360, 100);
    const loops = slicePlane(positions, triangles, { point: [0, 47, 0], normal: [0, 1, 0] });
    expect(loops).toHaveLength(1);
    expect(loops[0].closed).toBe(true);
    expect(loopLength(loops[0])).toBeCloseTo(2 * Math.PI * 10, 1);
  });

  it('a vertical plane through the tube gives two open chains... or one closed loop around the section', () => {
    const { positions, triangles } = tube(10, 11, 360, 100);
    const loops = slicePlane(positions, triangles, { point: [0, 0, 0], normal: [1, 0, 0] });
    expect(loops.length).toBeGreaterThan(0);
    // Two sides of the tube, each 100 long (open tube, so open chains).
    const total = loops.reduce((s, l) => s + loopLength(l), 0);
    expect(total).toBeCloseTo(200, 0);
  });
});

describe('arc helpers on a tube of known radius', () => {
  const R = 10;
  const { positions, triangles } = tube(R, 11, 720, 100);
  const loop = slicePlane(positions, triangles, { point: [0, 50, 0], normal: [0, 1, 0] })[0];
  const at = (deg: number): [number, number, number] => [R * Math.cos((deg * Math.PI) / 180), 50, R * Math.sin((deg * Math.PI) / 180)];

  it('arc length between two points is radius times the angle between them', () => {
    expect(arcBetweenPoints(loop, at(0), at(90))).toBeCloseTo((R * Math.PI) / 2, 2);
    expect(arcBetweenPoints(loop, at(10), at(100))).toBeCloseTo((R * Math.PI) / 2, 2);
  });

  it('takes the shorter way round a closed loop', () => {
    expect(arcBetweenPoints(loop, at(0), at(270))).toBeCloseTo((R * Math.PI) / 2, 2);
    expect(arcBetweenPoints(loop, at(0), at(180))).toBeCloseTo(R * Math.PI, 2);
  });

  it('is symmetric and zero for the same point', () => {
    expect(arcBetweenPoints(loop, at(33), at(120))).toBeCloseTo(arcBetweenPoints(loop, at(120), at(33)), 9);
    expect(arcBetweenPoints(loop, at(33), at(33))).toBeCloseTo(0, 6);
  });

  it('varies smoothly: moving a point by 0.1 mm moves the arc by about 0.1 mm', () => {
    const p = at(40);
    const q: [number, number, number] = [p[0] + 0.01 * Math.sin((40 * Math.PI) / 180), p[1], p[2] - 0.01 * Math.cos((40 * Math.PI) / 180)];
    expect(Math.abs(arcBetweenPoints(loop, q, at(100)) - arcBetweenPoints(loop, p, at(100)))).toBeLessThan(0.0125);
  });

  it('arcPositionOf is arc length from the loop start', () => {
    const start = [loop.points[0], loop.points[1], loop.points[2]] as [number, number, number];
    expect(arcPositionOf(loop, start)).toBeCloseTo(0, 6);
  });

  it('arcPoints returns a polyline whose length equals the arc', () => {
    const pts = arcPoints(loop, at(0), at(90));
    let len = 0;
    for (let i = 3; i < pts.length; i += 3) len += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]);
    expect(len).toBeCloseTo((R * Math.PI) / 2, 1);
  });
});

describe('slicePlane attribute interpolation', () => {
  it('interpolates a per-vertex scalar linearly onto the slice points', () => {
    const { positions, triangles } = tube(10, 11, 90, 100);
    const attr = Float64Array.from({ length: positions.length / 3 }, (_, i) => positions[3 * i + 1] * 2); // 2 * y
    const [l] = slicePlane(positions, triangles, { point: [0, 33, 0], normal: [0, 1, 0] }, undefined, attr);
    expect(l.attr).toBeDefined();
    for (const v of l.attr!) expect(v).toBeCloseTo(66, 6);
  });

  it('a tilted plane gives the right ellipse perimeter', () => {
    const { positions, triangles } = tube(10, 41, 720, 100);
    const [l] = slicePlane(positions, triangles, { point: [0, 50, 0], normal: [0, Math.SQRT1_2, Math.SQRT1_2] });
    // Plane at 45 degrees through a cylinder: ellipse with semi-axes 10 and 10*sqrt(2). Ramanujan's approximation.
    const [a, b] = [10, 10 * Math.SQRT2];
    const h = ((a - b) / (a + b)) ** 2;
    expect(loopLength(l)).toBeCloseTo(Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))), 1);
  });
});
