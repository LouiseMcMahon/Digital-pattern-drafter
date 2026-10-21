import { describe, expect, it } from 'vitest';
import { SurfaceField } from './bodyField';
import { type ClothProgress, clothPattern, clothPatterns, clothPatternsSteps, drapeCloth, drapeGarment } from './cloth';
import { buildHanging } from './hanging';
import { boundaryLoops, type Mesh } from './mesh';
import { SurfaceGraph, raycast, type Seam } from './seam';

/** A rectangle [-hx, hx] x [-hy, hy] with nx x ny cells; positions from place(u, v), flat pattern coordinates (u, v). */
function sheet(hx: number, hy: number, nx: number, ny: number, place: (u: number, v: number) => [number, number, number]) {
  const pos: number[] = [];
  const flat: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const u = -hx + (2 * hx * i) / nx; const v = -hy + (2 * hy * j) / ny; pos.push(...place(u, v)); flat.push(u, v); }
  const id = (i: number, j: number) => j * (nx + 1) + i;
  const tris: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { mesh: { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris) } as Mesh, flat, id };
}
const plane = (half: number, h: (x: number, y: number) => number, cells = 10): Mesh => sheet(half, half, cells, cells, (x, y) => [x, y, h(x, y)]).mesh;
const bump = (cx: number, cy: number, height: number, sigma: number) => (x: number, y: number) => height * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));

