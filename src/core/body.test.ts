import { describe, expect, it } from 'vitest';
import { buildTorso, defaultMeasurements, measureRing } from './body';
import { boundaryLoops, extractSubmesh, getVertex, len, sub } from './mesh';

const torso = buildTorso(defaultMeasurements);
const m = defaultMeasurements;

describe('torso', () => {
  it('reads back the tape measurements within 0.5%', () => {
    const targets: Record<string, number> = { bust: m.bust, underbust: m.underbust, waist: m.waist, hip: m.hip, chest: m.chest, neckBase: m.neck };
    for (const [ring, target] of Object.entries(targets)) {
      expect(Math.abs(measureRing(torso, ring) / target - 1), ring).toBeLessThan(0.005);
    }
  });

  it('has shoulder points shoulderWidth apart and the bust apexes separation apart', () => {
    const v = (name: string) => getVertex(torso.mesh, torso.landmarks.find((l) => l.name === name)!.vertex);
    expect(len(sub(v('shoulder.left'), v('shoulder.right')))).toBeCloseTo(m.shoulderWidth, 0);
    const sep = len(sub(v('bustApex.left'), v('bustApex.right')));
    expect(Math.abs(sep - m.bustApexSeparation)).toBeLessThan(2);
  });

  it('bust protrudes forward of the ring', () => {
    const z = (name: string) => getVertex(torso.mesh, torso.landmarks.find((l) => l.name === name)!.vertex)[2];
    expect(z('bustApex.left')).toBeGreaterThan(z('bust.frontCentre') + 1);
  });

  it('is a tube: two open boundaries (hem, neck top), front/back panels each one loop', () => {
    expect(boundaryLoops(torso.mesh)).toHaveLength(2);
    const front = extractSubmesh(torso.mesh, torso.frontTriangles);
    const back = extractSubmesh(torso.mesh, torso.backTriangles);
    expect(boundaryLoops(front.mesh)).toHaveLength(1);
    expect(boundaryLoops(back.mesh)).toHaveLength(1);
    expect(torso.frontTriangles.length + torso.backTriangles.length).toBe(torso.mesh.triangles.length / 3);
  });

  it('has no NaNs and heights are strictly increasing', () => {
    expect(torso.mesh.positions.every(Number.isFinite)).toBe(true);
    for (let i = 1; i < torso.ys.length; i++) expect(torso.ys[i]).toBeGreaterThan(torso.ys[i - 1]);
  });
});
