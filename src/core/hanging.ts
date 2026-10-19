import { type Mesh, type Vec3, cross, len, sub } from './mesh';

/**
 * A hanging panel: cloth fastened to the body along a seam and falling free below it, like a skirt from a waist seam.
 * It is not cut from the skin, so it has an edge (the hem) that is nowhere near the body.
 *
 * The seam is the top edge and the hem is `length` below it, flared out by `flare` percent: see `buildHanging`.
 */
export interface HangingOptions {
  /** Length from the seam to the hem, straight down (cm). */
  length: number;
  /** How much further out the hem is than the seam, in percent of the seam's distance from the middle line of the body (0 hangs straight, 50 makes the hem half as wide again). */
  flare: number;
  /**
   * A fitted (pencil) skirt instead of a cone: the panel follows the trunk down to its widest row (the hips) with `standoff`
   * of room, then runs from there to the hem, `flare` percent wider (negative: narrower) than at the hips. It is not a cone,
   * so it does not lie flat on its own: the strain shows how much shaping (darts) the pattern needs.
   */
  fitted?: boolean;
  /** Rays below this height are not tested against the body, so a skirt hangs over the feet and does not flare out round the toes. */
  ignoreBelow?: number;
  /** Distance kept between the cloth and the body at the hem (cm); it grows from nothing at the seam. Default 0.3. */
  standoff?: number;
  /** Target spacing of the mesh (cm). Default 1.5. */
  spacing?: number;
}

export interface HangingPanel {
  /** The panel as it hangs: for a fitted panel that is also its pattern; otherwise the cone pushed out of the body where it would pass through. */
  mesh: Mesh;
  /** The same vertices on the pattern's own surface: the cone, which lies flat. The same as `mesh` for a fitted panel. */
  pattern: Mesh;
  /** For a cone: the flare it would take to clear the body without being pushed (0 for a fitted panel). */
  clearFlare: number;
  /** Vertex columns across the panel, and rows down it (row 0 is the seam). */
  columns: number;
  rows: number;
  /** Per vertex: height off the body (cm). */
  gap: Float64Array;
  /** The flare used (as asked for). */
  flare: number;
}

/** `count` points spaced evenly along a polyline (xyz triples), including both ends. */
export function resample(poly: ArrayLike<number>, count: number): Vec3[] {
  const n = poly.length / 3;
  const at = (i: number): Vec3 => [poly[3 * i], poly[3 * i + 1], poly[3 * i + 2]];
  const cumulative = [0];
  for (let i = 1; i < n; i++) cumulative.push(cumulative[i - 1] + len(sub(at(i), at(i - 1))));
  const total = cumulative[n - 1];
  const out: Vec3[] = [];
  let seg = 1;
  for (let k = 0; k < count; k++) {
    const d = (total * k) / (count - 1);
    while (seg < n - 1 && cumulative[seg] < d) seg++;
    const span = cumulative[seg] - cumulative[seg - 1];
    const t = span > 0 ? Math.min(1, Math.max(0, (d - cumulative[seg - 1]) / span)) : 0;
    const [a, b] = [at(seg - 1), at(seg)];
    out.push([0, 1, 2].map((c) => a[c] + t * (b[c] - a[c])) as Vec3);
  }
  return out;
}

export function polylineLengthOf(poly: ArrayLike<number>): number {
  let total = 0;
  for (let i = 3; i < poly.length; i += 3) total += Math.hypot(poly[i] - poly[i - 3], poly[i + 1] - poly[i - 2], poly[i + 2] - poly[i - 1]);
  return total;
}

/**
 * How far out the body reaches along the horizontal ray from `from` in direction (dx, dz) (unit) at height `from[1]`:
 * where the ray leaves the first solid it meets, or undefined if it meets none. From a point inside the trunk that is the
 * skin of the trunk, not an arm hanging beside it; from a point in the gap between the legs it is the far side of the
 * leg, not its inner face.
 */