describe('drapeCloth', () => {
  it('leaves a flat piece lying on a flat body where it is, at the standoff above it', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const s = sheet(6, 6, 6, 6, (u, v) => [u, v, 1]);
    const r = drapeCloth(s.mesh, s.flat, body, { standoff: 0.05, iterations: 100 });
    expect(r.worstStrain).toBeLessThan(1e-6);
    expect(r.maxSeamError).toBeLessThan(0.1);
    for (let v = 0; v < s.flat.length / 2; v++) expect(r.mesh.positions[3 * v + 2]).toBeLessThan(1.001);
  });

  it('wraps a flat strip around a cylinder without stretching it (a developable surface)', () => {
    const R = 5;
    const tube: Mesh = (() => {
      const around = 16;
      const rows = sheet(Math.PI, 10, around, 4, (a, y) => [R * Math.sin(a), y, R * Math.cos(a)]);
      return rows.mesh;
    })();
    const body = new SurfaceField(tube, 2);
    const Rc = R + 0.05;
    const wrapped = (u: number, v: number): [number, number, number] => [Rc * Math.sin(u / Rc), v, Rc * Math.cos(u / Rc)];
    const s = sheet(5, 4, 8, 5, (u, v) => [u, v, R + 2]);
    const targets = Float64Array.from(s.flat.flatMap((_, k) => (k % 2 === 0 ? wrapped(s.flat[k], s.flat[k + 1]) : [])));
    const r = drapeCloth(s.mesh, s.flat, body, { standoff: 0.05, targets, iterations: 500, borderWeight: 0.3 });
    expect(r.worstStrain).toBeLessThan(0.01);
    expect(r.maxSeamError).toBeLessThan(0.3);
    for (let v = 0; v < s.flat.length / 2; v++) expect(body.closest([r.mesh.positions[3 * v], r.mesh.positions[3 * v + 1], r.mesh.positions[3 * v + 2]]).signed).toBeGreaterThan(0.05 - 5e-3);
    expect(Math.max(...r.gap)).toBeLessThan(0.4); // lies on the cylinder, not floating over it
  });

  it('spans the hollow between two bumps, never enters the body, and falls short at the border instead of stretching', () => {
    const [f1, f2] = [bump(-4, 0, 3, 1.8), bump(4, 0, 3, 1.8)];
    const body = new SurfaceField(plane(14, (x, y) => f1(x, y) + f2(x, y), 20), 2);
    const s = sheet(10, 6, 12, 8, (u, v) => [u, v, 3.5]);
    // The border is drawn down to the ground all round, under the bumps' skirts, so the cloth has to come down over them.
    const targets = Float64Array.from(s.mesh.positions, (v, k) => (k % 3 === 2 ? 0.05 : v));
    const r = drapeCloth(s.mesh, s.flat, body, { standoff: 0.05, iterations: 350, targets, borderWeight: 0.02 });
    expect(r.worstStrain).toBeLessThan(0.01);
    expect(r.maxSeamError).toBeGreaterThan(0.1); // it cannot reach the ground at the border without stretching, so it stops short
    for (let v = 0; v < s.flat.length / 2; v++) expect(body.closest([r.mesh.positions[3 * v], r.mesh.positions[3 * v + 1], r.mesh.positions[3 * v + 2]]).signed).toBeGreaterThan(0.05 - 5e-3);
    const mid = s.id(6, 4); // the vertex over (0, 0)
    expect(r.gap[mid]).toBeGreaterThan(0.5); // bridges the valley rather than following it
  });

  it('falls under gravity (down is -y, the body up axis) onto the body when nothing holds it, and stays put without gravity', () => {
    const floor = new SurfaceField(sheet(20, 20, 6, 6, (u, v) => [v, 0, u]).mesh, 2); // y = 0, normals up
    const s = sheet(6, 6, 5, 5, (u, v) => [u, 3, v]);
    const held = drapeCloth(s.mesh, s.flat, floor, { borderWeight: 0, iterations: 30 });
    expect(Math.min(...held.gap)).toBeCloseTo(3, 6);
    const falling = drapeCloth(s.mesh, s.flat, floor, { borderWeight: 0, gravity: 0.1, iterations: 80, standoff: 0.05 });
    expect(Math.max(...falling.gap)).toBeLessThan(0.06);
    for (let v = 0; v < s.flat.length / 2; v++) expect(falling.mesh.positions[3 * v + 1]).toBeGreaterThan(0.05 - 1e-6); // on the floor, not through it
    expect(falling.worstStrain).toBeLessThan(1e-6); // it fell without stretching
  });

  it('does not stretch or enter the body with bending off or high', () => {
    const body = new SurfaceField(plane(20, bump(0, 0, 2, 2), 20), 2);
    for (const bending of [0, 0.5]) {
      const s = sheet(5, 5, 6, 6, (u, v) => [u, v, 2.5]);
      const r = drapeCloth(s.mesh, s.flat, body, { bending, gravity: 0.05, borderWeight: 0.02, iterations: 150 });
      expect(r.worstStrain).toBeLessThan(0.05);
      for (let v = 0; v < s.flat.length / 2; v++) expect(body.closest([r.mesh.positions[3 * v], r.mesh.positions[3 * v + 1], r.mesh.positions[3 * v + 2]]).signed).toBeGreaterThan(0.05 - 5e-3);
    }
  });

  it('reports stretch as positive and squeeze as negative, per edge, with the 98th percentile as the worst', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const s = sheet(3, 3, 3, 3, (u, v) => [u, v, 1]);
    const scaled = (k: number) => s.flat.map((x) => x * k);
    // No iterations: the cloth is where it started, so every edge is 1 / k times its pattern length.
    const stretched = drapeCloth(s.mesh, scaled(0.9), body, { iterations: 0 }); // pattern smaller than the cloth: stretched by 1/0.9 - 1
    for (const v of stretched.vertexStrain) expect(v).toBeCloseTo(1 / 0.9 - 1, 9);
    expect(stretched.worstStrain).toBeCloseTo(1 / 0.9 - 1, 9);
    const squeezed = drapeCloth(s.mesh, scaled(1.25), body, { iterations: 0 });
    for (const v of squeezed.vertexStrain) expect(v).toBeCloseTo(1 / 1.25 - 1, 9);
    expect(squeezed.worstStrain).toBeCloseTo(1 - 1 / 1.25, 9); // the worst is a size, not a sign
  });

  it('pushes a piece that starts inside the body out to the standoff', () => {
    const floor = new SurfaceField(sheet(20, 20, 6, 6, (u, v) => [v, 0, u]).mesh, 2); // y = 0, normals up
    const s = sheet(4, 4, 4, 4, (u, v) => [u, -1, v]); // a centimetre under the floor
    const r = drapeCloth(s.mesh, s.flat, floor, { borderWeight: 0, iterations: 20, standoff: 0.05 });
    for (let v = 0; v < s.flat.length / 2; v++) expect(r.mesh.positions[3 * v + 1]).toBeCloseTo(0.05, 6);
  });

  it('bending holds the corners opposite a shared edge at their pattern distance: a fold stays at 0 and opens at 1', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    // A unit square split along a diagonal, folded 90 degrees about it, high above the body. Every edge length is right in the fold.
    const s = Math.SQRT1_2;
    const folded: Mesh = {
      positions: Float64Array.from([0, 0, 10, 1, 0, 10, 1, 1, 10, 0.5, 0.5, 10 + s]),
      triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    };
    // vertices: 0 = (0,0), 1 = (1,0), 2 = (1,1), 3 = the corner (0,1) folded up about the diagonal 0-2
    const flat = [0, 0, 1, 0, 1, 1, 0, 1];
    const between = (m: Mesh, a: number, b: number) => Math.hypot(m.positions[3 * a] - m.positions[3 * b], m.positions[3 * a + 1] - m.positions[3 * b + 1], m.positions[3 * a + 2] - m.positions[3 * b + 2]);
    const hinged = drapeCloth(folded, flat, body, { bending: 0, borderWeight: 0, iterations: 40 });
    expect(between(hinged.mesh, 1, 3)).toBeCloseTo(1, 6); // still folded: the corners are 1 apart, the flat pattern says sqrt 2
    const stiff = drapeCloth(folded, flat, body, { bending: 1, borderWeight: 0, iterations: 40 });
    expect(between(stiff.mesh, 1, 3)).toBeGreaterThan(1.3);
  });

  it('draws exactly the border to its targets: one full-strength iteration puts border vertices on them and leaves the inside alone', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const s = sheet(3, 3, 3, 3, (u, v) => [u, v, 2]);
    const targets = Float64Array.from(s.mesh.positions, (p, k) => (k % 3 === 0 ? p + 1 : p)); // everything asked to move 1 along x
    const r = drapeCloth(s.mesh, s.flat, body, { targets, borderWeight: 1, edgePasses: 0, bending: 0, iterations: 1 });
    for (let j = 0; j <= 3; j++) for (let i = 0; i <= 3; i++) {
      const v = s.id(i, j);
      const onBorder = i === 0 || j === 0 || i === 3 || j === 3;
      expect(r.mesh.positions[3 * v]).toBeCloseTo(s.mesh.positions[3 * v] + (onBorder ? 1 : 0), 9);
      expect(r.seamError[v]).toBeCloseTo(0, 9); // border vertices reached their targets
    }
  });

  it('reports the distance of each border vertex from its target, the height above the body, and the worst border distance', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const s = sheet(3, 3, 3, 3, (u, v) => [u, v, 2]);
    const targets = Float64Array.from(s.mesh.positions, (p, k) => (k % 3 === 2 ? p : p + 0.25)); // 0.25 along x and y: 0.25 * sqrt(2) away
    const r = drapeCloth(s.mesh, s.flat, body, { targets, iterations: 0 });
    for (let j = 0; j <= 3; j++) for (let i = 0; i <= 3; i++) {
      const onBorder = i === 0 || j === 0 || i === 3 || j === 3;
      const v = s.id(i, j);
      expect(r.seamError[v]).toBeCloseTo(onBorder ? 0.25 * Math.SQRT2 : 0, 9);
      expect(r.gap[v]).toBeCloseTo(2, 9);
    }
    expect(r.maxSeamError).toBeCloseTo(0.25 * Math.SQRT2, 9);
  });

  it('takes the 98th percentile of the edge strains as the worst, so a few bad edges do not set it, and leaves out very short edges', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const s = sheet(5, 5, 10, 10, (u, v) => [u, v, 1]);
    const flat = s.flat.slice();
    const corner = s.id(0, 0);
    flat[2 * corner] -= 2; flat[2 * corner + 1] -= 2; // one corner vertex far out: its 3 edges are badly out
    const r = drapeCloth(s.mesh, flat, body, { iterations: 0 });
    expect(Math.max(...r.vertexStrain.map(Math.abs))).toBeGreaterThan(0.3); // the corner shows in the per-vertex strain
    expect(r.worstStrain).toBeLessThan(1e-9); // 3 outliers in 320 edges are above the 98th percentile
    // Edges shorter than half a millimetre... of flat pattern are left out of the worst figure, not of the vertex strain.
    const tiny = sheet(0.04, 0.04, 2, 2, (u, v) => [u, v, 1]);
    const squeezed = drapeCloth(tiny.mesh, tiny.flat.map((x) => x * 0.5), body, { iterations: 0 });
    expect(squeezed.worstStrain).toBe(0);
    for (const v of squeezed.vertexStrain) expect(v).toBeCloseTo(1, 9);
  });

  it('settles a piece that is already at rest in a handful of iterations, and says how many it took', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const s = sheet(3, 3, 3, 3, (u, v) => [u, v, 1]);
    const r = drapeCloth(s.mesh, s.flat, body, { iterations: 1000 });
    expect(r.iterations).toBe(6); // nothing moves, so the border pull halves each iteration: 1 to under 0.02 takes 6
  });

  it('reports zero strain, not NaN, for a vertex whose every edge is collapsed in the pattern', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const triangle: Mesh = { positions: Float64Array.from([0, 0, 1, 1, 0, 1, 0, 1, 1]), triangles: Uint32Array.from([0, 1, 2]) };
    const r = drapeCloth(triangle, [0, 0, 0, 0, 0, 0], body, { iterations: 0 });
    expect(Array.from(r.vertexStrain)).toEqual([0, 0, 0]);
    expect(r.worstStrain).toBe(0);
  });

  it('ignores flat edges of zero length when reporting strain', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const s = sheet(2, 2, 2, 2, (u, v) => [u, v, 1]);
    const collapsed = s.flat.slice();
    collapsed[2] = collapsed[0]; collapsed[3] = collapsed[1]; // vertex 1 sits on vertex 0 in the flat pattern
    const r = drapeCloth(s.mesh, collapsed, body, { iterations: 10 });
    expect(Number.isFinite(r.worstStrain)).toBe(true);
    for (const v of r.vertexStrain) expect(Number.isFinite(v)).toBe(true);
  });

  it('eases the border pull off by the last iteration whatever the iteration count', () => {
    // A piece that must stretch to reach a distant target: with the pull easing off, few iterations give nearly the
    // same (small) stretch as many.
    const body = new SurfaceField(plane(30, () => 0), 2);
    const run = (iterations: number) => {
      const s = sheet(4, 4, 5, 5, (u, v) => [u, v, 1]);
      const targets = Float64Array.from(s.mesh.positions, (p, k) => (k % 3 === 0 ? p * 1.5 : p));
      return drapeCloth(s.mesh, s.flat, body, { targets, iterations, borderWeight: 0.3 }).worstStrain;
    };
    expect(run(60)).toBeLessThan(0.02);
    expect(run(300)).toBeLessThan(0.02);
  });
});

