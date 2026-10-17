import { describe, expect, it } from 'vitest';
import { loopLength, slicePlane } from './slice';

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
