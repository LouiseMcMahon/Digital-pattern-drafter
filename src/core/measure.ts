import type { BodyModel, BodyShape } from './bodyModel';
import { type Loop, arcBetweenPoints, arcPoints, loopCentroid, loopLength, slicePlane } from './slice';

/**
 * Sewing measurements on the baked body. There is ONE definition of each measurement here and it is
 * used for fitting, for read-back and for tests (REQUIREMENTS.md R1).
 *
 * Every definition is anchored to fixed vertex ids / joints found once on the mean body, so a
 * measurement changes smoothly as the body changes. All values are cm.
 *
 * Definitions (L/R averaged where paired):
 *  height          floor to top of head
 *  neck            ring perpendicular to the neck axis, 25% up from neck base to mid neck
 *  shoulderWidth   straight distance between the two shoulder points (acromion: topmost point 1.5 cm outside the arm joint)
 *  bust            horizontal ring at the bust apex height, torso only (tape passes under the arms)
 *  underbust       horizontal ring 28% of the way down from bust apex to waist
 *  waist           horizontal ring at the natural waist (Anny's waist vertex loop)
 *  highHip         horizontal ring half way between waist and hip
 *  hip             horizontal ring at the fullest hip level of the mean body (tracked on a vertex)
 *  upperArm        ring perpendicular to the arm, 50% from shoulder joint to elbow
 *  elbow           ring at the elbow joint
 *  wrist           ring at the wrist joint
 *  thigh           ring perpendicular to the leg axis, 4 cm below the crotch point (always below the crotch, so it never merges the two legs)
 *  knee            ring at the knee joint
 *  calf            ring 30% from knee to ankle
 *  ankle           ring 88% from knee to ankle
 *  napeToWaist     along the centre back from the nape (C7 level) down to the waist level
 *  frontLength     along the front, in the vertical plane through the bust apex, from shoulder-point level to waist level
 *  bustSeparation  straight distance between the bust apexes
 *  armLength       shoulder point to elbow joint to wrist joint
 *  insideLeg       floor to the crotch point
 *  waistHeight     floor to the natural waist
 *  armscyeDepth    vertical drop from the nape (C7 level) to the underarm (axilla) level, plus CALIBRATION
 *  highBust        horizontal ring at the underarm level, torso only
 *  acrossBack      distance between the two back armhole creases, at the level half way between nape and underarm
 *  acrossChest     distance between the two front armhole creases, at the same level
 *  shoulderLength  along the shoulder, in the vertical plane through the neck-shoulder point and the shoulder point
 *  shoulderToBust  over the front, in the vertical plane through the neck-shoulder point and the bust apex
 *  bustHeight      floor to the bust apex
 *  waistToHip      vertical, natural waist to hip level
 *  crotchDepth     vertical, waist level to the crotch point (standing rise)
 *  crotchLength    along the centre line, front waist level, under the crotch, to back waist level
 *  upperArmLength  shoulder point to elbow joint (straight)
 *  forearmLength   elbow joint to wrist joint (straight)
 *  underarmLength  underarm point to wrist joint (straight)
 *
 * The armhole creases are where the arm's skinning weight (shoulder/upper arm/lower arm/hand bones)
 * crosses CREASE_WEIGHT along the ring, so they vary smoothly with the body.
 */
/**
 * Arm skinning weight that counts as "the armhole crease" when finding across back / across chest.
 * At 0.5 the front width came out ~10 cm narrower than published adult values; 0.8 puts an average
 * woman's across back (~38) and across chest (~32) in the published range. A proxy, to be checked
 * against real tape measurements.
 */
const CREASE_WEIGHT = 0.8;

/**
 * Offsets (cm) added to a raw mesh measurement where the mesh definition is known to sit away from
 * how tailors measure. Estimated from published anthropometric means, NOT from real fittings: replace
 * with data from real people (see PLAN.md). Zero means no known offset.
 *  - armscyeDepth: the mesh underarm (apex of the armpit hollow) is ~4 cm higher than the level a
 *    tailor's ruler reaches, so the raw C7-to-axilla drop reads ~4 cm short of published scye depths.
 */
export const CALIBRATION: Partial<Record<MeasurementName, number>> = { armscyeDepth: 4 };

