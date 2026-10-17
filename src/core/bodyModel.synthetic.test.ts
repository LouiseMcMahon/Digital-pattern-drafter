import { afterEach, describe, expect, it, vi } from 'vitest';
import { type BodyManifest, BodyModel, loadBodyFromUrl } from './bodyModel';

/**
 * UNIT TESTS ON A TINY SYNTHETIC MODEL (from the mutation report: bodyModel.ts scored 50% against the
 * tests that only look at the real body). 3 vertices, 2 joints, 2 shape components, 2 local controls and
 * 2 skinning influences per vertex, small enough that every expected number is worked out by hand.
 *
 *   combined index:  0 v0 (0,10,0)   1 v1 (1,12,0)   2 v2 (2,11,5)   3 j0 (0,5,0)   4 j1 (3,6,0)
 */
const MEAN = [0, 10, 0, 1, 12, 0, 2, 11, 5, 0, 5, 0, 3, 6, 0];
const PCA_SCALE = [0.01, 0.02];
const PCA_STD = [2, 3];
// Component 0 moves v0 by +x and j1 by +y; component 1 moves v1 by +y and v2 by +z (int16 values times the scale).
const PCA0 = [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 300, 0];
const PCA1 = [0, 0, 0, 0, 200, 0, 0, 0, 500, 0, 0, 0, 0, 0, 0];
const LC_A = { label: 'a', scale: 0.5, idx: [1, 3], d: [2, 0, 0, 0, 4, 0] }; // v1 += (1,0,0)*v, j0 += (0,2,0)*v
const LC_B = { label: 'b', scale: 0.1, idx: [2], d: [0, 0, 10] }; // v2 += (0,0,1)*v
const SKIN_IDX = [0, 1, 1, 0, 0, 1];
const SKIN_W = [200, 55, 255, 0, 128, 127];

function build(): { manifest: BodyManifest; bin: ArrayBuffer } {
  const blocks: BodyManifest['blocks'] = {};
  const parts: Uint8Array[] = [];
  let offset = 0;
  const add = (name: string, arr: ArrayBufferView & { length: number }, dtype: string) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    blocks[name] = { offset, bytes: bytes.length, dtype, shape: [arr.length] };
    parts.push(bytes);
    offset += bytes.length;
  };
  add('mean', Float32Array.from(MEAN), 'float32');
  add('pca', Int16Array.from([...PCA0, ...PCA1]), 'int16');
  add('pcaScale', Float32Array.from(PCA_SCALE), 'float32');
  add('pcaStd', Float32Array.from(PCA_STD), 'float32');
  add('faces', Uint16Array.from([0, 1, 2]), 'uint16');
  add('skinIdx', Uint8Array.from(SKIN_IDX), 'uint8');
  add('skinW', Uint8Array.from(SKIN_W), 'uint8');
  for (const lc of [LC_A, LC_B]) {
    add(`lc.idx.${lc.label}`, Uint16Array.from(lc.idx), 'uint16');
    add(`lc.d.${lc.label}`, Int16Array.from(lc.d), 'int16');
  }
  const bin = new Uint8Array(offset);
  let o = 0;
  for (const p of parts) { bin.set(p, o); o += p.length; }
  const manifest: BodyManifest = {
    units: 'cm', vertexCount: 3, jointCount: 2, faceCount: 1, components: 2,
    boneLabels: ['b0', 'b1'], boneParents: [-1, 0],
    localChanges: [LC_A, LC_B].map((l) => ({ label: l.label, n: l.idx.length, scale: l.scale })),
    waistVertices: [0, 1], presets: { female: [1, 0], male: [0, 1], neutral: [0, 0] },
    skinInfluences: 2, blocks,
  };
  return { manifest, bin: bin.buffer };
}

