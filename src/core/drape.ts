import type { CutMesh } from './cut';
import { type Mesh, boundaryLoops, vertexCount, vertexNeighbours, vertexNormals } from './mesh';

/**
 * Draping a panel over the body.
 *
 * A panel cut from the body's skin follows every dip and bump of the skin. Cloth does not: it is held at its seams
 * and pulled taut between them, so it bridges the hollow between the breasts and the small of the back and only
 * touches the body where the body pushes out into it. Here that is an obstacle problem: the panel's boundary stays
 * where the seams are on the body, the inside relaxes toward the smoothest (least area) surface that spans the
 * boundary, and no point may go below the skin. The result is a mesh with the same triangles as the panel, so it
 * can be flattened exactly as before, but over a surface that is much closer to flat.
 *
 * Each interior vertex is only allowed to move along its own skin normal, by a height t >= standoff (t = 0 is
 * resting on the skin). That keeps the vertices spread over the body as they were (a free relaxation slides them
 * off the bumps and into the hollows), and "above the skin" is the same as "outside the body" for a panel that is
 * cut from it. Arms and legs are not considered: a panel is never draped across the gap to a limb it does not cover.
 */
export interface DrapeOptions {
  /** Distance the cloth is kept off the body (cm). Default 0 (touching). */
  standoff?: number;
  /** Most relaxation sweeps. Default 4000. */
  maxSweeps?: number;
  /** Stop when no vertex moves more than this in a sweep (cm). Default 1e-5. */
  tolerance?: number;
  /** Where the boundary vertices go instead of staying on the skin (xyz per vertex of the panel; only boundary entries are read). */
  boundary?: Float64Array;
}

export interface DrapeResult {
  /** The same mesh with the interior vertices moved onto the draped surface. */
  mesh: Mesh;
  /** Per vertex: height of the cloth above the skin (cm); 0 where it rests on the body and on the boundary. */
  gap: Float64Array;
  sweeps: number;
}

/**
 * Relax free vertices along their normals toward the middle of their neighbours, never below `standoff`, by
 * successive over-relaxation. `pos` holds the current positions and is updated in place; the height of each vertex
 * above `rest` along its normal is returned. Shared by the panels (neighbours: all round) and the seams (the two
 * neighbours along the cord).
 */
function relaxAlongNormals(rest: ArrayLike<number>, pos: Float64Array, normals: readonly (readonly number[])[], neighbours: readonly (readonly number[])[], free: readonly number[], standoff: number, maxSweeps: number, tolerance: number): { height: Float64Array; sweeps: number } {
  const height = new Float64Array(pos.length / 3);
  for (const v of free) {
    height[v] = standoff;
    for (let k = 0; k < 3; k++) pos[3 * v + k] = rest[3 * v + k] + normals[v][k] * standoff;
  }
  const omega = 1.8;
  let sweeps = 0;
  for (; sweeps < maxSweeps; sweeps++) {
    let moved = 0;
    for (const v of free) {
      const nb = neighbours[v];
      // Height along the normal of the point the neighbours want this vertex at, never below the skin.
      let want = 0;
      for (const u of nb) for (let k = 0; k < 3; k++) want += ((pos[3 * u + k] - rest[3 * v + k]) * normals[v][k]) / nb.length;
      const next = Math.max(standoff, height[v] + omega * (Math.max(standoff, want) - height[v]));
      moved = Math.max(moved, Math.abs(next - height[v]));
      height[v] = next;
      for (let k = 0; k < 3; k++) pos[3 * v + k] = rest[3 * v + k] + normals[v][k] * next;
    }
    if (moved < tolerance) { sweeps++; break; }
  }
  return { height, sweeps };
}

export function drape(panel: Mesh, options: DrapeOptions = {}): DrapeResult {
  const { standoff = 0, maxSweeps = 4000, tolerance = 1e-5, boundary } = options;
  const n = vertexCount(panel);
  const normals = vertexNormals(panel);
  const pos = Float64Array.from(panel.positions);
  const fixed = new Uint8Array(n);
  for (const loop of boundaryLoops(panel)) for (const v of loop) fixed[v] = 1;
  if (boundary) for (let v = 0; v < n; v++) if (fixed[v]) for (let k = 0; k < 3; k++) pos[3 * v + k] = boundary[3 * v + k];
  const neighbours = vertexNeighbours(panel);
  const free = [...Array(n).keys()].filter((v) => !fixed[v] && neighbours[v].length > 0);
  const { height, sweeps } = relaxAlongNormals(panel.positions, pos, normals, neighbours, free, standoff, maxSweeps, tolerance);
  // The boundary stands off the skin by however far its seams were pulled taut.
  if (boundary) for (let v = 0; v < n; v++) if (fixed[v]) height[v] = Math.max(0, [0, 1, 2].reduce((s, k) => s + (boundary[3 * v + k] - panel.positions[3 * v + k]) * normals[v][k], 0));
  return { mesh: { positions: pos, triangles: panel.triangles }, gap: height, sweeps };
}

/**
 * Pull every seam taut. A seam is a cord held at its control points (and where seams meet) and pulled straight
 * between them, so where the body hollows (between the breasts, down the spine) it stands off the skin instead of
 * following it. Each free vertex on a seam slides along its skin normal to the middle of its two neighbours along
 * the seam, but never below the skin. Both panels that share a seam see the same cord.
 * Returns new positions for the cut mesh (xyz per vertex); only seam vertices change.
 */
export function drapeSeams(cut: CutMesh, options: { standoff?: number; maxSweeps?: number; tolerance?: number } = {}): { positions: Float64Array; gap: Float64Array } {
  const { standoff = 0, maxSweeps = 4000, tolerance = 1e-5 } = options;
  const n = cut.vertexCount;
  const pos = Float64Array.from(cut.mesh.positions);
  const along: number[][] = Array.from({ length: n }, () => []);
  for (const key of cut.seamEdges) {
    const [a, b] = [Math.floor(key / n), key % n];
    along[a].push(b);
    along[b].push(a);
  }
  const free: number[] = [];
  for (let v = 0; v < n; v++) if (along[v].length === 2 && !cut.pins.has(v)) free.push(v);
  const { height } = relaxAlongNormals(cut.mesh.positions, pos, vertexNormals(cut.mesh), along, free, standoff, maxSweeps, tolerance);
  return { positions: pos, gap: height };
}
