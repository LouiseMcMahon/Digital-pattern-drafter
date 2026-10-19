import { buildHanging, nearestColumn, sliceHanging } from './hanging';
import { type PanelEdge, area, cutMesh, locateInCut, panelEdges, regionFrom } from './cut';
import type { PanelSeed } from './design';
import { drape, drapeSeams } from './drape';
import { uniformEase } from './ease';
import { flatten } from './flatten';
import { type Mesh, boundaryLoops, extractSubmesh, getVertex, len, sub } from './mesh';
import { type Seam, SurfaceGraph, pointOnSurface } from './seam';

/** How far above the floor a hem to the floor stops (cm), and the height of the foot, whose toes a skirt hangs over (cm). */
const FLOOR_GAP = 0.3;
const FOOT_HEIGHT = 12;

/** A region bigger than this share of the body is not enclosed by the seams. */
export const MAX_PANEL_SHARE = 0.6;

/** A side of a panel with its flat length next to its length on the body. */
export interface FlatEdge extends PanelEdge {
  /** For the sides of a hanging panel that are not on a seam: what they are ("Hem", "Side seam"). */
  name?: string;
  /** Length of the same run in the flat piece (cm). */
  flatLength: number;
}

export interface PanelFailure { error: string; size: number; triangles: number[] }
export interface PanelFlat {
  error?: undefined;
  /** Set for a panel that hangs free from a seam: it is not part of the body's cut mesh, so it is not sewn to other panels by shared vertices. */
  hanging?: true;
  /** For a hanging panel: the number of each vertex in the whole skirt it was cut from (so halves agree along the side seams they share), and how many vertices the whole skirt has. */
  sewIds?: number[];
  sewSize?: number;
  /** For a hanging panel: the length it hangs, which is worked out when the hem goes to the floor. */
  hangLength?: number;
  /** For a hanging panel: the flare used, which is more than asked for where the panel would otherwise pass through the body. */
  flareUsed?: number;
  size: number;
  /** Triangles of the cut mesh in this panel. */
  triangles: number[];
  /** The panel as its own mesh, and for each of its vertices the vertex of the cut mesh it came from. */
  sub: { mesh: Mesh; vertexMap: number[] };
  /** The panel as cloth would hang: seams pulled taut and hollows bridged (the same as `sub.mesh` when draping is off). It is what `flat` was made from. */
  draped: Mesh;
  /** Per vertex: how far the draped cloth stands off the skin (cm). */
  gap: Float64Array;
  /** Boundary vertices of `sub.mesh`, in order. */
  loop: number[];
  edges: FlatEdge[];
  flat: { uv: Float64Array; worstStrain: number; vertexStrain: Float64Array; flippedTriangles: number; rmsEdgeError: number };
}
export type PanelResult = PanelFailure | PanelFlat;

export interface PanelsResult {
  /** The body cut along the seams; panel triangles index into it. */
  cut: Mesh;
  /** Positions of the cut mesh with the seams pulled taut between their control points (the cut mesh's own positions when draping is off). */
  taut: Float64Array;
  panels: PanelResult[];
}

/**
 * Cuts the body along the seams and flattens every panel with its own ease. Plain data in, plain data out (typed
 * arrays and objects, no classes), so it runs in a worker. One bad panel is reported on its own and does not stop the others.
 */