describe('clothPattern', () => {
  const R = 5;
  const tube: Mesh = sheet(Math.PI, 10, 16, 4, (a, y) => [R * Math.sin(a), y, R * Math.cos(a)]).mesh;
  const Rc = R + 0.05;
  const wrapped = (u: number, v: number): [number, number, number] => [Rc * Math.sin(u / Rc), v, Rc * Math.cos(u / Rc)];

  it('wraps a strip round a cylinder and hands back a pattern that needs next to no stretch', () => {
    const body = new SurfaceField(tube, 2);
    const s = sheet(5, 4, 8, 5, (u, v) => wrapped(u, v));
    const flatStart = sheet(5, 4, 8, 5, (u, v) => [u, v, R + 2]); // starts flat above the cylinder
    const r = clothPattern(flatStart.mesh, s.flat, body, { targets: Float64Array.from(s.mesh.positions), iterations: 300, rounds: 3, touchUp: 40, borderWeight: 0.3 });
    expect(r.worstStrain).toBeLessThan(0.01);
    expect(r.flippedTriangles).toBe(0);
    expect(r.maxSeamError).toBeLessThan(0.5);
    const xs = Array.from({ length: r.uv.length / 2 }, (_, i) => r.uv[2 * i]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 0); // the pattern is as wide as the strip was cut
  });

  it('runs with one round or several, each leaving little stretch', () => {
    const body = new SurfaceField(plane(20, bump(0, 0, 2, 2), 20), 2);
    const run = (rounds: number) => {
      const s = sheet(5, 5, 6, 6, (u, v) => [u, v, 2.5]);
      return clothPattern(s.mesh, s.flat, body, { rounds, iterations: 150, touchUp: 30, targets: Float64Array.from(s.mesh.positions, (p, k) => (k % 3 === 2 ? 0.3 : p)) }).worstStrain;
    };
    expect(run(1)).toBeLessThan(0.05);
    expect(run(3)).toBeLessThan(0.05);
  });
});

