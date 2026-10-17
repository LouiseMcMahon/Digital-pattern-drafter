import type { Mesh } from './mesh';
import { type PoseName, TAILOR_POSE, TailorPoseRig } from './pose';

/** Manifest written by tools/bake_body/bake_body.py. */
export interface BodyManifest {
  units: 'cm';
  vertexCount: number;
  jointCount: number;
  faceCount: number;
  components: number;
  boneLabels: string[];
  boneParents: number[];
  localChanges: { label: string; n: number; scale: number }[];
  waistVertices: number[];
  presets: Record<string, number[]>;
  skinInfluences: number;
  blocks: Record<string, { offset: number; bytes: number; dtype: string; shape: number[] }>;
}

/**
 * Shape parameters. `z` are PCA coefficients in units of standard deviations
 * (missing = 0, the mean body); `local` are Anny's linear local controls, in
 * [-1, 1] but happily extrapolated (they are exactly linear).
 */
export interface BodyParams {
  z?: ArrayLike<number>;
  local?: Record<string, number>;
}

export interface BodyShape {
  /** Vertex positions, xyz interleaved, cm; y up, z front, x = wearer's left. */
  positions: Float64Array;
  /** Joint (bone head) positions, xyz interleaved. */
  joints: Float64Array;
}

export class BodyModel {
  readonly vertexCount: number;
  readonly jointCount: number;
  readonly components: number;
  readonly faces: Uint32Array;
  readonly boneLabels: string[];
  readonly boneParents: number[];
  readonly localLabels: string[];
  readonly waistVertices: number[];
  /** PCA coefficients (std units) of typical bodies: 'female', 'male', 'neutral'. */
  readonly presets: Record<string, number[]>;

  private readonly mean: Float32Array;
  private readonly pca: Int16Array;
  private readonly pcaScale: Float32Array;
  private readonly pcaStd: Float32Array;
  private readonly lc = new Map<string, { idx: Uint16Array; d: Int16Array; scale: number }>();
  private readonly skinIdx: Uint8Array;
  private readonly skinW: Uint8Array;
  readonly skinInfluences: number;

  constructor(manifest: BodyManifest, bin: ArrayBuffer) {
    const block = <T extends ArrayBufferView>(name: string, ctor: new (b: ArrayBuffer, o: number, n: number) => T, size: number) => {
      const b = manifest.blocks[name];
      // Copy so the typed array is aligned regardless of the block's byte offset.
      const copy = bin.slice(b.offset, b.offset + b.bytes);
      return new ctor(copy, 0, b.bytes / size);
    };
    this.vertexCount = manifest.vertexCount;
    this.jointCount = manifest.jointCount;
    this.components = manifest.components;
    this.boneLabels = manifest.boneLabels;
    this.boneParents = manifest.boneParents;
    this.waistVertices = manifest.waistVertices;
    this.presets = manifest.presets;
    this.mean = block('mean', Float32Array, 4);
    this.pca = block('pca', Int16Array, 2);
    this.pcaScale = block('pcaScale', Float32Array, 4);
    this.pcaStd = block('pcaStd', Float32Array, 4);
    this.faces = Uint32Array.from(block('faces', Uint16Array, 2));
    this.skinIdx = block('skinIdx', Uint8Array, 1);
    this.skinW = block('skinW', Uint8Array, 1);
    this.skinInfluences = this.skinIdx.length / this.vertexCount;
    for (const l of manifest.localChanges) {
      this.lc.set(l.label, { idx: block(`lc.idx.${l.label}`, Uint16Array, 2), d: block(`lc.d.${l.label}`, Int16Array, 2), scale: l.scale });
    }
    this.localLabels = manifest.localChanges.map((l) => l.label);
  }

  /** Standard deviation of each PCA coefficient across the sampled adult population. */
  coefficientStd(k: number): number {
    return this.pcaStd[k];
  }

  private readonly poseRigs = new Map<number, TailorPoseRig>();

