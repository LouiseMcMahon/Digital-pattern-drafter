import type { SurfaceField } from './bodyField';
import { uniformEase } from './ease';
import { flatten } from './flatten';
import { type Mesh, boundaryLoops, meshEdges, vertexCount } from './mesh';

export interface ClothOptions {
  /** Distance the cloth is kept off the body (cm). Default 0.05. */
  standoff?: number;
  /** Most iterations. Default 600. */
  iterations?: number;
  /** When no vertex moves more than this in an iteration (cm), the border pull is halved. Default 1e-4. */
  tolerance?: number;
  /** How strongly the border is drawn to its targets each iteration (0 to 1). Default 0.2. */
  borderWeight?: number;
  /**
   * How strongly opposite corners of neighbouring triangles are held at their flat-pattern distance, 0 (a hinge at
   * every edge) to 1. That distance is the flat one, so any value above 0 leans the cloth toward flat: keep it small.
   * On the princess front panels 0, 0.01 and 0.05 give the same lift and strain to within about 0.3 cm and 0.4%. Default 0.01.
   */
  bending?: number;
  /** Where the border vertices are headed (xyz per garment vertex; only border entries are read). Default: where they start. */
  targets?: Float64Array;
  /** Edge-length passes per iteration. More makes the cloth stiffer against the border pull and the body (less stretch, slower). Default 8. */
  edgePasses?: number;
  /** Downward pull per iteration (cm). Default 0, which is right for a piece held all round by its seams. */
  gravity?: number;
}

export interface ClothResult {
  mesh: Mesh;
  /** Per vertex: height above the body (cm). */
  gap: Float64Array;
  /** Per vertex: mean over its edges of (3D length / flat length - 1): positive where stretched. */
  vertexStrain: Float64Array;
  /** The 98th percentile of |3D length / flat length - 1| over the edges (short edges excluded as in flatten). */
  worstStrain: number;
  /** Per vertex on the piece's border, how far it is from its target (cm); 0 elsewhere. */
  seamError: Float64Array;
  maxSeamError: number;
  iterations: number;
}

/** One panel of a garment: its mesh (with the 3D shape to start from), its flat pattern, and which garment vertex each of its vertices is. */
export interface ClothPiece {
  mesh: Mesh;
  /** xy per vertex of the mesh: the flat pattern, whose edge lengths the cloth keeps. */
  flat: ArrayLike<number>;
  /** Garment vertex id of each vertex of the mesh. Panels sewn together share ids along their seam, so the seam is one line of vertices. Default: the mesh's own numbering. */
  vertexMap?: ArrayLike<number>;
}

export interface GarmentOptions extends ClothOptions {
  /**
   * How strongly the vertices of a seam between two panels are drawn to their targets, as a share of the border pull
   * (0 to 1). At 0 (the default) a seam is held only by the two panels pulling on each other, so it settles where they
   * balance; the outer edges (neckline, armholes, hem) are what is drawn to the targets.
   */
  seamPull?: number;
}

const mapOf = (p: ClothPiece): ArrayLike<number> => p.vertexMap ?? Array.from({ length: vertexCount(p.mesh) }, (_, i) => i);

/** The pieces' 3D positions gathered by garment vertex (where two pieces share a vertex they agree). */
function garmentPositions(pieces: readonly ClothPiece[]): Float64Array {
  let n = 0;
  const maps = pieces.map(mapOf);
  for (const m of maps) for (let i = 0; i < m.length; i++) n = Math.max(n, m[i] + 1);
  const pos = new Float64Array(3 * n);
  pieces.forEach((p, k) => { for (let v = 0; v < vertexCount(p.mesh); v++) for (let c = 0; c < 3; c++) pos[3 * maps[k][v] + c] = p.mesh.positions[3 * v + c]; });
  return pos;
}

/** What stays the same from one round of simulation to the next: which vertices each constraint joins, how stiff it is, and which vertices are drawn to targets. */
interface GarmentTopology {
  maps: ArrayLike<number>[];
  /** Number of garment vertices. */
  n: number;
  /** The garment vertices that belong to some piece. */
  used: number[];
  a: Int32Array;
  b: Int32Array;
  weight: Float64Array;
  /** For each constraint: its piece, and its two vertices numbered in that piece. */
  owner: Int32Array;
  la: Int32Array;
  lb: Int32Array;
  /** The first `edgeCount` constraints are mesh edges (they count toward strain); the rest are bending. */
  edgeCount: number;
  /** Per garment vertex: how strongly it is drawn to its target (1 on the outer border, `seamPull` on a seam). */
  pull: Float64Array;
  pulled: number[];
}