describe('clothPatterns rounds', () => {
  const body = new SurfaceField(plane(20, bump(0, 0, 2, 2), 20), 2);
  const run = (options: object) => {
    const s = sheet(5, 5, 6, 6, (u, v) => [u, v, 2.5]);
    return clothPattern(s.mesh, s.flat, body, { iterations: 4, touchUp: 25, targets: Float64Array.from(s.mesh.positions, (p, k) => (k % 3 === 2 ? 0.3 : p)), ...options }).mesh.positions;
  };
  const apart = (a: Float64Array, b: Float64Array) => Math.max(...Array.from(a, (x, i) => Math.abs(x - b[i])));

  it('a later round moves the cloth on from the first, and uses its own iteration count and border pull', () => {
    const one = run({ rounds: 1 });
    const two = run({ rounds: 2 });
    expect(apart(one, two)).toBeGreaterThan(1e-4); // the touch-up did something
    expect(apart(two, run({ rounds: 2, touchUp: 5 }))).toBeGreaterThan(1e-5); // and how long it runs matters
    expect(apart(two, run({ rounds: 2, touchUpBorder: 0.9 }))).toBeGreaterThan(1e-5); // and so does the border pull it uses
    expect(apart(two, run({ rounds: 2 }))).toBe(0); // the same settings give the same answer
  });
});

