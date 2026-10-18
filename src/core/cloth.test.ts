import { describe, expect, it } from 'vitest';
import { SurfaceField } from './bodyField';
import { clothPattern, drapeCloth } from './cloth';
import type { Mesh } from './mesh';

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
const plane = (half: number, h: (x: number, y: number) => number): Mesh => sheet(half, half, 30, 30, (x, y) => [x, y, h(x, y)]).mesh;
const bump = (cx: number, cy: number, height: number, sigma: number) => (x: number, y: number) => height * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));

describe('drapeCloth', () => {
  it('leaves a flat piece lying on a flat body where it is, at the standoff above it', () => {
    const body = new SurfaceField(plane(20, () => 0), 2);
    const s = sheet(6, 6, 12, 12, (u, v) => [u, v, 1]);
    const r = drapeCloth(s.mesh, s.flat, body, { standoff: 0.05 });
    expect(r.worstStrain).toBeLessThan(1e-6);
    expect(r.maxSeamError).toBeLessThan(0.1);
    for (let v = 0; v < s.flat.length / 2; v++) expect(r.mesh.positions[3 * v + 2]).toBeLessThan(1.001);
  });

  it('wraps a flat strip around a cylinder without stretching it (a developable surface)', () => {
    const R = 5;
    const tube: Mesh = (() => {
      const around = 48;
      const rows = sheet(Math.PI, 20, around, 20, (a, y) => [R * Math.sin(a), y, R * Math.cos(a)]);
      return rows.mesh;
    })();
    const body = new SurfaceField(tube, 2);
    const Rc = R + 0.05;
    const wrapped = (u: number, v: number): [number, number, number] => [Rc * Math.sin(u / Rc), v, Rc * Math.cos(u / Rc)];
    const s = sheet(6, 8, 20, 16, (u, v) => [u, v, R + 2]);
    const targets = Float64Array.from(s.flat.flatMap((_, k) => (k % 2 === 0 ? wrapped(s.flat[k], s.flat[k + 1]) : [])));
    const r = drapeCloth(s.mesh, s.flat, body, { standoff: 0.05, targets, iterations: 4000, borderWeight: 0.3 });
    expect(r.worstStrain).toBeLessThan(0.01);
    expect(r.maxSeamError).toBeLessThan(0.3);
    for (let v = 0; v < s.flat.length / 2; v++) expect(body.closest([r.mesh.positions[3 * v], r.mesh.positions[3 * v + 1], r.mesh.positions[3 * v + 2]]).signed).toBeGreaterThan(0.05 - 5e-3);
    expect(Math.max(...r.gap)).toBeLessThan(0.4); // lies on the cylinder, not floating over it
  });

  it('spans the hollow between two bumps, never enters the body, and falls short at the border instead of stretching', () => {
    const [f1, f2] = [bump(-4, 0, 3, 1.8), bump(4, 0, 3, 1.8)];
    const body = new SurfaceField(plane(14, (x, y) => f1(x, y) + f2(x, y)), 2);
    const s = sheet(10, 6, 30, 18, (u, v) => [u, v, 3.5]);
    // The border is drawn down to the ground all round, under the bumps' skirts, so the cloth has to come down over them.
    const targets = Float64Array.from(s.mesh.positions, (v, k) => (k % 3 === 2 ? 0.05 : v));
    const r = drapeCloth(s.mesh, s.flat, body, { standoff: 0.05, iterations: 1500, targets, borderWeight: 0.02 });
    expect(r.worstStrain).toBeLessThan(0.01);
    expect(r.maxSeamError).toBeGreaterThan(0.1); // it cannot reach the ground at the border without stretching, so it stops short
    for (let v = 0; v < s.flat.length / 2; v++) expect(body.closest([r.mesh.positions[3 * v], r.mesh.positions[3 * v + 1], r.mesh.positions[3 * v + 2]]).signed).toBeGreaterThan(0.05 - 5e-3);
    const mid = s.id(15, 9); // the vertex over (0, 0)
    expect(r.gap[mid]).toBeGreaterThan(0.5); // bridges the valley rather than following it
  });

  it('falls under gravity (down is -y, the body up axis) onto the body when nothing holds it, and stays put without gravity', () => {
    const floor = new SurfaceField(sheet(20, 20, 20, 20, (u, v) => [v, 0, u]).mesh, 2); // y = 0, normals up
    const s = sheet(6, 6, 10, 10, (u, v) => [u, 3, v]);
    const held = drapeCloth(s.mesh, s.flat, floor, { borderWeight: 0, iterations: 100 });
    expect(Math.min(...held.gap)).toBeCloseTo(3, 6);
    const falling = drapeCloth(s.mesh, s.flat, floor, { borderWeight: 0, gravity: 0.1, iterations: 200, standoff: 0.05 });
    expect(Math.max(...falling.gap)).toBeLessThan(0.06);
    expect(falling.worstStrain).toBeLessThan(1e-6); // it fell without stretching
  });

  it('does not stretch or enter the body with bending off or high', () => {
    const body = new SurfaceField(plane(20, bump(0, 0, 2, 2)), 2);
    for (const bending of [0, 0.5]) {
      const s = sheet(5, 5, 10, 10, (u, v) => [u, v, 2.5]);
      const r = drapeCloth(s.mesh, s.flat, body, { bending, gravity: 0.05, borderWeight: 0.02, iterations: 400 });
      expect(r.worstStrain).toBeLessThan(0.05);
      for (let v = 0; v < s.flat.length / 2; v++) expect(body.closest([r.mesh.positions[3 * v], r.mesh.positions[3 * v + 1], r.mesh.positions[3 * v + 2]]).signed).toBeGreaterThan(0.05 - 5e-3);
    }
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
      const s = sheet(4, 4, 8, 8, (u, v) => [u, v, 1]);
      const targets = Float64Array.from(s.mesh.positions, (p, k) => (k % 3 === 0 ? p * 1.5 : p));
      return drapeCloth(s.mesh, s.flat, body, { targets, iterations, borderWeight: 0.3 }).worstStrain;
    };
    expect(run(150)).toBeLessThan(0.02);
    expect(run(900)).toBeLessThan(0.02);
  });
});