function buildTopology(pieces: readonly ClothPiece[], bending: number, seamPull: number): GarmentTopology {
  const maps = pieces.map(mapOf);
  let n = 0;
  for (const m of maps) for (let i = 0; i < m.length; i++) n = Math.max(n, m[i] + 1);
  const used: number[] = [];
  const pieceCount = new Uint8Array(n);
  pieces.forEach((p, k) => { for (let v = 0; v < vertexCount(p.mesh); v++) { if (!pieceCount[maps[k][v]]) used.push(maps[k][v]); pieceCount[maps[k][v]]++; } });
  const edges: { a: number; b: number; piece: number; la: number; lb: number }[] = [];
  const across: typeof edges = [];
  const times = new Map<number, number>(); // garment edge -> how many triangles (over all pieces) have it: 1 on the outer border
  pieces.forEach((p, k) => {
    const found = meshEdges(p.mesh);
    found.a.forEach((la, i) => {
      const lb = found.b[i];
      const [a, b] = [maps[k][la], maps[k][lb]];
      edges.push({ a, b, piece: k, la, lb });
      const key = Math.min(a, b) * n + Math.max(a, b);
      times.set(key, (times.get(key) ?? 0) + found.opposite[i].length);
    });
    if (bending > 0) for (const o of found.opposite) if (o.length === 2 && o[0] !== o[1]) across.push({ a: maps[k][o[0]], b: maps[k][o[1]], piece: k, la: o[0], lb: o[1] });
  });
  const all = [...edges, ...across];
  // The outer border of the garment (edges only one triangle has) is drawn to its targets; seams between pieces are not, or only a little.
  const pull = new Float64Array(n);
  for (const g of used) if (pieceCount[g] > 1) pull[g] = seamPull;
  for (const e of edges) if (times.get(Math.min(e.a, e.b) * n + Math.max(e.a, e.b)) === 1) { pull[e.a] = 1; pull[e.b] = 1; }
  return {
    maps, n, used,
    a: Int32Array.from(all, (e) => e.a), b: Int32Array.from(all, (e) => e.b),
    weight: Float64Array.from(all, (_, i) => (i < edges.length ? 1 : bending)),
    owner: Int32Array.from(all, (e) => e.piece), la: Int32Array.from(all, (e) => e.la), lb: Int32Array.from(all, (e) => e.lb),
    edgeCount: edges.length, pull, pulled: used.filter((g) => pull[g] > 0),
  };
}

/** The length each constraint is held to: the distance between its vertices on its piece's flat pattern. */
function restLengths(top: GarmentTopology, pieces: readonly ClothPiece[]): Float64Array {
  return Float64Array.from(top.a, (_, i) => {
    const f = pieces[top.owner[i]].flat;
    return Math.hypot(f[2 * top.la[i]] - f[2 * top.lb[i]], f[2 * top.la[i] + 1] - f[2 * top.lb[i] + 1]);
  });
}

/**
 * Cloth: flat pattern pieces laid over the body and sewn together along the seams they share.
 *
 * Each piece is a triangle mesh whose edges keep the length they have on its flat pattern (cloth does not stretch),
 * whose corners may not go inside the body, and whose outer edges are drawn toward where they are meant to be on the
 * body. Pieces that share seam vertices (the same `vertexMap` id) are one cloth there, so a seam is pulled on by both
 * panels, not simulated twice. It is relaxed by position-based dynamics: each edge is pulled back to its flat length, the
 * outer border is pulled toward its targets, and anything inside the body is pushed out, over and over until it settles.
 *
 * Where the patterns cannot reach their targets without stretching, the cloth does not stretch: the border ends up
 * short of its target instead, and `seamError` says by how much. `worstStrain` reports any stretch that is left.
 */
export function drapeGarment(pieces: readonly ClothPiece[], body: SurfaceField, options: GarmentOptions = {}): ClothResult[] {
  return simulate(pieces, buildTopology(pieces, options.bending ?? 0.01, options.seamPull ?? 0), body, options);
}