describe('clothPatternsSteps (progress)', () => {
  const body = new SurfaceField(plane(20, bump(0, 0, 2, 2), 20), 2);
  const make = () => {
    const s = sheet(5, 5, 6, 6, (u, v) => [u, v, 2.5]);
    return { pieces: [{ mesh: s.mesh, flat: s.flat }], options: { iterations: 40, touchUp: 20, rounds: 3, targets: Float64Array.from(s.mesh.positions, (p, k) => (k % 3 === 2 ? 0.3 : p)) } };
  };

  it('reports where it is: settling every few iterations, then flattening, round by round, with the share done only ever growing to 1', () => {
    const { pieces, options } = make();
    const seen: ClothProgress[] = [];
    const steps = clothPatternsSteps(pieces, body, options);
    let step = steps.next();
    while (!step.done) { seen.push(step.value); step = steps.next(); }
    expect(seen.length).toBeGreaterThan(6);
    expect(seen[0]).toMatchObject({ stage: 'settling', round: 1, rounds: 3 });
    expect(seen[seen.length - 1]).toMatchObject({ stage: 'flattening', round: 3, rounds: 3 });
    expect(seen[seen.length - 1].fraction).toBeCloseTo(1, 9);
    for (let i = 1; i < seen.length; i++) expect(seen[i].fraction).toBeGreaterThanOrEqual(seen[i - 1].fraction);
    expect(seen.every((p) => p.fraction > 0 && p.fraction <= 1)).toBe(true);
    // one flattening after each of the three rounds, and the settling steps of rounds 2 and 3 are shorter than round 1's
    expect(seen.filter((p) => p.stage === 'flattening').map((p) => p.round)).toEqual([1, 2, 3]);
    expect(seen.filter((p) => p.stage === 'settling' && p.round === 1).length).toBeGreaterThan(seen.filter((p) => p.stage === 'settling' && p.round === 2).length);
    expect(step.value).toHaveLength(1);
  });

  it('gives the same answer as clothPatterns, which just runs it to the end', () => {
    const { pieces, options } = make();
    const direct = clothPatterns(pieces, body, options)[0];
    const steps = clothPatternsSteps(pieces, body, options);
    let step = steps.next();
    while (!step.done) step = steps.next();
    expect(Array.from(step.value[0].mesh.positions)).toEqual(Array.from(direct.mesh.positions));
    expect(step.value[0].worstStrain).toBe(direct.worstStrain);
  });
});