export function firstHit(m: Mesh, minY: Float64Array, maxY: Float64Array, from: Vec3, dx: number, dz: number): number | undefined {
  const y = from[1];
  const { positions: P, triangles: T } = m;
  const crossings: { along: number; leaving: boolean }[] = [];
  for (let t = 0; t < T.length / 3; t++) {
    if (y < minY[t] || y > maxY[t]) continue;
    // The triangle cut by the plane at height y is a segment; intersect it with the ray in the plane (2D, x and z).
    const pts: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const a = T[3 * t + k];
      const b = T[3 * t + ((k + 1) % 3)];
      const [ya, yb] = [P[3 * a + 1], P[3 * b + 1]];
      if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
      const u = (y - ya) / (yb - ya);
      pts.push([P[3 * a] + u * (P[3 * b] - P[3 * a]), P[3 * a + 2] + u * (P[3 * b + 2] - P[3 * a + 2])]);
    }
    if (pts.length < 2) continue;
    const [p, q] = pts;
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const denom = dx * ez - dz * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const wx = p[0] - from[0];
    const wz = p[1] - from[2];
    const along = (wx * ez - wz * ex) / denom; // distance along the ray
    const across = (wx * dz - wz * dx) / denom; // 0 to 1 along the segment
    if (!(along > 1e-9 && across >= -1e-9 && across <= 1 + 1e-9)) continue;
    // Which way the surface faces there (outward normals): the ray leaves the solid if it goes the way the surface faces.
    const [a, b, c] = [0, 1, 2].map((k) => T[3 * t + k]);
    const n = cross([P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]], [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]]);
    crossings.push({ along, leaving: n[0] * dx + n[2] * dz > 0 });
  }
  crossings.sort((p, q) => p.along - q.along);
  return crossings.find((c) => c.leaving)?.along;
}

/**
 * Builds the hanging panel under a seam path (xyz triples, from the first point to the last). For a closed seam give
 * the path including its return to the start: the panel is cut open there, with the two sides meeting at the first point.
 *
 * Every point of the seam drops straight down by `length` and moves out from the vertical line through the middle of the
 * body by `flare` percent of its distance from it, and the rows between are straight lines, so the panel is a cone (or
 * a cylinder with no flare) and lies flat. A skirt cannot go through the hips: if the cone would, the flare it takes to clear
 * the trunk is added to the flare asked for (see `flare` in the result). Only the trunk counts, not the arms beside it.
 */