describe('clothPattern', () => {
  const R = 5;
  const tube: Mesh = sheet(Math.PI, 20, 48, 20, (a, y) => [R * Math.sin(a), y, R * Math.cos(a)]).mesh;
  const Rc = R + 0.05;
  const wrapped = (u: number, v: number): [number, number, number] => [Rc * Math.sin(u / Rc), v, Rc * Math.cos(u / Rc)];

  it('wraps a strip round a cylinder and hands back a pattern that needs next to no stretch', () => {
    const body = new SurfaceField(tube, 2);
    const s = sheet(6, 8, 20, 16, (u, v) => wrapped(u, v));
    const flatStart = sheet(6, 8, 20, 16, (u, v) => [u, v, R + 2]); // starts flat above the cylinder
    const r = clothPattern(flatStart.mesh, s.flat, body, { targets: Float64Array.from(s.mesh.positions), iterations: 1500 });
    expect(r.worstStrain).toBeLessThan(0.01);
    expect(r.flippedTriangles).toBe(0);
    expect(r.maxSeamError).toBeLessThan(0.5);
    const xs = Array.from({ length: r.uv.length / 2 }, (_, i) => r.uv[2 * i]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12, 0); // the pattern is as wide as the strip was cut
  });

  it('runs with one round or several, each leaving little stretch', () => {
    const body = new SurfaceField(plane(20, bump(0, 0, 2, 2)), 2);
    const run = (rounds: number) => {
      const s = sheet(5, 5, 10, 10, (u, v) => [u, v, 2.5]);
      return clothPattern(s.mesh, s.flat, body, { rounds, iterations: 600, targets: Float64Array.from(s.mesh.positions, (p, k) => (k % 3 === 2 ? 0.3 : p)) }).worstStrain;
    };
    expect(run(1)).toBeLessThan(0.05);
    expect(run(3)).toBeLessThan(0.05);
  });
});