export function computePanels(original: Mesh, graph: SurfaceGraph, seams: readonly Seam[], panels: readonly PanelSeed[], drapeOn = false): PanelsResult {
  const cut = cutMesh(original, graph, seams);
  const taut = drapeOn ? drapeSeams(cut).positions : cut.mesh.positions;
  const everything = area(cut.mesh, Array.from({ length: cut.mesh.triangles.length / 3 }, (_, i) => i));
  const results = panels.map((panel): PanelResult => {
    if (panel.hang) return hangingPanel(panel);
    const triangles = regionFrom(cut, locateInCut(cut, original, panel.seed));
    const size = area(cut.mesh, triangles);
    if (size > MAX_PANEL_SHARE * everything) return { error: 'The seams do not enclose this area (add seams until it is closed in).', size, triangles };
    const sub = extractSubmesh(cut.mesh, triangles);
    const loops = boundaryLoops(sub.mesh);
    if (loops.length !== 1) return { error: `This area has ${loops.length} edges, so it cannot lie flat. A panel that goes right round a limb needs a seam along it.`, size, triangles };
    const edges = panelEdges(cut, triangles)!; // defined: the panel has exactly one boundary loop, checked above
    try {
      const boundary = new Float64Array(3 * sub.vertexMap.length);
      sub.vertexMap.forEach((v, i) => boundary.set(taut.slice(3 * v, 3 * v + 3), 3 * i));
      const draped = drapeOn ? drape(sub.mesh, { boundary }) : { mesh: sub.mesh, gap: new Float64Array(sub.vertexMap.length) };
      const flat = flatten(draped.mesh, { ease: uniformEase(panel.horizontal, panel.vertical) });
      const subOf = new Map(sub.vertexMap.map((cutVertex, subVertex) => [cutVertex, subVertex]));
      const flatLength = (vs: number[]) => vs.slice(1).reduce((sum, v, k) => {
        const [a, b] = [subOf.get(vs[k])!, subOf.get(v)!];
        return sum + Math.hypot(flat.uv[2 * a] - flat.uv[2 * b], flat.uv[2 * a + 1] - flat.uv[2 * b + 1]);
      }, 0);
      return {
        size, triangles, sub: { mesh: sub.mesh, vertexMap: sub.vertexMap }, draped: draped.mesh, gap: draped.gap, loop: loops[0],
        edges: edges.map((e) => ({ ...e, flatLength: flatLength(e.vertices) })),
        flat: { uv: flat.uv, worstStrain: flat.worstStrain, vertexStrain: flat.vertexStrain, flippedTriangles: flat.flippedTriangles, rmsEdgeError: flat.rmsEdgeError },
      };
    } catch (err) {
      return { error: `This piece could not be flattened (${err instanceof Error ? err.message : 'unknown error'}). Check its seams and make the panel again.`, size, triangles };
    }
  });
  return { cut: cut.mesh, taut, panels: results };

  function hangingPanel(panel: PanelSeed): PanelResult {
    const hang = panel.hang!;
    const seam = seams[hang.seam];
    if (!seam || seam.points.length < 2) return { error: 'The seam this panel hangs from is gone or has fewer than 2 points.', size: 0, triangles: [] };
    try {
      let path = Array.from(graph.seamPath(original.positions, seam));
      const closed = seam.closed && seam.points.length > 2;
      if (closed) path = cutAt(path, pointOnSurface(original, panel.seed)); // the seed is where the side seam goes
      let floorY = Infinity;
      for (let i = 1; i < original.positions.length; i += 3) floorY = Math.min(floorY, original.positions[i]);
      let seamY = 0;
      for (let i = 1; i < path.length; i += 3) seamY += path[i] / (path.length / 3);
      const hangLength = hang.toFloor ? seamY - floorY - FLOOR_GAP : hang.length;
      if (!(hangLength > 0)) return { error: 'The seam is at or below the floor: there is no skirt to hang.', size: 0, triangles: [] };
      let built = buildHanging(original, path, { length: hangLength, flare: hang.flare, fitted: hang.fitted, ignoreBelow: floorY + FOOT_HEIGHT });
      const wholeColumns = built.columns;
      let firstColumn = 0;
      // Half of a skirt: the whole is built (so both halves agree on flare and shape), then cut at the side seam and the opposite one.
      let [startName, endName] = closed ? ['Side seam', 'Side seam'] : ['Side edge', 'Side edge'];
      if (closed && hang.half !== undefined) {
        const side = pointOnSurface(original, panel.seed);
        let opposite = nearestColumn(built, [-side[0], side[1], side[2]]);
        if (opposite < 2 || opposite > built.columns - 3) opposite = Math.round((built.columns - 1) / 2); // the side seam is on the centre line: split in half
        firstColumn = hang.half === 0 ? 0 : opposite;
        built = hang.half === 0 ? sliceHanging(built, 0, opposite) : sliceHanging(built, opposite, wholeColumns - 1);
        [startName, endName] = hang.half === 0 ? ['Side seam 1', 'Side seam 2'] : ['Side seam 2', 'Side seam 1'];
      }
      const loops = boundaryLoops(built.mesh);
      if (loops.length !== 1) return { error: 'This hanging panel is not a single piece.', size: 0, triangles: [] };
      const flat = flatten(built.mesh, { ease: uniformEase(panel.horizontal, panel.vertical) });
      const { columns, rows } = built;
      const column = (i: number, from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, k) => i * rows + (from <= to ? from + k : from - k));
      const row = (j: number) => Array.from({ length: columns }, (_, i) => i * rows + j);
      const length = (vs: number[]) => vs.slice(1).reduce((s, v, k) => s + len(sub(getVertex(built.mesh, v), getVertex(built.mesh, vs[k]))), 0);
      // Sides in order round the outline: the seam, the far side, the hem (drawn back to the start), the near side.
      const sides: { seam: number | undefined; name?: string; vertices: number[] }[] = [
        { seam: hang.seam, vertices: row(0) },
        { seam: undefined, name: endName, vertices: column(columns - 1, 0, rows - 1) },
        { seam: undefined, name: 'Hem seam', vertices: row(rows - 1).reverse() },
        { seam: undefined, name: startName, vertices: column(0, rows - 1, 0) },
      ];
      const triangles = Array.from({ length: built.mesh.triangles.length / 3 }, (_, i) => i);
      return {
        hanging: true, flareUsed: built.flare, hangLength,
        // The last column of a closed seam is the first again: the same place on the whole skirt, so the same vertices where the sides are sewn.
        sewIds: Array.from({ length: built.mesh.positions.length / 3 }, (_, v) => { const column = firstColumn + Math.floor(v / built.rows); return (closed && column === wholeColumns - 1 ? 0 : column) * built.rows + (v % built.rows); }),
        sewSize: wholeColumns * built.rows, size: area(built.mesh, triangles), triangles,
        sub: { mesh: built.mesh, vertexMap: Array.from({ length: built.mesh.positions.length / 3 }, (_, i) => i) },
        draped: built.mesh, gap: built.gap, loop: loops[0],
        edges: sides.map((e) => ({ ...e, length: length(e.vertices), flatLength: flatLengthOf(flat.uv, e.vertices) })),
        flat: { uv: flat.uv, worstStrain: flat.worstStrain, vertexStrain: flat.vertexStrain, flippedTriangles: flat.flippedTriangles, rmsEdgeError: flat.rmsEdgeError },
      };
    } catch (err) {
      return { error: `This hanging panel could not be made (${err instanceof Error ? err.message : 'unknown error'}).`, size: 0, triangles: [] };
    }
  }
}

/** A closed path (xyz triples, last point = first) turned so it starts and ends at the path point nearest `at`. */
export function cutAt(path: number[], at: [number, number, number]): number[] {
  const n = path.length / 3 - 1; // distinct points
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(path[3 * i] - at[0], path[3 * i + 1] - at[1], path[3 * i + 2] - at[2]);
    if (d < bd) { bd = d; best = i; }
  }
  const out: number[] = [];
  for (let k = 0; k <= n; k++) out.push(...path.slice(3 * ((best + k) % n), 3 * ((best + k) % n) + 3));
  return out;
}

const flatLengthOf = (uv: Float64Array, vs: number[]) => vs.slice(1).reduce((s, v, k) => s + Math.hypot(uv[2 * v] - uv[2 * vs[k]], uv[2 * v + 1] - uv[2 * vs[k] + 1]), 0);