export function buildHanging(body: Mesh, path: ArrayLike<number>, options: HangingOptions): HangingPanel {
  const { length, flare } = options;
  const standoff = options.standoff ?? 0.3;
  const spacing = options.spacing ?? 1.5;
  if (!(length > 0)) throw new Error('A hanging panel needs a length above 0');
  if (path.length < 6) throw new Error('A hanging panel needs a seam with at least two points');

  const top = Math.max(1, Math.round(polylineLengthOf(path) / spacing));
  const columns = top + 1;
  const rows = Math.max(2, Math.round(length / spacing) + 1);
  const seam = resample(path, columns);

  // The vertical line the panel flares out from. A closed seam goes right round the body, so its middle is the middle of the
  // body. An open seam is part of the way round (half a skirt, drawn from centre front to centre back): the body is symmetric
  // about x = 0 and the seam's furthest-forward and furthest-back points are the front and back of the body, so the middle is
  // halfway between those.
  const middle: Vec3 = [0, 0, 0];
  const closed = Math.hypot(path[0] - path[path.length - 3], path[1] - path[path.length - 2], path[2] - path[path.length - 1]) < 1e-6;
  if (closed) for (const p of seam) for (const c of [0, 2]) middle[c] += p[c] / columns;
  else middle[2] = (Math.min(...seam.map((p) => p[2])) + Math.max(...seam.map((p) => p[2]))) / 2;

  const index = (i: number, j: number) => i * rows + j;
  const radius = new Float64Array(columns); // distance of each seam point from the middle line
  const direction: [number, number][] = seam.map((p, i) => {
    const [dx, dz] = [p[0] - middle[0], p[2] - middle[2]];
    radius[i] = Math.hypot(dx, dz);
    return radius[i] > 1e-9 ? [dx / radius[i], dz / radius[i]] : [1, 0];
  });
  const clearance = (j: number) => (standoff * j) / (rows - 1); // grows from nothing at the seam, so a skirt over a straight body is a cone

  // How far out the trunk reaches at each row, and so the flare each row needs.
  const triangleCount = body.triangles.length / 3;
  const minY = new Float64Array(triangleCount);
  const maxY = new Float64Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    const ys = [0, 1, 2].map((k) => body.positions[3 * body.triangles[3 * t + k] + 1]);
    minY[t] = Math.min(...ys);
    maxY[t] = Math.max(...ys);
  }
  const reach = new Float64Array(columns * rows).fill(-Infinity); // the trunk's distance from the middle line, where there is one
  let needed = 0; // the flare the cone needs, with none asked for, to clear the body
  for (let i = 0; i < columns; i++) for (let j = 1; j < rows; j++) {
    const t = j / (rows - 1);
    const y = seam[i][1] - t * length;
    if (options.ignoreBelow !== undefined && y < options.ignoreBelow) continue;
    const hit = firstHit(body, minY, maxY, [middle[0], y, middle[2]], direction[i][0], direction[i][1]);
    if (hit === undefined) continue;
    reach[index(i, j)] = hit;
    if (!options.fitted && radius[i] > 1e-9) needed = Math.max(needed, (100 * ((hit + clearance(j)) / radius[i] - 1)) / t);
  }

  const used = flare;
  const pos = new Float64Array(3 * columns * rows);
  const gap = new Float64Array(columns * rows);
  const out = new Float64Array(columns * rows); // distance of each vertex from the middle line
  const cone = new Float64Array(columns * rows); // the same on the pattern's cone
  if (options.fitted) {
    // Follow the trunk to its widest row, then run to the hem.
    let hipRow = 1;
    let widest = -Infinity;
    for (let j = 1; j < rows; j++) {
      let sum = 0;
      for (let i = 0; i < columns; i++) sum += Number.isFinite(reach[index(i, j)]) ? reach[index(i, j)] : 0;
      if (sum > widest + 1e-9) { widest = sum; hipRow = j; }
    }
    for (let i = 0; i < columns; i++) {
      let last = radius[i];
      const follow: number[] = [radius[i]];
      for (let j = 1; j <= hipRow; j++) { last = Number.isFinite(reach[index(i, j)]) ? Math.max(reach[index(i, j)] + standoff, radius[i]) : last; follow.push(last); }
      for (let pass = 0; pass < 3; pass++) for (let j = 1; j < hipRow; j++) follow[j] = Math.max(0.25 * follow[j - 1] + 0.5 * follow[j] + 0.25 * follow[j + 1], Number.isFinite(reach[index(i, j)]) ? reach[index(i, j)] + standoff : 0);
      for (let j = 0; j < rows; j++) {
        const below = rows - 1 > hipRow ? (j - hipRow) / (rows - 1 - hipRow) : 0;
        const r = j <= hipRow ? follow[j] : follow[hipRow] * (1 + (flare / 100) * below);
        out[index(i, j)] = j > hipRow && Number.isFinite(reach[index(i, j)]) ? Math.max(r, reach[index(i, j)] + standoff) : r;
      }
    }
  } else {
    for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) cone[index(i, j)] = radius[i] * (1 + ((j / (rows - 1)) * used) / 100);
    out.set(cone);
    // Where the cone would pass through the body it is pushed out for display. The pattern stays the cone: the cloth simulation
    // (and the strain between the two) shows what it takes to get a cone of this flare over the hips.
    for (let i = 0; i < columns; i++) for (let j = 1; j < rows; j++) if (Number.isFinite(reach[index(i, j)])) out[index(i, j)] = Math.max(cone[index(i, j)], reach[index(i, j)] + (0.05 * j) / (rows - 1));
  }
  const place = (radii: Float64Array) => {
    const p = new Float64Array(3 * columns * rows);
    for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) p.set([middle[0] + direction[i][0] * radii[index(i, j)], seam[i][1] - (j / (rows - 1)) * length, middle[2] + direction[i][1] * radii[index(i, j)]], 3 * index(i, j));
    return p;
  };
  pos.set(place(out));
  for (let v = 0; v < gap.length; v++) gap[v] = Number.isFinite(reach[v]) ? Math.max(0, out[v] - reach[v]) : 0;

  const triangles: number[] = [];
  for (let i = 0; i + 1 < columns; i++) for (let j = 0; j + 1 < rows; j++) {
    const [a, b, c, d] = [index(i, j), index(i + 1, j), index(i + 1, j + 1), index(i, j + 1)];
    triangles.push(a, b, c, a, c, d);
  }
  const tri = Uint32Array.from(triangles);
  return { mesh: { positions: pos, triangles: tri }, pattern: options.fitted ? { positions: pos, triangles: tri } : { positions: place(cone), triangles: tri }, clearFlare: options.fitted ? 0 : needed, columns, rows, gap, flare: used };
}