const { manifest, bin } = build();
const model = new BodyModel(manifest, bin);
const rest = { pose: 'rest' as const };
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-5) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i]), `index ${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(tol);
};
/** The expected grounded shape: subtract the lowest vertex y from every y (vertices and joints). */
const grounded = (combined: number[]) => {
  const out = combined.slice();
  const minY = Math.min(out[1], out[4], out[7]);
  for (let i = 1; i < out.length; i += 3) out[i] -= minY;
  return out;
};
const flat = (s: { positions: Float64Array; joints: Float64Array }) => [...s.positions, ...s.joints];

describe('BodyModel from a synthetic manifest', () => {
  it('reads the sizes, labels, presets and faces', () => {
    expect(model.vertexCount).toBe(3);
    expect(model.jointCount).toBe(2);
    expect(model.components).toBe(2);
    expect(model.boneLabels).toEqual(['b0', 'b1']);
    expect(model.boneParents).toEqual([-1, 0]);
    expect(model.localLabels).toEqual(['a', 'b']);
    expect(model.waistVertices).toEqual([0, 1]);
    expect(model.presets.female).toEqual([1, 0]);
    expect(model.skinInfluences).toBe(2);
    expect(Array.from(model.faces)).toEqual([0, 1, 2]);
    expect(model.faces).toBeInstanceOf(Uint32Array);
  });

  it('coefficientStd is the stored standard deviation of each component', () => {
    expect(model.coefficientStd(0)).toBe(2);
    expect(model.coefficientStd(1)).toBe(3);
  });

  describe('evaluate (rest pose, ungrounded unless said)', () => {
    it('with no parameters returns the mean shape', () => {
      const s = model.evaluate({}, { ...rest, grounded: false });
      near(flat(s), MEAN);
      expect(s.positions).toHaveLength(9);
      expect(s.joints).toHaveLength(6);
    });

    it('adds each component as z * std * scale * int16 value', () => {
      const s = model.evaluate({ z: [2, 0] }, { ...rest, grounded: false });
      const expected = MEAN.slice();
      expected[0] += 2 * 2 * 0.01 * 100; // v0.x
      expected[13] += 2 * 2 * 0.01 * 300; // j1.y
      near(flat(s), expected);
      const t = model.evaluate({ z: [0, -1.5] }, { ...rest, grounded: false });
      const e2 = MEAN.slice();
      e2[4] += -1.5 * 3 * 0.02 * 200; // v1.y
      e2[8] += -1.5 * 3 * 0.02 * 500; // v2.z
      near(flat(t), e2);
    });

    it('adds the components together', () => {
      const s = model.evaluate({ z: [1, 1] }, { ...rest, grounded: false });
      const e = MEAN.slice();
      e[0] += 2 * 0.01 * 100; e[13] += 2 * 0.01 * 300; e[4] += 3 * 0.02 * 200; e[8] += 3 * 0.02 * 500;
      near(flat(s), e);
    });

    it('accepts fewer coefficients than components (the rest are zero) and ignores extra ones', () => {
      near(flat(model.evaluate({ z: [1] }, { ...rest, grounded: false })), flat(model.evaluate({ z: [1, 0] }, { ...rest, grounded: false })));
      near(flat(model.evaluate({ z: [1, 0, 99, 99] }, { ...rest, grounded: false })), flat(model.evaluate({ z: [1, 0] }, { ...rest, grounded: false })));
    });

    it('a zero coefficient changes nothing and a coefficient of exactly 1 is applied in full', () => {
      near(flat(model.evaluate({ z: [0, 0] }, { ...rest, grounded: false })), MEAN);
      const s = model.evaluate({ z: [0, 1] }, { ...rest, grounded: false });
      expect(s.positions[4] - MEAN[4]).toBeCloseTo(3 * 0.02 * 200, 5);
    });

    it('applies a local control as value * scale * int16 delta, at the indices it names (vertices and joints)', () => {
      const s = model.evaluate({ local: { a: 2 } }, { ...rest, grounded: false });
      const e = MEAN.slice();
      e[3] += 2 * 0.5 * 2; // combined 1 = v1, x
      e[10] += 2 * 0.5 * 4; // combined 3 = j0, y
      near(flat(s), e);
      const t = model.evaluate({ local: { b: -3 } }, { ...rest, grounded: false });
      const e2 = MEAN.slice();
      e2[8] += -3 * 0.1 * 10; // v2.z
      near(flat(t), e2);
    });

    it('local controls are linear, add together, and extrapolate beyond 1', () => {
      const one = model.evaluate({ local: { a: 1 } }, { ...rest, grounded: false });
      const four = model.evaluate({ local: { a: 4 } }, { ...rest, grounded: false });
      for (let i = 0; i < MEAN.length; i++) expect(flat(four)[i] - MEAN[i]).toBeCloseTo(4 * (flat(one)[i] - MEAN[i]), 5);
      const both = model.evaluate({ local: { a: 1, b: 1 } }, { ...rest, grounded: false });
      const e = flat(one); e[8] += 0.1 * 10;
      near(flat(both), e);
    });

    it('a control set to zero is skipped, an unknown control throws with its name', () => {
      near(flat(model.evaluate({ local: { a: 0 } }, { ...rest, grounded: false })), MEAN);
      expect(() => model.evaluate({ local: { nope: 1 } }, rest)).toThrow(/Unknown local control: nope/);
      expect(() => model.evaluate({ local: { nope: 0 } }, rest)).not.toThrow(); // zero is never looked up
    });

    it('shape components and local controls combine', () => {
      const s = model.evaluate({ z: [1, 0], local: { b: 1 } }, { ...rest, grounded: false });
      const e = MEAN.slice();
      e[0] += 2 * 0.01 * 100; e[13] += 2 * 0.01 * 300; e[8] += 0.1 * 10;
      near(flat(s), e);
    });
  });

  describe('grounding', () => {
    it('is on by default: the lowest vertex y becomes 0 and every joint moves with it', () => {
      const s = model.evaluate({}, rest);
      near(flat(s), grounded(MEAN));
      expect(Math.min(s.positions[1], s.positions[4], s.positions[7])).toBe(0);
      expect(s.joints[1]).toBeCloseTo(5 - 10, 5); // joints may end up below the floor: only vertices are on it
      expect(s.joints[4]).toBeCloseTo(6 - 10, 5);
    });
    it('uses the lowest vertex, not the lowest joint', () => {
      const s = model.evaluate({}, rest);
      expect(s.positions[1]).toBe(0); // v0 at y=10 is lowest of the vertices; j0 at y=5 is lower but is a joint
    });
    it('can be turned off', () => {
      near(flat(model.evaluate({}, { ...rest, grounded: false })), MEAN);
      near(flat(model.evaluate({}, { ...rest, grounded: true })), grounded(MEAN));
    });
    it('follows the shape: after a local control moves the lowest vertex it grounds to the new lowest', () => {
      const s = model.evaluate({ local: { a: 1 } }, rest);
      // control a leaves vertex y values alone, so the lowest vertex is still v0 (y = 10): joint j0 rises by 1*0.5*4
      expect(s.joints[1]).toBeCloseTo(5 + 2 - 10, 5);
    });
  });

  describe('mesh and joints', () => {
    it('mesh pairs the shape positions with the face indices', () => {
      const s = model.evaluate({}, rest);
      const m = model.mesh(s);
      expect(m.positions).toBe(s.positions);
      expect(Array.from(m.triangles)).toEqual([0, 1, 2]);
    });
    it('joint returns a joint by label and throws for an unknown one', () => {
      const s = model.evaluate({}, { ...rest, grounded: false });
      near(model.joint(s, 'b0'), [0, 5, 0]);
      near(model.joint(s, 'b1'), [3, 6, 0]);
      expect(() => model.joint(s, 'b2')).toThrow(/Unknown bone: b2/);
    });
  });

  describe('skinning weights', () => {
    it('weightOfBones is the picked weight as a fraction of the vertex total', () => {
      expect(model.weightOfBones(0, (b) => b === 0)).toBeCloseTo(200 / 255, 9);
      expect(model.weightOfBones(0, (b) => b === 1)).toBeCloseTo(55 / 255, 9);
      expect(model.weightOfBones(0, () => true)).toBeCloseTo(1, 9);
      expect(model.weightOfBones(0, () => false)).toBe(0);
      expect(model.weightOfBones(1, (b) => b === 1)).toBeCloseTo(1, 9);
      expect(model.weightOfBones(2, (b) => b === 0)).toBeCloseTo(128 / 255, 9);
    });
    it('reads the right row for each vertex (indices are per vertex, weights too)', () => {
      expect(model.weightOfBones(1, (b) => b === 0)).toBe(0);
      expect(model.weightOfBones(2, (b) => b === 1)).toBeCloseTo(127 / 255, 9);
    });
    it('dominantBone is the bone with the largest weight, the first on a tie', () => {
      expect(model.dominantBone(0)).toBe(0);
      expect(model.dominantBone(1)).toBe(1);
      expect(model.dominantBone(2)).toBe(0); // 128 vs 127
    });
    it('dominantBone keeps the first bone when weights tie exactly', () => {
      const m2 = { ...manifest, blocks: { ...manifest.blocks } };
      const b2 = bin.slice(0);
      const w = m2.blocks.skinW;
      new Uint8Array(b2, w.offset, w.bytes).set([100, 100, 255, 0, 128, 127]);
      const tie = new BodyModel(m2, b2);
      expect(tie.dominantBone(0)).toBe(0);
    });
  });

  describe('construction', () => {
    it('works on a block that does not start on a 4-byte boundary (blocks are copied before use)', () => {
      // faces (uint16) sit after float blocks; shift everything by one byte and the model must still read it.
      const shifted = new Uint8Array(bin.byteLength + 1);
      shifted.set(new Uint8Array(bin), 1);
      const m2: BodyManifest = { ...manifest, blocks: Object.fromEntries(Object.entries(manifest.blocks).map(([k, v]) => [k, { ...v, offset: v.offset + 1 }])) };
      const m = new BodyModel(m2, shifted.buffer);
      near(flat(m.evaluate({ z: [1, 1] }, { ...rest, grounded: false })), flat(model.evaluate({ z: [1, 1] }, { ...rest, grounded: false })));
    });
  });
});

describe('loadBodyFromUrl', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetched.push(url);
      return { json: async () => manifest, arrayBuffer: async () => bin };
    }));
    return fetched;
  };
  it('fetches body.json and body.bin from /body by default and builds the model', async () => {
    const fetched = stub();
    const m = await loadBodyFromUrl();
    expect(fetched.sort()).toEqual(['/body/body.bin', '/body/body.json']);
    expect(m.vertexCount).toBe(3);
    near(flat(m.evaluate({ z: [1, 1] }, { ...rest, grounded: false })), flat(model.evaluate({ z: [1, 1] }, { ...rest, grounded: false })));
  });
  it('fetches from the base it is given', async () => {
    const fetched = stub();
    await loadBodyFromUrl('/app/assets/body');
    expect(fetched.sort()).toEqual(['/app/assets/body/body.bin', '/app/assets/body/body.json']);
  });
});