export const MEASUREMENT_NAMES = [
  'height', 'neck', 'shoulderWidth', 'bust', 'underbust', 'waist', 'highHip', 'hip',
  'upperArm', 'elbow', 'wrist', 'thigh', 'knee', 'calf', 'ankle',
  'napeToWaist', 'frontLength', 'bustSeparation', 'armLength', 'insideLeg', 'waistHeight',
  'armscyeDepth', 'highBust', 'acrossBack', 'acrossChest', 'shoulderLength', 'shoulderToBust', 'bustHeight',
  'waistToHip', 'crotchDepth', 'crotchLength', 'upperArmLength', 'forearmLength', 'underarmLength',
] as const;
export type MeasurementName = (typeof MEASUREMENT_NAMES)[number];
export type Measurements = Record<MeasurementName, number>;

export const MEASUREMENT_LABELS: Record<MeasurementName, string> = {
  height: 'Height', neck: 'Neck', shoulderWidth: 'Shoulder width', bust: 'Bust', underbust: 'Underbust', waist: 'Waist',
  highHip: 'High hip', hip: 'Hip', upperArm: 'Upper arm', elbow: 'Elbow', wrist: 'Wrist', thigh: 'Thigh', knee: 'Knee',
  calf: 'Calf', ankle: 'Ankle', napeToWaist: 'Nape to waist', frontLength: 'Shoulder to waist (front)',
  bustSeparation: 'Bust point separation', armLength: 'Arm length', insideLeg: 'Inside leg', waistHeight: 'Waist height',
  armscyeDepth: 'Armscye depth', highBust: 'High bust', acrossBack: 'Across back', acrossChest: 'Across chest',
  shoulderLength: 'Shoulder length', shoulderToBust: 'Shoulder to bust point', bustHeight: 'Bust point height',
  waistToHip: 'Waist to hip', crotchDepth: 'Crotch depth (rise)', crotchLength: 'Crotch length',
  upperArmLength: 'Shoulder to elbow', forearmLength: 'Elbow to wrist', underarmLength: 'Underarm to wrist',
};

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec): Vec => mul(a, 1 / (norm(a) || 1));
const lerp = (a: Vec, b: Vec, t: number): Vec => add(a, mul(sub(b, a), t));

type Region = 'torso' | 'legs' | 'arms' | 'head';

interface Landmarks {
  bustApex: [number, number]; // L, R vertex ids
  shoulderPoint: [number, number];
  c7: number;
  hip: number;
  crotch: number;
  axilla: [number, number];
  neckPoint: [number, number];
}

export class Measurer {
  private readonly lm: Landmarks;
  private readonly bodyTris: Uint32Array; // torso + legs, no arms/head: closed rings around the trunk
  private readonly region: Uint8Array;
  /** Per-vertex skinning weight of the arm bones (not the clavicle): 0 torso .. 1 arm. */
  private readonly armWeight: Float64Array;
  /** While recording, every measuring ring is stored under the measurement being taken. */
  private record?: { name: string; points: number[] }[];
  private tag = '';
  private marks?: { name: string; point: Vec }[];
  private paths?: { name: string; points: number[] }[];

  constructor(private readonly body: BodyModel) {
    const mean = body.evaluate();
    this.region = new Uint8Array(body.vertexCount);
    const names: Region[] = ['torso', 'legs', 'arms', 'head'];
    const boneRegion = body.boneLabels.map((l): Region => {
      if (/^(root|spine)/.test(l)) return 'torso';
      if (/^(pelvis|upperleg|lowerleg|foot|toe)/.test(l)) return 'legs';
      if (/^(neck|head|eye)/.test(l)) return 'head';
      return 'arms';
    });
    for (let v = 0; v < body.vertexCount; v++) this.region[v] = names.indexOf(boneRegion[body.dominantBone(v)]);
    const keep: number[] = [];
    for (let t = 0; t < body.faces.length / 3; t++) {
      const r = [0, 1, 2].map((k) => this.region[body.faces[3 * t + k]]);
      if (r.every((x) => x === 0 || x === 1)) keep.push(body.faces[3 * t], body.faces[3 * t + 1], body.faces[3 * t + 2]);
    }
    this.bodyTris = Uint32Array.from(keep);
    const armBones = new Set(body.boneLabels.map((l, i) => (/^(shoulder|upperarm|lowerarm|wrist|metacarpal|.*finger|thumb|index|middle|ring|pinky)/.test(l) ? i : -1)).filter((i) => i >= 0));
    this.armWeight = Float64Array.from({ length: body.vertexCount }, (_, v) => body.weightOfBones(v, (b) => armBones.has(b)));
    this.lm = this.detectLandmarks(mean);
  }