/** The part of a hanging panel from column `from` to column `to` (inclusive), as a panel of its own. */
export function sliceHanging(h: HangingPanel, from: number, to: number): HangingPanel {
  const { rows } = h;
  const columns = to - from + 1;
  const positions = h.mesh.positions.slice(3 * from * rows, 3 * (to + 1) * rows);
  const patternPositions = h.pattern.positions === h.mesh.positions ? positions : h.pattern.positions.slice(3 * from * rows, 3 * (to + 1) * rows);
  const gap = h.gap.slice(from * rows, (to + 1) * rows);
  const triangles: number[] = [];
  for (let i = 0; i + 1 < columns; i++) for (let j = 0; j + 1 < rows; j++) {
    const [a, b, c, d] = [i * rows + j, (i + 1) * rows + j, (i + 1) * rows + j + 1, i * rows + j + 1];
    triangles.push(a, b, c, a, c, d);
  }
  const tri = Uint32Array.from(triangles);
  return { mesh: { positions, triangles: tri }, pattern: { positions: patternPositions, triangles: tri }, clearFlare: h.clearFlare, columns, rows, gap, flare: h.flare };
}

/** The column of a hanging panel whose seam point is nearest `at`. */
export function nearestColumn(h: HangingPanel, at: Vec3): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < h.columns; i++) {
    const v = i * h.rows;
    const d = Math.hypot(h.mesh.positions[3 * v] - at[0], h.mesh.positions[3 * v + 1] - at[1], h.mesh.positions[3 * v + 2] - at[2]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * How much a mesh would have to stretch or squeeze to lie on a flat pattern of its own triangles: the 98th percentile of
 * |flat length / 3D length - 1| over the edges (very short ones left out), and the mean of that over each vertex's edges.
 */
export function strainBetween(mesh: Mesh, uv: ArrayLike<number>): { worstStrain: number; vertexStrain: Float64Array } {
  const n = mesh.positions.length / 3;
  const sum = new Float64Array(n);
  const degree = new Float64Array(n);
  const all: number[] = [];
  const seen = new Set<number>();
  for (let t = 0; t < mesh.triangles.length / 3; t++) for (let k = 0; k < 3; k++) {
    const [a, b] = [mesh.triangles[3 * t + k], mesh.triangles[3 * t + ((k + 1) % 3)]];
    const key = Math.min(a, b) * n + Math.max(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    const l3 = Math.hypot(mesh.positions[3 * a] - mesh.positions[3 * b], mesh.positions[3 * a + 1] - mesh.positions[3 * b + 1], mesh.positions[3 * a + 2] - mesh.positions[3 * b + 2]);
    const l2 = Math.hypot(uv[2 * a] - uv[2 * b], uv[2 * a + 1] - uv[2 * b + 1]);
    if (l3 < 1e-9) continue;
    const s = l2 / l3 - 1;
    sum[a] += s; sum[b] += s; degree[a]++; degree[b]++;
    if (l3 > 0.05) all.push(Math.abs(s));
  }
  all.sort((p, q) => p - q);
  return { worstStrain: all.length ? all[Math.min(all.length - 1, Math.floor(0.98 * all.length))] : 0, vertexStrain: Float64Array.from(sum, (v, i) => (degree[i] ? v / degree[i] : 0)) };
}