describe('panels sewn together (drapeGarment, clothPatterns)', () => {
  /** Two sheets side by side on y in [-3, 3], x in [-4, 0] and [0, 4]; the vertices on x = 0 are the same garment vertices. */
  function pair(seamStretchB = 1) {
    const nx = 4;
    const ny = 3;
    const left = sheet(2, 3, nx, ny, (u, v) => [u - 2, v, 1]);
    const right = sheet(2, 3, nx, ny, (u, v) => [u + 2, v, 1]);
    // vertex ids: left piece 0.., the right piece's own vertices, with its column i = 0 being the left piece's column i = nx.
    const idL = (i: number, j: number) => j * (nx + 1) + i;
    const base = (nx + 1) * (ny + 1);
    const idR = (i: number, j: number) => (i === 0 ? idL(nx, j) : base + j * nx + (i - 1));
    const mapL = Array.from({ length: base }, (_, v) => v);
    const mapR = Array.from({ length: base }, (_, v) => idR(v % (nx + 1), Math.floor(v / (nx + 1))));
    // Piece B's pattern: seam column edges stretched, so the two pieces disagree about the length of the seam.
    const flatR = right.flat.slice();
    for (let v = 0; v < base; v++) flatR[2 * v + 1] *= seamStretchB;
    return { pieces: [{ mesh: left.mesh, flat: left.flat, vertexMap: mapL }, { mesh: right.mesh, flat: flatR, vertexMap: mapR }], mapR, mapL, nx, ny };
  }
  const floor = () => new SurfaceField(plane(30, () => 0), 2);

  it('keeps the shared seam as one line: both pieces report the same positions there', () => {
    const { pieces, nx, ny } = pair();
    const [a, b] = drapeGarment(pieces, floor(), { iterations: 100 });
    for (let j = 0; j <= ny; j++) for (let k = 0; k < 3; k++) expect(a.mesh.positions[3 * (j * (nx + 1) + nx) + k]).toBe(b.mesh.positions[3 * (j * (nx + 1)) + k]);
  });

  it('splits the disagreement between the pieces when their patterns give the seam different lengths', () => {
    const { pieces } = pair(1.04); // piece B is cut 4% longer along the seam
    const [a, b] = drapeGarment(pieces, floor(), { iterations: 150, edgePasses: 16 });
    expect(a.worstStrain).toBeGreaterThan(0.005);
    expect(b.worstStrain).toBeGreaterThan(0.005);
    expect(a.worstStrain).toBeLessThan(0.04);
    expect(b.worstStrain).toBeLessThan(0.04);
  });

  it('draws only the outer border to its targets: with seamPull 0 the seam is free to move, with 1 it is held', () => {
    const { pieces, nx, ny } = pair();
    const n = Math.max(...pieces.flatMap((p) => Array.from(p.vertexMap!))) + 1;
    const targets = new Float64Array(3 * n);
    for (const p of pieces) p.vertexMap!.forEach((g, v) => targets.set([p.mesh.positions[3 * v] + 0.5, p.mesh.positions[3 * v + 1], p.mesh.positions[3 * v + 2]], 3 * g)); // everything asked to move 0.5 right
    const seamX = (r: ReturnType<typeof drapeGarment>) => { const j = Math.floor(ny / 2); return r[0].mesh.positions[3 * (j * (nx + 1) + nx)]; };
    const free = drapeGarment(pieces, floor(), { iterations: 100, targets, borderWeight: 0.2, seamPull: 0 });
    const held = drapeGarment(pieces, floor(), { iterations: 100, targets, borderWeight: 0.2, seamPull: 1 });
    expect(seamX(held)).toBeGreaterThan(seamX(free) - 1e-9); // held pulls it toward x = 0.5
    expect(seamX(held)).toBeGreaterThan(0.2);
  });

  it('puts the outer border on its targets and the seam only a share of the way (seamPull)', () => {
    const { pieces, nx, ny } = pair();
    const n = Math.max(...pieces.flatMap((p) => Array.from(p.vertexMap!))) + 1;
    const targets = new Float64Array(3 * n);
    for (const p of pieces) p.vertexMap!.forEach((g, v) => targets.set([p.mesh.positions[3 * v] + 1, p.mesh.positions[3 * v + 1], p.mesh.positions[3 * v + 2]], 3 * g));
    const at = (seamPull: number) => {
      const [a] = drapeGarment(pieces, floor(), { targets, borderWeight: 1, edgePasses: 0, bending: 0, iterations: 1, seamPull });
      const seam = a.mesh.positions[3 * (1 * (nx + 1) + nx)]; // seam vertex of row 1 (left piece's last column)
      const corner = a.mesh.positions[3 * 0]; // outer border: the left piece's first vertex
      const interior = a.mesh.positions[3 * (1 * (nx + 1) + 2)]; // row 1, column 2 of the left piece: not on the border or the seam
      return { seam, corner, interior };
    };
    expect(ny).toBeGreaterThan(1);
    for (const seamPull of [0, 0.5, 1]) {
      const { seam, corner, interior } = at(seamPull);
      expect(corner).toBeCloseTo(-4 + 1, 9); // outer border: all the way
      expect(seam).toBeCloseTo(0 + seamPull * 1, 9); // seam: the share asked for
      expect(interior).toBeCloseTo(-2, 9); // inside a piece nothing is drawn to a target
    }
  });

  it('keeps each piece\'s strain to its own edges', () => {
    const { pieces } = pair();
    const stretchedB = [pieces[0], { ...pieces[1], flat: pieces[1].flat.map((x) => x * 0.9) }]; // only piece B is cut small
    const [a, b] = drapeGarment(stretchedB, floor(), { iterations: 0 });
    expect(a.worstStrain).toBeCloseTo(0, 9); // A's own edges are exactly as long as its pattern says
    expect(b.worstStrain).toBeCloseTo(1 / 0.9 - 1, 9);
    expect(a.worstStrain).toBeLessThan(b.worstStrain - 1e-6);
  });

  it('returns a pattern for each piece, with the seam the same length on both', () => {
    const { pieces, nx, ny } = pair();
    const [a, b] = clothPatterns(pieces, floor(), { iterations: 100, rounds: 3, touchUp: 30 });
    const seamLength = (uv: Float64Array, column: number) => { let s = 0; for (let j = 0; j < ny; j++) s += Math.hypot(uv[2 * (j * (nx + 1) + column)] - uv[2 * ((j + 1) * (nx + 1) + column)], uv[2 * (j * (nx + 1) + column) + 1] - uv[2 * ((j + 1) * (nx + 1) + column) + 1]); return s; };
    expect(Math.abs(seamLength(a.uv, nx) - seamLength(b.uv, 0))).toBeLessThan(0.1);
    expect(a.flippedTriangles + b.flippedTriangles).toBe(0);
  });
});