  private v(shape: BodyShape, id: number): Vec {
    return [shape.positions[3 * id], shape.positions[3 * id + 1], shape.positions[3 * id + 2]];
  }

  private nearest(shape: BodyShape, target: Vec, filter: (id: number) => boolean = () => true): number {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.body.vertexCount; i++) {
      if (!filter(i)) continue;
      const d = (shape.positions[3 * i] - target[0]) ** 2 + (shape.positions[3 * i + 1] - target[1]) ** 2 + (shape.positions[3 * i + 2] - target[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private detectLandmarks(mean: BodyShape): Landmarks {
    const b = this.body;
    const pos = (id: number) => this.v(mean, id);
    const inRegion = (r: number) => (i: number) => this.region[i] === r;

    // Waist level drives the search windows for the others.
    const waistY = b.waistVertices.reduce((s, id) => s + pos(id)[1], 0) / b.waistVertices.length;

    // Bust apex: front-most torso vertex above the waist on each side.
    const apex = ([1, -1] as const).map((side) => {
      let best = -1;
      let bz = -Infinity;
      for (let i = 0; i < b.vertexCount; i++) {
        if (this.region[i] !== 0) continue;
        const [x, y, z] = pos(i);
        if (side * x < 2 || side * x > 15 || y < waistY + 8 || y > waistY + 32) continue;
        if (z > bz) { bz = z; best = i; }
      }
      return best;
    }) as [number, number];

    // Shoulder point (acromion): topmost vertex 1.5 cm outside the arm joint (the glenohumeral
    // joint sits slightly inside the bony acromion; the deltoid cap bulges well beyond it).
    const shoulderPoint = (['L', 'R'] as const).map((s) => {
      const j = b.joint(mean, `upperarm01.${s}`);
      const cx = j[0] + (s === 'L' ? 1.5 : -1.5);
      let best = -1;
      let by = -Infinity;
      for (let i = 0; i < b.vertexCount; i++) {
        const [x, y, z] = pos(i);
        if (this.region[i] !== 3 && Math.abs(x - cx) < 1.2 && Math.abs(z - j[2]) < 8 && y > j[1] && y < j[1] + 14 && y > by) { by = y; best = i; }
      }
      return best;
    }) as [number, number];

    // Nape (C7): back-most point of the sagittal outline at the neck base.
    const n01 = b.joint(mean, 'neck01');
    const c7 = this.nearest(mean, [0, n01[1] + 0.5, -30], (i) => Math.abs(pos(i)[0]) < 1.2 && Math.abs(pos(i)[1] - (n01[1] + 0.5)) < 1.5);

    // Crotch: highest level at which the trunk splits into two separate leg loops.
    const centralLoops = (y: number) =>
      slicePlane(mean.positions, this.bodyTris, { point: [0, y, 0], normal: [0, 1, 0] }).filter((l) => Math.abs(loopCentroid(l)[0]) < 30);
    let lo = waistY - 40;
    let hi = waistY - 5; // trunk is one loop here
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      if (centralLoops(mid).length >= 2) lo = mid; else hi = mid;
    }
    const crotchY = (lo + hi) / 2;
    const crotch = this.nearest(mean, [0, crotchY, 0], (i) => Math.abs(pos(i)[0]) < 2.5 && this.region[i] === 1);

    // Hip: fullest ring between the crotch and the waist.
    let hipY = crotchY + 3;
    let hp = 0;
    for (let y = crotchY + 3; y < waistY - 5; y += 0.5) {
      const l = this.centralTorsoLoop(mean, y);
      if (l && loopLength(l) > hp) { hp = loopLength(l); hipY = y; }
    }
    const hip = this.nearest(mean, [0, hipY, -30], (i) => Math.abs(pos(i)[0]) < 1.5 && Math.abs(pos(i)[1] - hipY) < 1.5);

    // Underarm (axilla): above this level the arms merge with the trunk. Bisect for that level on the
    // mean body, then take the point where the trunk loop and each arm loop come closest.
    const separate = (y: number) => {
      const loops = slicePlane(mean.positions, b.faces, { point: [0, y, 0], normal: [0, 1, 0] }).filter((l) => l.closed && loopLength(l) > 12);
      return loops.filter((l) => Math.abs(loopCentroid(l)[0]) > 14).length >= 2;
    };
    let aLo = waistY + 8;
    let aHi = b.joint(mean, 'neck01')[1];
    for (let it = 0; it < 18; it++) {
      const mid = (aLo + aHi) / 2;
      if (separate(mid)) aLo = mid; else aHi = mid;
    }
    const yA = aLo - 0.3;
    const loopsA = slicePlane(mean.positions, b.faces, { point: [0, yA, 0], normal: [0, 1, 0] }).filter((l) => l.closed && loopLength(l) > 12);
    const trunk = loopsA.filter((l) => Math.abs(loopCentroid(l)[0]) < 8).sort((p, q) => loopLength(q) - loopLength(p))[0];
    const axilla = ([1, -1] as const).map((side) => {
      const arm = loopsA.filter((l) => side * loopCentroid(l)[0] > 14).sort((p, q) => loopLength(q) - loopLength(p))[0];
      let bd = Infinity;
      let m: Vec = [0, yA, 0];
      for (let i = 0; i < trunk.points.length; i += 3) for (let j = 0; j < arm.points.length; j += 3) {
        const d = Math.hypot(trunk.points[i] - arm.points[j], trunk.points[i + 1] - arm.points[j + 1], trunk.points[i + 2] - arm.points[j + 2]);
        if (d < bd) { bd = d; m = [(trunk.points[i] + arm.points[j]) / 2, (trunk.points[i + 1] + arm.points[j + 1]) / 2, (trunk.points[i + 2] + arm.points[j + 2]) / 2]; }
      }
      return this.nearest(mean, m);
    }) as [number, number];

    // Neck-shoulder point: top of the shoulder just outside the neck.
    const nb0 = b.joint(mean, 'neck01');
    const nk = this.limbLoop(mean, lerp(nb0, b.joint(mean, 'neck03'), 0.25), sub(b.joint(mean, 'neck03'), nb0));
    let neckHalf = 0;
    for (let i = 0; i < (nk?.points.length ?? 0); i += 3) neckHalf = Math.max(neckHalf, Math.abs(nk!.points[i]));
    const neckPoint = ([1, -1] as const).map((side) => {
      let best = -1;
      let by = -Infinity;
      for (let i = 0; i < b.vertexCount; i++) {
        const [x, y, z] = pos(i);
        if (this.region[i] === 3 || Math.abs(z - nb0[2]) > 4 || side * x < neckHalf + 1.5 || side * x > neckHalf + 3) continue;
        if (y > by && y < nb0[1] + 6) { by = y; best = i; }
      }
      return best;
    }) as [number, number];

    return { bustApex: apex, shoulderPoint, c7, hip, crotch, axilla, neckPoint };
  }

  /** Trunk ring at height y: the loop around the body's midline (open chains are closed like a tape would). */
  private centralTorsoLoop(shape: BodyShape, y: number): Loop | undefined {
    const loops = slicePlane(shape.positions, this.bodyTris, { point: [0, y, 0], normal: [0, 1, 0] });
    let best: Loop | undefined;
    let bx = Infinity;
    for (const l of loops) {
      const cx = Math.abs(loopCentroid(l)[0]);
      if (loopLength(l) < 15) continue;
      if (cx < bx) { bx = cx; best = l; }
    }
    if (best) this.record?.push({ name: this.tag, points: best.points });
    return best && { ...best, closed: true };
  }

  /** Ring around a limb: plane perpendicular to the axis, the loop whose centre is nearest the point. */
  private limbLoop(shape: BodyShape, point: Vec, axis: Vec): Loop | undefined {
    const loops = slicePlane(shape.positions, this.body.faces, { point, normal: unit(axis) }).filter((l) => l.closed);
    let best = Infinity;
    let chosen: Loop | undefined;
    for (const l of loops) {
      const d = norm(sub(loopCentroid(l), point));
      if (d < best) { best = d; chosen = l; }
    }
    return chosen;
  }

  private limbRing(shape: BodyShape, point: Vec, axis: Vec): number {
    const chosen = this.limbLoop(shape, point, axis);
    if (chosen) this.record?.push({ name: this.tag, points: chosen.points });
    return chosen ? loopLength(chosen) : NaN;
  }

  /** Arc length over the surface between two points, in the vertical plane through both. */
  private surfaceArc(shape: BodyShape, p: Vec, q: Vec): number {
    const dir = sub(q, p);
    const n = unit([-dir[2], 0, dir[0]]); // normal of the vertical plane containing p and q
    const loops = slicePlane(shape.positions, this.body.faces, { point: p, normal: n });
    const l = loops.sort((a, c) => loopLength(c) - loopLength(a))[0];
    if (l) this.paths?.push({ name: this.tag, points: arcPoints(l, p, q) });
    return l ? arcBetweenPoints(l, p, q) : NaN;
  }

  /** Where the arm's skinning weight crosses 50% along the trunk ring at height y: the armhole creases. */
  private creases(shape: BodyShape, y: number, threshold = CREASE_WEIGHT): { backL: Vec; backR: Vec; frontL: Vec; frontR: Vec } | undefined {
    const loops = slicePlane(shape.positions, this.body.faces, { point: [0, y, 0], normal: [0, 1, 0] }, undefined, this.armWeight).filter((l) => l.closed && l.attr);
    const l = loops.sort((a, c) => loopLength(c) - loopLength(a))[0];
    if (!l) return undefined;
    const n = l.points.length / 3;
    let zc = 0;
    let cnt = 0;
    for (let i = 0; i < n; i++) if (l.attr![i] < 0.5 && Math.abs(l.points[3 * i]) < 14) { zc += l.points[3 * i + 2]; cnt++; }
    zc /= cnt || 1;
    const out: Partial<Record<'backL' | 'backR' | 'frontL' | 'frontR', Vec>> = {};
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [wa, wb] = [l.attr![i], l.attr![j]];
      if ((wa - threshold) * (wb - threshold) >= 0 || wa === wb) continue;
      const t = (threshold - wa) / (wb - wa);
      const pt: Vec = [0, 1, 2].map((k) => l.points[3 * i + k] + t * (l.points[3 * j + k] - l.points[3 * i + k])) as Vec;
      if (Math.abs(pt[0]) > 28 || Math.abs(pt[0]) < 6) continue;
      const key = `${pt[2] < zc ? 'back' : 'front'}${pt[0] > 0 ? 'L' : 'R'}` as 'backL';
      // Several crossings can fall in one slot (noisy weights): keep the innermost, the true crease.
      if (!out[key] || Math.abs(pt[0]) < Math.abs(out[key]![0])) out[key] = pt;
    }
    for (const [k, v] of Object.entries(out)) this.marks?.push({ name: 'crease ' + k, point: v as Vec });
    return out.backL && out.backR && out.frontL && out.frontR ? (out as { backL: Vec; backR: Vec; frontL: Vec; frontR: Vec }) : undefined;
  }

  /** Centre-line outline arc between the front and back crossings of level y: the way round under the crotch. */
  private arcAtWaist(outline: Loop, y: number): number {
    const p = outline.points;
    const n = p.length / 3;
    const total = loopLength({ points: p, closed: true });
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[3 * i] - p[3 * i - 3], p[3 * i + 1] - p[3 * i - 2], p[3 * i + 2] - p[3 * i - 1]));
    let front = NaN, back = NaN, fz = -Infinity, bz = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ya, yb] = [p[3 * i + 1], p[3 * j + 1]];
      if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
      const t = (y - ya) / (yb - ya);
      const z = p[3 * i + 2] + t * (p[3 * j + 2] - p[3 * i + 2]);
      const segLen = j === 0 ? total - cum[n - 1] : cum[j] - cum[i];
      const pos = cum[i] + t * segLen;
      if (z > fz) { fz = z; front = pos; }
      if (z < bz) { bz = z; back = pos; }
    }
    const d = Math.abs(front - back);
    return Math.min(d, total - d);
  }

  /** Arc length along an outline between two horizontal levels, on the front (+z) or back (-z) side. */
  private arcBetweenLevels(shape: BodyShape, planeX: number, y0: number, y1: number, front: boolean): number {
    // Whole mesh: the shoulders belong to the arm region, and the plane passes through torso/neck only.
    const loops = slicePlane(shape.positions, this.body.faces, { point: [planeX, 0, 0], normal: [1, 0, 0] });
    const outline = loops.sort((a, b) => loopLength(b) - loopLength(a))[0];
    const p = outline.points;
    const n = p.length / 3;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[3 * i] - p[3 * i - 3], p[3 * i + 1] - p[3 * i - 2], p[3 * i + 2] - p[3 * i - 1]));
    const total = loopLength({ points: p, closed: true });
    // Position along the outline where it crosses level y on the requested side.
    const cross = (y: number) => {
      let best = NaN;
      let bz = front ? -Infinity : Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [ya, yb] = [p[3 * i + 1], p[3 * j + 1]];
        if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
        const t = (y - ya) / (yb - ya);
        const z = p[3 * i + 2] + t * (p[3 * j + 2] - p[3 * i + 2]);
        if (front ? z > bz : z < bz) {
          bz = z;
          const segLen = j === 0 ? total - cum[n - 1] : cum[j] - cum[i];
          best = cum[i] + t * segLen;
        }
      }
      return best;
    };
    const d = Math.abs(cross(y1) - cross(y0));
    return Math.min(d, total - d);
  }

  /** Landmarks (points) and surface paths used by the measurements, for display. */
  landmarks(shape: BodyShape): { marks: { name: string; point: Vec }[]; paths: { name: string; points: number[] }[] } {
    this.marks = [];
    this.paths = [];
    try {
      this.measure(shape);
      const P = (id: number) => this.v(shape, id);
      const lm = this.lm;
      const add = (name: string, id: number) => this.marks!.push({ name, point: P(id) });
      add('nape C7', lm.c7);
      add('axilla L', lm.axilla[0]); add('axilla R', lm.axilla[1]);
      add('neck point L', lm.neckPoint[0]); add('neck point R', lm.neckPoint[1]);
      add('shoulder point L', lm.shoulderPoint[0]); add('shoulder point R', lm.shoulderPoint[1]);
      add('bust apex L', lm.bustApex[0]); add('bust apex R', lm.bustApex[1]);
      add('crotch', lm.crotch); add('hip level', lm.hip);
      return { marks: this.marks, paths: this.paths };
    } finally {
      this.marks = undefined;
      this.paths = undefined;
    }
  }

  /** The rings (closed polylines, xyz interleaved) each ring-type measurement is taken along, for display. */
  rings(shape: BodyShape): { name: MeasurementName; points: number[] }[] {
    this.record = [];
    try {
      this.measure(shape);
      return this.record as { name: MeasurementName; points: number[] }[];
    } finally {
      this.record = undefined;
    }
  }

  /** Measure all, or only the requested measurements (cheaper while fitting). */
  measure(shape: BodyShape, only?: readonly MeasurementName[]): Measurements {
    const b = this.body;
    const out = {} as Measurements;
    const want = (n: MeasurementName) => { this.tag = n; return !only || only.includes(n); };
    const lm = this.lm;
    const P = (id: number) => this.v(shape, id);
    const J = (name: string) => b.joint(shape, name);
    const waistY = b.waistVertices.reduce((s, id) => s + P(id)[1], 0) / b.waistVertices.length;
    const apexY = (P(lm.bustApex[0])[1] + P(lm.bustApex[1])[1]) / 2;
    const ring = (y: number) => { const l = this.centralTorsoLoop(shape, y); return l ? loopLength(l) : NaN; };
    const avg = (f: (s: 'L' | 'R') => number) => (f('L') + f('R')) / 2;
    const limb = (a: string, c: string, t: number) => (s: 'L' | 'R') => {
      const [ja, jc] = [J(`${a}.${s}`), J(`${c}.${s}`)];
      return this.limbRing(shape, lerp(ja, jc, t), sub(jc, ja));
    };

    let topY = -Infinity;
    for (let i = 1; i < shape.positions.length; i += 3) topY = Math.max(topY, shape.positions[i]);
    out.height = topY;
    const nb = J('neck01');
    const nm = J('neck03');
    if (want('neck')) out.neck = this.limbRing(shape, lerp(nb, nm, 0.25), sub(nm, nb));
    out.shoulderWidth = norm(sub(P(lm.shoulderPoint[0]), P(lm.shoulderPoint[1])));
    if (want('bust')) out.bust = ring(apexY);
    if (want('underbust')) out.underbust = ring(apexY - 0.28 * (apexY - waistY));
    if (want('waist')) out.waist = ring(waistY);
    const hipY = P(lm.hip)[1];
    if (want('highHip')) out.highHip = ring((waistY + hipY) / 2);
    if (want('hip')) out.hip = ring(hipY);
    if (want('upperArm')) out.upperArm = avg(limb('upperarm01', 'lowerarm01', 0.5));
    if (want('elbow')) out.elbow = avg((s) => this.limbRing(shape, J(`lowerarm01.${s}`), sub(J(`lowerarm01.${s}`), J(`upperarm01.${s}`))));
    if (want('wrist')) out.wrist = avg((s) => this.limbRing(shape, J(`wrist.${s}`), sub(J(`wrist.${s}`), J(`lowerarm01.${s}`))));
    if (want('thigh')) out.thigh = avg((s) => {
      const [hipJ, kneeJ] = [J(`upperleg01.${s}`), J(`lowerleg01.${s}`)];
      const t = (hipJ[1] - (P(lm.crotch)[1] - 4)) / (hipJ[1] - kneeJ[1]);
      return this.limbRing(shape, lerp(hipJ, kneeJ, t), sub(kneeJ, hipJ));
    });
    if (want('knee')) out.knee = avg((s) => this.limbRing(shape, J(`lowerleg01.${s}`), sub(J(`lowerleg01.${s}`), J(`upperleg01.${s}`))));
    if (want('calf')) out.calf = avg(limb('lowerleg01', 'foot', 0.3));
    if (want('ankle')) out.ankle = avg(limb('lowerleg01', 'foot', 0.88));
    if (want('napeToWaist')) out.napeToWaist = this.arcBetweenLevels(shape, 0, P(lm.c7)[1], waistY, false);
    const shoulderY = (P(lm.shoulderPoint[0])[1] + P(lm.shoulderPoint[1])[1]) / 2;
    if (want('frontLength')) out.frontLength = avg((s) => this.arcBetweenLevels(shape, P(lm.bustApex[s === 'L' ? 0 : 1])[0], shoulderY, waistY, true));
    out.bustSeparation = norm(sub(P(lm.bustApex[0]), P(lm.bustApex[1])));
    out.armLength = avg((s) => norm(sub(P(lm.shoulderPoint[s === 'L' ? 0 : 1]), J(`lowerarm01.${s}`))) + norm(sub(J(`lowerarm01.${s}`), J(`wrist.${s}`))));
    out.insideLeg = P(lm.crotch)[1];
    out.waistHeight = waistY;

    // --- Armscye, widths, lengths over the surface, rise ---
    const axillaY = (P(lm.axilla[0])[1] + P(lm.axilla[1])[1]) / 2;
    const c7y = P(lm.c7)[1];
    out.armscyeDepth = c7y - axillaY;
    if (want('highBust')) out.highBust = ring(axillaY - 1.5);
    if (want('acrossBack') || want('acrossChest')) {
      const c = this.creases(shape, (c7y + axillaY) / 2);
      out.acrossBack = c ? norm(sub(c.backL, c.backR)) : NaN;
      out.acrossChest = c ? norm(sub(c.frontL, c.frontR)) : NaN;
    }
    if (want('shoulderLength')) out.shoulderLength = avg((s) => this.surfaceArc(shape, P(lm.neckPoint[s === 'L' ? 0 : 1]), P(lm.shoulderPoint[s === 'L' ? 0 : 1])));
    if (want('shoulderToBust')) out.shoulderToBust = avg((s) => this.surfaceArc(shape, P(lm.neckPoint[s === 'L' ? 0 : 1]), P(lm.bustApex[s === 'L' ? 0 : 1])));
    out.bustHeight = apexY;
    out.waistToHip = waistY - hipY;
    out.crotchDepth = waistY - P(lm.crotch)[1];
    if (want('crotchLength')) {
      const loops = slicePlane(shape.positions, this.body.faces, { point: [0, 0, 0], normal: [1, 0, 0] });
      const outline = loops.sort((a, c) => loopLength(c) - loopLength(a))[0];
      out.crotchLength = outline ? this.arcAtWaist(outline, waistY) : NaN;
    }
    out.upperArmLength = avg((s) => norm(sub(P(lm.shoulderPoint[s === 'L' ? 0 : 1]), J(`lowerarm01.${s}`))));
    out.forearmLength = avg((s) => norm(sub(J(`lowerarm01.${s}`), J(`wrist.${s}`))));
    out.underarmLength = avg((s) => norm(sub(P(lm.axilla[s === 'L' ? 0 : 1]), J(`wrist.${s}`))));
    for (const [n, off] of Object.entries(CALIBRATION)) if (out[n as MeasurementName] !== undefined) out[n as MeasurementName] += off;
    return out;
  }
}
