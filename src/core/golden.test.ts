import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BodyModel, BodyParams, BodyShape } from './bodyModel';
import { fitBody } from './fit';
import { FIXTURES } from './fixtures';
import { loadBodyFromDisk } from './loadBodyNode';
import { MEASUREMENT_NAMES, type Measurements, Measurer } from './measure';
import { GOLDEN_PATH, type GoldenBody, type GoldenFile, KEY_JOINTS, SAMPLE_STRIDE, readGolden } from './testBodies';

/**
 * GOLDEN SNAPSHOTS (REQUIREMENTS.md R6, ENGINEERING.md "Changing the model").
 *
 * Pins, for a fixed set of reference bodies in the tailor pose: the exact parameters, all measurements,
 * and the body geometry; plus the hash of the baked body data. Any change to the baked data, the pose,
 * a measurement definition or a calibration offset fails here. To accept an intended change:
 *
 *   UPDATE_GOLDEN=1 npx vitest run src/core/golden.test.ts       (keeps the stored fixture parameters)
 *   UPDATE_GOLDEN=refit npx vitest run src/core/golden.test.ts   (also re-fits the fixture bodies; use when the fixture targets changed)
 *
 * which rewrite the golden file and prints a drift report (how far every measurement moved). Commit the
 * golden change separately from the code change and paste the drift report in the commit message.
 */
const MEASURE_TOL_CM = 0.005;
const GEOMETRY_TOL_CM = 0.01;

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

function geometryOf(body: BodyModel, shape: BodyShape): GoldenBody['geometry'] {
  const n = body.vertexCount;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const sum = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = shape.positions[3 * i + k];
    min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); sum[k] += v;
  }
  const samples: number[][] = [];
  for (let i = 0; i < n; i += SAMPLE_STRIDE) samples.push([0, 1, 2].map((k) => round(shape.positions[3 * i + k])));
  const joints: Record<string, number[]> = {};
  for (const j of KEY_JOINTS) joints[j] = body.joint(shape, j).map((v) => round(v));
  return { boundsMin: min.map((v) => round(v)), boundsMax: max.map((v) => round(v)), centroid: sum.map((v) => round(v / n)), samples, joints };
}

function referenceParams(body: BodyModel): Record<string, BodyParams> {
  return {
    presetFemale: { z: body.presets.female },
    presetMale: { z: body.presets.male },
    presetNeutral: { z: body.presets.neutral },
  };
}

let body: BodyModel;
let measurer: Measurer;
beforeAll(async () => {
  body = await loadBodyFromDisk();
  measurer = new Measurer(body);
});

