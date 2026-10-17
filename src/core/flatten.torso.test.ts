import { describe, expect, it } from 'vitest';
import { buildTorso, defaultMeasurements } from './body';
import { uniformEase } from './ease';
import { flatten } from './flatten';
import { extractSubmesh } from './mesh';

// Integration check on the legacy torso panels. Slow, so the mutation harness leaves it out (see scripts/mutate.mjs).
describe('flatten on torso panels', () => {
  it('torso panels (hem to shoulder, front and back) flatten without flips, with mixed ease', () => {
    const torso = buildTorso(defaultMeasurements);
    const belowShoulder = (t: number) => Math.floor(torso.mesh.triangles[3 * t] / torso.cols) < torso.rowOf.shoulder;
    for (const tris of [torso.frontTriangles, torso.backTriangles]) {
      const panel = extractSubmesh(torso.mesh, tris.filter(belowShoulder));
      const { r } = { r: flatten(panel.mesh, { ease: uniformEase(-8, -3) }) };
      expect(r.flippedTriangles).toBe(0);
      expect(r.rmsEdgeError).toBeLessThan(0.08);
    }
  });
});