function simulate(pieces: readonly ClothPiece[], top: GarmentTopology, body: SurfaceField, options: GarmentOptions): ClothResult[] {
  const { standoff = 0.05, iterations = 600, tolerance = 1e-4, borderWeight = 0.2, gravity = 0, edgePasses = 8 } = options;
  const { maps, used, a: A, b: B, weight: W, owner, la, lb, edgeCount, pull, pulled } = top;
  const pos = garmentPositions(pieces);
  const targets = options.targets ?? Float64Array.from(pos);
  const L = restLengths(top, pieces);
  const m = A.length;

  const slack = new Float64Array(top.n); // how far a vertex can still travel before it could touch the body
  const before = new Float64Array(3 * top.n);
  let done = 0;
  let ease = 1; // how much of the border pull is left
  const decay = Math.pow(0.02, 1 / iterations); // the pull is down to 2% by the last iteration, however many there are
  for (; done < iterations; done++) {
    before.set(pos);
    if (gravity) for (const v of used) pos[3 * v + 1] -= gravity;
    // Stryker disable all: the hot loop (about 20 million projections per run); instrumented it is 30 times slower and made every mutant take minutes. The tests check its result: edge lengths.
    for (let pass = 0; pass < edgePasses; pass++) for (let i = 0; i < m; i++) {
      const a3 = 3 * A[i];
      const b3 = 3 * B[i];
      const dx = pos[b3] - pos[a3];
      const dy = pos[b3 + 1] - pos[a3 + 1];
      const dz = pos[b3 + 2] - pos[a3 + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-12) continue;
      const f = (W[i] * 0.5 * (l - L[i])) / l;
      pos[a3] += f * dx; pos[a3 + 1] += f * dy; pos[a3 + 2] += f * dz;
      pos[b3] -= f * dx; pos[b3 + 1] -= f * dy; pos[b3 + 2] -= f * dz;
    }
    // Stryker restore all
    // The pull on the border eases off as the run goes on, so what is left at the end is the border as close to its
    // targets as the cloth can get without stretching.
    for (const v of pulled) for (let k = 0; k < 3; k++) pos[3 * v + k] += borderWeight * ease * pull[v] * (targets[3 * v + k] - pos[3 * v + k]);
    let worst = 0;
    for (const v of used) {
      slack[v] -= Math.hypot(pos[3 * v] - before[3 * v], pos[3 * v + 1] - before[3 * v + 1], pos[3 * v + 2] - before[3 * v + 2]);
      if (slack[v] <= 0) {
        const c = body.closest([pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
        if (c.signed < standoff) for (let k = 0; k < 3; k++) pos[3 * v + k] = c.point[k] + c.normal[k] * standoff;
        slack[v] = Math.max(0, c.signed - standoff);
      }
      worst = Math.max(worst, Math.hypot(pos[3 * v] - before[3 * v], pos[3 * v + 1] - before[3 * v + 1], pos[3 * v + 2] - before[3 * v + 2]));
    }
    ease *= worst < tolerance ? 0.5 : decay;
    if (ease < 0.02) { done++; break; }
  }

  // Report, piece by piece.
  return pieces.map((p, k) => {
    const nv = vertexCount(p.mesh);
    const positions = new Float64Array(3 * nv);
    for (let v = 0; v < nv; v++) for (let c = 0; c < 3; c++) positions[3 * v + c] = pos[3 * maps[k][v] + c];
    const vertexStrain = new Float64Array(nv);
    const degree = new Float64Array(nv);
    const strains: number[] = [];
    for (let i = 0; i < edgeCount; i++) {
      if (owner[i] !== k || L[i] < 1e-6) continue; // a collapsed flat edge has no strain to speak of
      const [x, y] = [la[i], lb[i]];
      const l = Math.hypot(positions[3 * y] - positions[3 * x], positions[3 * y + 1] - positions[3 * x + 1], positions[3 * y + 2] - positions[3 * x + 2]);
      const s = l / L[i] - 1;
      vertexStrain[x] += s; vertexStrain[y] += s; degree[x]++; degree[y]++;
      if (L[i] > 0.05) strains.push(Math.abs(s));
    }
    for (let v = 0; v < nv; v++) if (degree[v]) vertexStrain[v] /= degree[v];
    strains.sort((x, y) => x - y);
    const gap = new Float64Array(nv);
    for (let v = 0; v < nv; v++) gap[v] = Math.max(0, body.closest([positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]]).signed);
    const seamError = new Float64Array(nv);
    let maxSeamError = 0;
    for (const loop of boundaryLoops(p.mesh)) for (const v of loop) {
      const g = maps[k][v];
      seamError[v] = Math.hypot(positions[3 * v] - targets[3 * g], positions[3 * v + 1] - targets[3 * g + 1], positions[3 * v + 2] - targets[3 * g + 2]);
      maxSeamError = Math.max(maxSeamError, seamError[v]);
    }
    return { mesh: { positions, triangles: p.mesh.triangles }, gap, vertexStrain, worstStrain: strains.length ? strains[Math.min(strains.length - 1, Math.floor(0.98 * strains.length))] : 0, seamError, maxSeamError, iterations: done };
  });
}

/** One piece laid over the body: `drapeGarment` with a single piece. */
export function drapeCloth(start: Mesh, flat: ArrayLike<number>, body: SurfaceField, options: ClothOptions = {}): ClothResult {
  return drapeGarment([{ mesh: start, flat }], body, options)[0];
}

export interface ClothPatternOptions extends GarmentOptions {
  /** Simulate-then-reflatten rounds: the first is a full run, each later one a short touch-up. Default 10. */
  rounds?: number;
  /** Iterations in each later round. Default 60. */
  touchUp?: number;
  /** Border pull in each later round (see `borderWeight`). Default 0.002: the first round puts the border where it belongs; pulling hard again each round undoes the progress toward a pattern that fits. */
  touchUpBorder?: number;
}

export interface ClothPatternResult {
  /** The cloth as laid over the body. */
  mesh: Mesh;
  /** The flat pattern that goes with it: the cloth flattened (xy per vertex, cm). */
  uv: Float64Array;
  /** The 98th percentile of |flat length / 3D length - 1| between this mesh and this pattern (the stretch a piece cut to this pattern needs). */
  worstStrain: number;
  vertexStrain: Float64Array;
  flippedTriangles: number;
  gap: Float64Array;
  seamError: Float64Array;
  maxSeamError: number;
}

/**
 * Lay the pieces of a garment over the body and find the patterns that fit the result.
 *
 * `drapeGarment` keeps every edge at the length of the pattern it was given, but those patterns were cut for the
 * membrane drape, not for the shape the cloth ends up in; measured against them there is 1 to 2% left over. The cloth
 * itself is close to developable (flattened, it needs 0.1 to 0.7%), so the honest pair is each piece of cloth and its
 * own flattening, and that is what is returned, with the stretch between them. Later rounds simulate again from the
 * cloth against its new patterns. Panels sewn together agree on the seam, so each one's flattening changes what the
 * other has to fit; it takes about ten rounds for them to settle (on the princess front: centre 0.4% and side 1.4% after
 * 5 rounds, 0.15% and 0.6% after 10 with a weak border pull in the later rounds). Ease is already in the starting patterns, so later
 * flattenings use none.
 */
export function clothPatterns(pieces: readonly ClothPiece[], body: SurfaceField, options: ClothPatternOptions = {}): ClothPatternResult[] {
  const { rounds = 10, touchUp = 60, touchUpBorder = 0.002, ...rest } = options;
  // Every round is drawn toward where the cloth started, not toward the last result.
  const config: GarmentOptions = { iterations: 600, borderWeight: 0.05, edgePasses: 16, targets: garmentPositions(pieces), ...rest };
  const top = buildTopology(pieces, config.bending ?? 0.01, config.seamPull ?? 0); // the same for every round: only the shape and the patterns change
  let cloths = simulate(pieces, top, body, config);
  let patterns = cloths.map((c) => flatten(c.mesh, { ease: uniformEase(0, 0) }));
  for (let round = 1; round < rounds; round++) {
    const current = pieces.map((p, k) => ({ mesh: cloths[k].mesh, flat: patterns[k].uv, vertexMap: p.vertexMap }));
    cloths = simulate(current, top, body, { ...config, iterations: touchUp, borderWeight: touchUpBorder });
    patterns = cloths.map((c) => flatten(c.mesh, { ease: uniformEase(0, 0) }));
  }
  return cloths.map((c, k) => ({ mesh: c.mesh, uv: patterns[k].uv, worstStrain: patterns[k].worstStrain, vertexStrain: patterns[k].vertexStrain, flippedTriangles: patterns[k].flippedTriangles, gap: c.gap, seamError: c.seamError, maxSeamError: c.maxSeamError }));
}

/** One piece laid over the body, with the pattern that fits it: `clothPatterns` with a single piece. */
export function clothPattern(draped: Mesh, flat: ArrayLike<number>, body: SurfaceField, options: ClothPatternOptions = {}): ClothPatternResult {
  return clothPatterns([{ mesh: draped, flat }], body, options)[0];
}