describe('golden snapshots', () => {
  if (process.env.UPDATE_GOLDEN) {
    it('UPDATE: rewrite the golden file and print a drift report', () => {
      let before: GoldenFile | undefined;
      try { before = readGolden(); } catch { /* first run */ }
      const bodies: Record<string, GoldenBody> = {};
      const params = referenceParams(body);
      for (const [key, fx] of Object.entries(FIXTURES)) {
        // Fixture bodies keep their stored parameters unless the golden file does not have them yet,
        // so the drift report isolates changes to the model from changes to the solver.
        const stored = process.env.UPDATE_GOLDEN === 'refit' ? undefined : before?.bodies[key]?.params;
        params[key] = stored ?? fitBody(body, measurer, fx.targets, { preset: fx.preset }).params;
      }
      for (const [name, p] of Object.entries(params)) {
        const shape = body.evaluate(p);
        bodies[name] = {
          params: { z: Array.from(p.z ?? [], (v) => round(v, 9)), local: Object.fromEntries(Object.entries(p.local ?? {}).map(([k, v]) => [k, round(v, 9)])) },
          measurements: Object.fromEntries(MEASUREMENT_NAMES.map((n) => [n, round(measurer.measure(shape)[n], 4)])) as Measurements,
          geometry: geometryOf(body, shape),
        };
      }
      const file: GoldenFile = {
        data: { bodyBinSha256: sha256('public/body/body.bin'), bodyJsonSha256: sha256('public/body/body.json'), vertexCount: body.vertexCount, jointCount: body.jointCount, components: body.components, localControls: body.localLabels.length },
        bodies,
      };
      writeFileSync(GOLDEN_PATH, JSON.stringify(file, null, 1) + '\n');
      const lines = ['', 'GOLDEN DRIFT REPORT (cm): body / measurement: old -> new'];
      let worst = 0;
      for (const [name, g] of Object.entries(bodies)) {
        for (const n of MEASUREMENT_NAMES) {
          const old = before?.bodies[name]?.measurements[n];
          if (old === undefined) continue;
          const d = g.measurements[n] - old;
          worst = Math.max(worst, Math.abs(d));
          if (Math.abs(d) > MEASURE_TOL_CM) lines.push(`  ${name} / ${n}: ${old} -> ${g.measurements[n]} (${d >= 0 ? '+' : ''}${d.toFixed(3)})`);
        }
      }
      if (!before) lines.push('  (no previous golden file: nothing to compare)');
      else lines.push(`  largest measurement change: ${worst.toFixed(3)} cm; data hash ${before.data.bodyBinSha256 === file.data.bodyBinSha256 ? 'unchanged' : 'CHANGED'}`);
      process.stderr.write(lines.join('\n') + '\n');
    }, 600_000);
    return;
  }

  const golden = readGolden();
  const HOW = '\nIf this change is intended, follow ENGINEERING.md "Changing the model": UPDATE_GOLDEN=1 npx vitest run src/core/golden.test.ts, commit the golden change separately and paste the drift report.';

  it('the baked body data files are byte-for-byte what was pinned', () => {
    expect(sha256('public/body/body.bin'), 'public/body/body.bin changed.' + HOW).toBe(golden.data.bodyBinSha256);
    expect(sha256('public/body/body.json'), 'public/body/body.json changed.' + HOW).toBe(golden.data.bodyJsonSha256);
    expect(body.vertexCount).toBe(golden.data.vertexCount);
    expect(body.jointCount).toBe(golden.data.jointCount);
    expect(body.components).toBe(golden.data.components);
    expect(body.localLabels.length).toBe(golden.data.localControls);
  });

  it('pins every reference body, and the set of reference bodies, in step with the fixtures', () => {
    expect(Object.keys(golden.bodies).sort()).toEqual(['presetFemale', 'presetMale', 'presetNeutral', ...Object.keys(FIXTURES)].sort());
  });

  for (const name of Object.keys(readGolden().bodies)) {
    describe(`reference body: ${name}`, () => {
      const g = golden.bodies[name];
      const shape = () => body.evaluate({ z: g.params.z, local: g.params.local });

      it(`measurements are unchanged (within ${MEASURE_TOL_CM} cm)`, () => {
        const m = measurer.measure(shape());
        const moved = MEASUREMENT_NAMES.filter((n) => !(Math.abs(m[n] - g.measurements[n]) <= MEASURE_TOL_CM));
        expect(moved.map((n) => `${n}: pinned ${g.measurements[n]}, now ${m[n].toFixed(4)}`), 'measurements drifted.' + HOW).toEqual([]);
      });

      it(`geometry is unchanged (within ${GEOMETRY_TOL_CM} cm)`, () => {
        const geo = geometryOf(body, shape());
        const cmp = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= GEOMETRY_TOL_CM);
        expect(cmp(geo.boundsMin, g.geometry.boundsMin) && cmp(geo.boundsMax, g.geometry.boundsMax), 'bounding box moved.' + HOW).toBe(true);
        expect(cmp(geo.centroid, g.geometry.centroid), 'centroid moved.' + HOW).toBe(true);
        const badSample = geo.samples.findIndex((s, i) => !cmp(s, g.geometry.samples[i]));
        expect(badSample, `vertex sample ${badSample} moved.${HOW}`).toBe(-1);
        for (const j of KEY_JOINTS) expect(cmp(geo.joints[j], g.geometry.joints[j]), `joint ${j} moved.${HOW}`).toBe(true);
      });
    });
  }
});
