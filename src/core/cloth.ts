import type { SurfaceField } from './bodyField';
import { uniformEase } from './ease';
import { flatten } from './flatten';
import { type Mesh, boundaryLoops, meshEdges, vertexCount } from './mesh';

/**
 * Cloth: a flat pattern piece laid over the body.
 *
 * The piece is a triangle mesh whose edges each keep the length they have on the flat pattern (cloth does not
 * stretch), whose corners may not go inside the body, and whose seam edges are drawn toward where the seams are
 * meant to be on the body. It starts from a rough 3D shape (the membrane drape) and is relaxed by position-based
 * dynamics: each edge is pulled back to its flat length, the border is pulled toward its targets, and anything inside
 * the body is pushed out, over and over until it settles.
 *
 * Where the pattern cannot reach its targets without stretching, the cloth does not stretch: the border ends up short
 * of its target instead, and `seamError` says by how much. `strain` reports any stretch that is left.
 */
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
  /** Where the border vertices are headed (xyz per vertex; only border entries are read). Default: where they start. */
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
  /** Per border vertex, how far it is from its target (cm); 0 elsewhere. */
  seamError: Float64Array;
  maxSeamError: number;
  iterations: number;
}

export function drapeCloth(start: Mesh, flat: ArrayLike<number>, body: SurfaceField, options: ClothOptions = {}): ClothResult {
  const { standoff = 0.05, iterations = 600, tolerance = 1e-4, borderWeight = 0.2, bending = 0.01, gravity = 0, edgePasses = 8 } = options;
  const n = vertexCount(start);
  const pos = Float64Array.from(start.positions);
  const targets = options.targets ?? start.positions;
  const onBorder = new Uint8Array(n);
  for (const loop of boundaryLoops(start)) for (const v of loop) onBorder[v] = 1;

  // Distance constraints: every mesh edge (flat length), and across every pair of triangles sharing an edge (bending).
  const flatLen = (a: number, b: number) => Math.hypot(flat[2 * a] - flat[2 * b], flat[2 * a + 1] - flat[2 * b + 1]);
  const found = meshEdges(start);
  const ea = [...found.a];
  const eb = [...found.b];
  const edgeCount = ea.length;
  const rest = ea.map((a, i) => flatLen(a, eb[i]));
  const weight = ea.map(() => 1);
  if (bending > 0) {
    found.opposite.forEach((o) => {
      if (o.length !== 2 || o[0] === o[1]) return;
      ea.push(o[0]); eb.push(o[1]); rest.push(flatLen(o[0], o[1])); weight.push(bending);
    });
  }
  const m = ea.length;

  const slack = new Float64Array(n); // how far a vertex can still travel before it could touch the body
  const gap = new Float64Array(n);
  const before = new Float64Array(3 * n);
  let done = 0;
  let ease = 1; // how much of the border pull is left
  const decay = Math.pow(0.02, 1 / iterations); // the pull is down to 2% by the last iteration, however many there are
  for (; done < iterations; done++) {
    before.set(pos);
    if (gravity) for (let v = 0; v < n; v++) pos[3 * v + 1] -= gravity;
    for (let pass = 0; pass < edgePasses; pass++) for (let i = 0; i < m; i++) {
      const [a, b] = [ea[i], eb[i]];
      const dx = pos[3 * b] - pos[3 * a];
      const dy = pos[3 * b + 1] - pos[3 * a + 1];
      const dz = pos[3 * b + 2] - pos[3 * a + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-12) continue;
      const f = (weight[i] * 0.5 * (l - rest[i])) / l;
      pos[3 * a] += f * dx; pos[3 * a + 1] += f * dy; pos[3 * a + 2] += f * dz;
      pos[3 * b] -= f * dx; pos[3 * b + 1] -= f * dy; pos[3 * b + 2] -= f * dz;
    }
    // The pull on the border eases off as the run goes on, so what is left at the end is the border as close to its
    // targets as the cloth can get without stretching.
    const pull = borderWeight * ease;
    for (let v = 0; v < n; v++) {
      if (onBorder[v]) for (let k = 0; k < 3; k++) pos[3 * v + k] += pull * (targets[3 * v + k] - pos[3 * v + k]);
    }
    let worst = 0;
    for (let v = 0; v < n; v++) {
      const step = Math.hypot(pos[3 * v] - before[3 * v], pos[3 * v + 1] - before[3 * v + 1], pos[3 * v + 2] - before[3 * v + 2]);
      slack[v] -= step;
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

  // Report.
  const vertexStrain = new Float64Array(n);
  const degree = new Float64Array(n);
  const strains: number[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const [a, b] = [ea[i], eb[i]];
    const l = Math.hypot(pos[3 * b] - pos[3 * a], pos[3 * b + 1] - pos[3 * a + 1], pos[3 * b + 2] - pos[3 * a + 2]);
    if (rest[i] < 1e-6) continue; // a collapsed flat edge has no strain to speak of
    const s = l / rest[i] - 1;
    vertexStrain[a] += s; vertexStrain[b] += s; degree[a]++; degree[b]++;
    if (rest[i] > 0.05) strains.push(Math.abs(s));
  }
  for (let v = 0; v < n; v++) if (degree[v]) vertexStrain[v] /= degree[v];
  strains.sort((a, b) => a - b);
  const worstStrain = strains.length ? strains[Math.min(strains.length - 1, Math.floor(0.98 * strains.length))] : 0;
  const seamError = new Float64Array(n);
  let maxSeamError = 0;
  for (let v = 0; v < n; v++) {
    gap[v] = Math.max(0, body.closest([pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]).signed);
    if (onBorder[v]) { seamError[v] = Math.hypot(pos[3 * v] - targets[3 * v], pos[3 * v + 1] - targets[3 * v + 1], pos[3 * v + 2] - targets[3 * v + 2]); maxSeamError = Math.max(maxSeamError, seamError[v]); }
  }
  return { mesh: { positions: pos, triangles: start.triangles }, gap, vertexStrain, worstStrain, seamError, maxSeamError, iterations: done };
}

export interface ClothPatternOptions extends ClothOptions {
  /** Simulate-then-reflatten rounds: the first is a full run, each later one a short touch-up. Default 2. */
  rounds?: number;
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
 * Lay a pattern over the body and find the pattern that fits the result.
 *
 * `drapeCloth` keeps every edge at the length of the pattern it was given, but that pattern was cut for the membrane
 * drape, not for the shape the cloth ends up in; measured against it there is 1 to 2% left over. The cloth itself is
 * close to developable (flattened, it needs 0.1 to 0.7%), so the honest pair is the cloth and its own flattening,
 * and that is what is returned, with the stretch between them. Later rounds simulate again from the cloth against its
 * new pattern, which tightens it a little more. Ease is already in the starting pattern, so later flattenings use none.
 */
export function clothPattern(draped: Mesh, flat: ArrayLike<number>, body: SurfaceField, options: ClothPatternOptions = {}): ClothPatternResult {
  const { rounds = 2, ...rest } = options;
  const config: ClothOptions = { iterations: 1500, borderWeight: 0.05, edgePasses: 16, targets: draped.positions, ...rest };
  let cloth = drapeCloth(draped, flat, body, config);
  let pattern = flatten(cloth.mesh, { ease: uniformEase(0, 0) });
  for (let round = 1; round < rounds; round++) {
    cloth = drapeCloth(cloth.mesh, pattern.uv, body, { ...config, iterations: Math.round((config.iterations ?? 1500) / 4) });
    pattern = flatten(cloth.mesh, { ease: uniformEase(0, 0) });
  }
  return { mesh: cloth.mesh, uv: pattern.uv, worstStrain: pattern.worstStrain, vertexStrain: pattern.vertexStrain, flippedTriangles: pattern.flippedTriangles, gap: cloth.gap, seamError: cloth.seamError, maxSeamError: cloth.maxSeamError };
}
