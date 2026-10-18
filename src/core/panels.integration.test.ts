import { beforeAll, describe, expect, it } from 'vitest';
import { area, cutMesh, locateInCut, panelEdges, regionFrom } from './cut';
import { uniformEase } from './ease';
import { flatten } from './flatten';
import { loadBodyFromDisk } from './loadBodyNode';
import { Measurer } from './measure';
import { SurfaceField } from './bodyField';
import { drapeCloth } from './cloth';
import { drape, drapeSeams } from './drape';
import { extractSubmesh } from './mesh';
import { type Seam, type SurfacePoint, SurfaceGraph, closestSurfacePoint, raycast } from './seam';

// Integration: a bodice front and back on the real body, cut by shoulder, armhole, side, neckline and hem seams that
// meet at shared points. Slow (seconds), so the mutation harness leaves it out.
let result: Awaited<ReturnType<typeof build>>;

async function build(ease: { front: [number, number]; back: [number, number] } = { front: [0, 0], back: [0, 0] }, princess: false | 'neck' | 'shoulder' = false) {
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
  if (princess === 'neck') seams.push(open([lm('neck point L'), lm('bust apex L'), front(8, 105)]), open([lm('neck point R'), lm('bust apex R'), front(-8, 105)]));
  if (princess === 'shoulder') {
    // The princess seam starts halfway along the shoulder seam, which gets a control point there so the two meet.
    const mid = (a: string, b: string): SurfacePoint => closestSurfacePoint(mesh, [0, 1, 2].map((k) => ((marks[a] as number[])[k] + (marks[b] as number[])[k]) / 2) as [number, number, number]);
    const [midL, midR] = [mid('neck point L', 'shoulder point L'), mid('neck point R', 'shoulder point R')];
    seams[2] = open([lm('neck point L'), midL, lm('shoulder point L')]);
    seams[3] = open([lm('neck point R'), midR, lm('shoulder point R')]);
    seams.push(open([midL, lm('bust apex L'), front(8, 105)]), open([midR, lm('bust apex R'), front(-8, 105)]));
  }
  const cut = cutMesh(mesh, graph, seams);
  const bodyField = new SurfaceField(mesh);
  const taut = drapeSeams(cut);
  const panel = (seed: SurfacePoint, e: [number, number]) => {
    const triangles = regionFrom(cut, locateInCut(cut, mesh, seed));
    const sub = extractSubmesh(cut.mesh, triangles);
    const flat = flatten(sub.mesh, { ease: uniformEase(e[0], e[1]) });
    const boundary = new Float64Array(3 * sub.vertexMap.length);
    sub.vertexMap.forEach((v, i) => boundary.set(taut.positions.slice(3 * v, 3 * v + 3), 3 * i));
    const draped = drape(sub.mesh, { boundary });
    const flatDraped = flatten(draped.mesh, { ease: uniformEase(e[0], e[1]) });
    // The cloth simulation takes seconds, so it runs only for the panels a test asks about.
    let memo: ReturnType<typeof drapeCloth> | undefined;
    const cloth = () => (memo ??= drapeCloth(draped.mesh, flatDraped.uv, bodyField, { targets: draped.mesh.positions, iterations: 1500, borderWeight: 0.1 }));
    const subOf = new Map(sub.vertexMap.map((v, i) => [v, i]));
    const edges = panelEdges(cut, triangles)!.map((edge) => ({
      seam: edge.seam,
      body: edge.length,
      flat: edge.vertices.slice(1).reduce((s, v, k) => { const [a, b] = [subOf.get(edge.vertices[k])!, subOf.get(v)!]; return s + Math.hypot(flat.uv[2 * a] - flat.uv[2 * b], flat.uv[2 * a + 1] - flat.uv[2 * b + 1]); }, 0),
    }));
    const drapedEdges = panelEdges(cut, triangles)!.map((edge) => ({
      seam: edge.seam,
      body: edge.vertices.slice(1).reduce((t, v, k) => t + Math.hypot(...[0, 1, 2].map((c) => taut.positions[3 * v + c] - taut.positions[3 * edge.vertices[k] + c]) as [number, number, number]), 0),
      flat: edge.vertices.slice(1).reduce((t, v, k) => { const [a, b] = [subOf.get(edge.vertices[k])!, subOf.get(v)!]; return t + Math.hypot(flatDraped.uv[2 * a] - flatDraped.uv[2 * b], flatDraped.uv[2 * a + 1] - flatDraped.uv[2 * b + 1]); }, 0),
    }));
    return { flat, flatDraped, draped, cloth, edges, drapedEdges, size: area(cut.mesh, triangles) };
  };
  return { side: princess ? panel(front(14, 125), ease.front) : undefined, front: panel(front(0, 125), ease.front), back: panel(back(0, 125), ease.back) };
}

let princessResult: Awaited<ReturnType<typeof build>>;
let shoulderResult: Awaited<ReturnType<typeof build>>;
beforeAll(async () => { result = await build(); princessResult = await build(undefined, 'neck'); shoulderResult = await build(undefined, 'shoulder'); }, 240_000);

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

  it('draping lifts the cloth off the skin where it bridges a hollow, and never below it', () => {
    for (const p of [result.front, result.back]) expect(Math.max(...p.draped.gap)).toBeGreaterThan(0.3);
  });
  it('a draped panel keeps its shared seams matching: both sides see the same taut seam', () => {
    for (const seam of shared) {
      const [df, db] = [result.front.drapedEdges.find((e) => e.seam === seam)!, result.back.drapedEdges.find((e) => e.seam === seam)!];
      expect(df.body).toBeCloseTo(db.body, 6);
      expect(Math.abs(df.flat - df.body) / df.body).toBeLessThan(0.003);
      expect(Math.abs(df.flat - db.flat)).toBeLessThan(0.1);
      expect(df.body).toBeLessThanOrEqual(side(result.front, seam).body + 1e-9); // a taut seam is never longer than the skin path
    }
  });
  it('draping reduces the strain of a centre front panel cut by princess seams through the bust', () => {
    const p = princessResult.front;
    expect(p.flatDraped.worstStrain).toBeLessThan(0.8 * p.flat.worstStrain);
  });

  it('draping does not make the side panel next to a princess seam any worse', () => {
    const p = princessResult.side!;
    expect(p.flatDraped.worstStrain).toBeLessThanOrEqual(p.flat.worstStrain);
  });
  it('with a shoulder princess seam, draping lowers the centre front strain and does not worsen the side panel', () => {
    expect(shoulderResult.front.flatDraped.worstStrain).toBeLessThan(0.8 * shoulderResult.front.flat.worstStrain);
    expect(shoulderResult.side!.flatDraped.worstStrain).toBeLessThanOrEqual(shoulderResult.side!.flat.worstStrain);
    for (const p of [shoulderResult.front, shoulderResult.side!]) expect(p.flatDraped.flippedTriangles).toBe(0);
  });
  it('a cloth simulation needs less stretch than the membrane drape did, and the seams fall a little short instead', () => {
    for (const p of [shoulderResult.front, shoulderResult.side!]) {
      const c = p.cloth();
      expect(c.worstStrain).toBeLessThan(0.8 * p.flatDraped.worstStrain);
      expect(c.maxSeamError).toBeLessThan(2); // cm: the seams fall a little short of their lines, not far
      for (const gap of c.gap) expect(gap).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);
});