/** An open tube of radius r around the y axis, from y = 0 to 100, standing for a torso, with a closed seam round it at y = 60. */
function tubeAndWaist(r = 10, sides = 48, rows = 40) {
  const positions: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i < sides; i++) positions.push(r * Math.cos((2 * Math.PI * i) / sides), (100 * j) / rows, r * Math.sin((2 * Math.PI * i) / sides));
  const tris: number[] = [];
  const id = (i: number, j: number) => j * sides + (i % sides);
  for (let j = 0; j < rows; j++) for (let i = 0; i < sides; i++) tris.push(id(i, j), id(i + 1, j + 1), id(i + 1, j), id(i, j), id(i, j + 1), id(i + 1, j + 1));
  const body: Mesh = { positions: Float64Array.from(positions), triangles: Uint32Array.from(tris) };
  const graph = new SurfaceGraph(body.triangles, body.positions.length / 3);
  const onTube = (angle: number) => { const hit = raycast(body, [30 * Math.cos(angle), 60, 30 * Math.sin(angle)], [-Math.cos(angle), 0, -Math.sin(angle)])!; return { tri: hit.tri, bary: hit.bary }; };
  const waist: Seam = { points: [0, 1, 2, 3].map((k) => onTube((k * Math.PI) / 2)), closed: true };
  return { body, waist, path: graph.seamPath(body.positions, waist) };
}
const { body, path } = tubeAndWaist();