  /**
   * Evaluate a body. By default it stands in the standard tailor pose (REQUIREMENTS.md R5) with the soles
   * on y = 0. Pass `pose: 'rest'` for the model's native rest pose.
   */
  evaluate(params: BodyParams = {}, opts: { grounded?: boolean; pose?: PoseName; /** tests only */ armDegrees?: number } = {}): BodyShape {
    const grounded = opts.grounded ?? true;
    const pose = opts.pose ?? 'tailor';
    const D = (this.vertexCount + this.jointCount) * 3;
    const out = new Float64Array(D);
    for (let i = 0; i < D; i++) out[i] = this.mean[i];
    const z = params.z;
    if (z) {
      for (let k = 0; k < Math.min(z.length, this.components); k++) {
        if (!z[k]) continue;
        const w = z[k] * this.pcaStd[k] * this.pcaScale[k];
        const base = k * D;
        for (let i = 0; i < D; i++) out[i] += w * this.pca[base + i];
      }
    }
    if (params.local) {
      for (const [label, v] of Object.entries(params.local)) {
        if (!v) continue;
        const e = this.lc.get(label);
        if (!e) throw new Error(`Unknown local control: ${label}`);
        const w = v * e.scale;
        for (let q = 0; q < e.idx.length; q++) {
          const i = 3 * e.idx[q];
          out[i] += w * e.d[3 * q];
          out[i + 1] += w * e.d[3 * q + 1];
          out[i + 2] += w * e.d[3 * q + 2];
        }
      }
    }
    const nV3 = this.vertexCount * 3;
    let shape: BodyShape = { positions: out.slice(0, nV3), joints: out.slice(nV3) };
    if (pose === 'tailor') {
      const deg = opts.armDegrees ?? TAILOR_POSE.armDegreesFromVertical;
      let rig = this.poseRigs.get(deg);
      if (!rig) this.poseRigs.set(deg, (rig = new TailorPoseRig(this, deg)));
      shape = rig.apply(shape);
    }
    if (grounded) {
      let minY = Infinity;
      for (let i = 1; i < nV3; i += 3) minY = Math.min(minY, shape.positions[i]);
      for (let i = 1; i < nV3; i += 3) shape.positions[i] -= minY;
      for (let i = 1; i < shape.joints.length; i += 3) shape.joints[i] -= minY;
    }
    return shape;
  }

  mesh(shape: BodyShape): Mesh {
    return { positions: shape.positions, triangles: this.faces };
  }

  joint(shape: BodyShape, label: string): [number, number, number] {
    const j = this.boneLabels.indexOf(label);
    if (j < 0) throw new Error(`Unknown bone: ${label}`);
    return [shape.joints[3 * j], shape.joints[3 * j + 1], shape.joints[3 * j + 2]];
  }

  /** Sum of a vertex's skinning weights over the bones accepted by `pick` (0..1). */
  weightOfBones(v: number, pick: (boneIndex: number) => boolean): number {
    let sum = 0;
    let total = 0;
    for (let s = 0; s < this.skinInfluences; s++) {
      const w = this.skinW[v * this.skinInfluences + s];
      total += w;
      if (pick(this.skinIdx[v * this.skinInfluences + s])) sum += w;
    }
    return total ? sum / total : 0;
  }

  /** Dominant bone of a vertex (for labelling body regions). */
  dominantBone(v: number): number {
    let best = 0;
    let bw = -1;
    for (let s = 0; s < this.skinInfluences; s++) {
      const w = this.skinW[v * this.skinInfluences + s];
      if (w > bw) { bw = w; best = this.skinIdx[v * this.skinInfluences + s]; }
    }
    return best;
  }
}

/** Browser helper: fetch the baked body. */
export async function loadBodyFromUrl(base = '/body'): Promise<BodyModel> {
  const [manifest, bin] = await Promise.all([fetch(`${base}/body.json`).then((r) => r.json()), fetch(`${base}/body.bin`).then((r) => r.arrayBuffer())]);
  return new BodyModel(manifest, bin);
}
