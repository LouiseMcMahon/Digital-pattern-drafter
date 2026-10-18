import { beforeAll, describe, expect, it } from 'vitest';
import { area, cutMesh, locateInCut, panelEdges, regionFrom } from './cut';
import { uniformEase } from './ease';
import { flatten } from './flatten';
import { loadBodyFromDisk } from './loadBodyNode';
import { Measurer } from './measure';
import { extractSubmesh } from './mesh';
import { type Seam, type SurfacePoint, SurfaceGraph, closestSurfacePoint, raycast } from './seam';

// Integration: a bodice front and back on the real body, cut by shoulder, armhole, side, neckline and hem seams that
// meet at shared points. Slow (seconds), so the mutation harness leaves it out.
let result: Awaited<ReturnType<typeof build>>;

async function build(ease: { front: [number, number]; back: [number, number] } = { front: [0, 0], back: [0, 0] }) {
  const body = await loadBodyFromDisk();
  const shape = body.evaluate({});
  const marks = Object.fromEntries(new Measurer(body).inspect(shape).marks.map((k) => [k.name, k.point]));
  const mesh = { positions: shape.positions, triangles: body.faces };
  const graph = new SurfaceGraph(body.faces, shape.positions.length / 3);
  const ray = (x: number, y: number, dir: 1 | -1): SurfacePoint => { const h = raycast(mesh, [x, y, 300 * dir], [0, 0, -dir])!; return { tri: h.tri, bary: h.bary }; };
  const front = (x: number, y: number) => ray(x, y, 1);
  const back = (x: number, y: number) => ray(x, y, -1);
  const lm = (name: string): SurfacePoint => closestSurfacePoint(mesh, marks[name] as [number, number, number]);
  const sideL = closestSurfacePoint(mesh, [13.5, 105, 3]);
  const sideR = closestSurfacePoint(mesh, [-13.5, 105, 3]);
  const open = (points: SurfacePoint[]): Seam => ({ points, closed: false });
  const seams: Seam[] = [
    open([lm('neck point L'), front(0, 148), lm('neck point R')]), // 0 neckline front
    open([lm('neck point L'), back(0, 152), lm('neck point R')]), // 1 neckline back
    open([lm('neck point L'), lm('shoulder point L')]), // 2 shoulder L
    open([lm('neck point R'), lm('shoulder point R')]), // 3 shoulder R
    open([lm('shoulder point L'), front(17, 141), lm('axilla L')]), // 4 front armhole L
    open([lm('shoulder point L'), back(17, 141), lm('axilla L')]), // 5 back armhole L
    open([lm('shoulder point R'), front(-17, 141), lm('axilla R')]), // 6
    open([lm('shoulder point R'), back(-17, 141), lm('axilla R')]), // 7
    open([lm('axilla L'), sideL]), // 8 side L
    open([lm('axilla R'), sideR]), // 9 side R
    open([sideL, front(8, 105), front(0, 105), front(-8, 105), sideR]), // 10 hem front
    open([sideL, back(8, 105), back(0, 105), back(-8, 105), sideR]), // 11 hem back
  ];
  const cut = cutMesh(mesh, graph, seams);
  const panel = (seed: SurfacePoint, e: [number, number]) => {
    const triangles = regionFrom(cut, locateInCut(cut, mesh, seed));
    const sub = extractSubmesh(cut.mesh, triangles);
    const flat = flatten(sub.mesh, { ease: uniformEase(e[0], e[1]) });
    const subOf = new Map(sub.vertexMap.map((v, i) => [v, i]));
    const edges = panelEdges(cut, triangles)!.map((edge) => ({
      seam: edge.seam,
      body: edge.length,
      flat: edge.vertices.slice(1).reduce((s, v, k) => { const [a, b] = [subOf.get(edge.vertices[k])!, subOf.get(v)!]; return s + Math.hypot(flat.uv[2 * a] - flat.uv[2 * b], flat.uv[2 * a + 1] - flat.uv[2 * b + 1]); }, 0),
    }));
    return { flat, edges, size: area(cut.mesh, triangles) };
  };
  return { front: panel(front(0, 125), ease.front), back: panel(back(0, 125), ease.back) };
}

beforeAll(async () => { result = await build(); }, 120_000);

describe('bodice front and back sharing seams (real body)', () => {
  const shared = [2, 3, 8, 9]; // shoulder L and R, side seams L and R
  const side = (p: { edges: { seam: number | undefined; body: number; flat: number }[] }, seam: number) => p.edges.find((e) => e.seam === seam)!;

  it('both panels are made, flip-free, and have the expected sides', () => {
    for (const p of [result.front, result.back]) {
      expect(p.flat.flippedTriangles).toBe(0);
      expect(p.edges.filter((e) => e.seam !== undefined)).toHaveLength(8);
    }
  });
  it('a shared seam is as long on the flat as on the body, on both panels, so the two panels match along it (0% ease)', () => {
    for (const seam of shared) {
      const [f, b] = [side(result.front, seam), side(result.back, seam)];
      expect(f.body).toBeCloseTo(b.body, 6); // same line on the body
      expect(Math.abs(f.flat - f.body) / f.body).toBeLessThan(0.003);
      expect(Math.abs(b.flat - b.body) / b.body).toBeLessThan(0.003);
      expect(Math.abs(f.flat - b.flat)).toBeLessThan(0.1); // under a millimetre apart on a 12 to 36 cm seam
    }
  });
});