describe('cloth simulation of a hanging panel', () => {
  it('keeps the sewn row where it is, lets the rest hang, and does not stretch', async () => {
    const { flatten } = await import('./flatten');
    const { uniformEase } = await import('./ease');
    const h = buildHanging(body, path, { length: 30, flare: 30 });
    const flat = flatten(h.mesh, { ease: uniformEase(0, 0) });
    const border = boundaryLoops(h.mesh)[0]; // the sewn row, the side seams and the hem
    const [result] = drapeGarment([{ mesh: h.mesh, flat: flat.uv, hanging: true, pinned: border }], new SurfaceField(body), { iterations: 600, edgePasses: 16, floor: 20 });
    for (const v of border) for (let c = 0; c < 3; c++) expect(result.mesh.positions[3 * v + c]).toBeCloseTo(h.mesh.positions[3 * v + c], 6); // seams and hem stay where they were put: no twisting, no riding up
    expect(result.worstStrain).toBeLessThan(0.02);
    for (let v = 0; v < result.mesh.positions.length / 3; v++) {
      expect(result.mesh.positions[3 * v + 1]).toBeGreaterThanOrEqual(20 - 1e-9); // not through the floor
      expect(Math.hypot(result.mesh.positions[3 * v], result.mesh.positions[3 * v + 2])).toBeGreaterThan(9.9); // not into the body
    }
  });
});

describe('cloth patterns for a hanging panel', () => {
  it('keeps it hanging and pinned through the touch-up rounds', async () => {
    const { flatten } = await import('./flatten');
    const { uniformEase } = await import('./ease');
    const h = buildHanging(body, path, { length: 30, flare: 30 });
    const flat = flatten(h.mesh, { ease: uniformEase(0, 0) });
    const pinned = Array.from({ length: h.columns }, (_, i) => i * h.rows);
    const [r] = clothPatterns([{ mesh: h.mesh, flat: flat.uv, hanging: true, pinned }], new SurfaceField(body), { rounds: 3, iterations: 100, touchUp: 30, edgePasses: 16 });
    for (const v of pinned) expect(r.mesh.positions[3 * v + 1]).toBeCloseTo(h.mesh.positions[3 * v + 1], 6);
    expect(r.maxSeamError).toBe(0); // no border target to fall short of
    expect(r.worstStrain).toBeLessThan(0.03);
  });
});

