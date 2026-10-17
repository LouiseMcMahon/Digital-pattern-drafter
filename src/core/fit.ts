import type { BodyModel, BodyParams, BodyShape } from './bodyModel';
import { type MeasurementName, Measurer } from './measure';

/** Target measurements in cm. Any subset may be given; the rest follow from the prior. */
export type FitTargets = Partial<Record<MeasurementName, number>>;

export interface FitOptions {
  /** Prior body: unspecified dimensions stay close to this. */
  preset?: 'female' | 'male' | 'neutral';
  /** Leading PCA components free to move (the rest stay at the preset). */
  pcaComponents?: number;
  maxIterations?: number;
  /** Stop when every target is within this many cm. */
  tolerance?: number;
}

export interface FitResult {
  params: BodyParams;
  shape: BodyShape;
  measured: Partial<Record<MeasurementName, number>>;
  /** measured - target, cm */
  errors: Partial<Record<MeasurementName, number>>;
  maxError: number;
  iterations: number;
  /** Targets still off by more than 0.5 cm (R1): they could not be met together. */
  unmet: { name: MeasurementName; target: number; achieved: number }[];
  /** Plausibility problems: the numbers may be met, but the body or the inputs are unusual (R2). */
  warnings: string[];
}

/** R1 acceptance: measuring the fitted body must give the entered numbers within this (cm). */
export const R1_TOLERANCE_CM = 0.5;

const DEBUG = typeof process !== 'undefined' && !!process.env?.FIT_DEBUG;
const Z_LIMIT = 6;
const LOCAL_LIMIT = 5;
const MEASURE_WEIGHT = 10; // residual weight per cm
const Z_PRIOR = 0.25; // per std unit
const MAX_STEP_Z = 1.0;
const MAX_STEP_LOCAL = 1.5;

/**
 * Local controls the fit may use: those that change size and proportion. Translations, posture-like
 * morphs (leg-valgus), tone, navel, pregnancy and bulge are excluded: they can hit a number by
 * distorting the body (R2).
 */
const FIT_CONTROL = /^(measure-|.*-scale-|.*-fat-|.*-muscle-|.*-height-incr|breast-dist-|buttocks-volume-|torso-vshape-)/;
const isFitControl = (label: string) => FIT_CONTROL.test(label.replace(/^[lr]-/, ''));

/** Cost per unit of a local control: cheapest for Anny's dedicated measure-* controls. */
function localPrior(label: string): number {
  return label.startsWith('measure-') ? 0.15 : 0.8;
}

/** Plausible ranges of proportions, as a fraction of height, for adult bodies. */
const RATIO_RANGES: [MeasurementName, number, number][] = [
  ['insideLeg', 0.38, 0.52],
  ['waistHeight', 0.56, 0.68],
  ['napeToWaist', 0.2, 0.29],
  ['armLength', 0.3, 0.4],
];

/** Solve (A) x = b for symmetric positive-definite A by Cholesky. A is n*n row-major, destroyed. */
function choleskySolve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= A[j * n + k] ** 2;
    d = Math.sqrt(Math.max(d, 1e-12));
    A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = s / d;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= A[i * n + k] * y[k];
    y[i] = s / A[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= A[k * n + i] * x[k];
    x[i] = s / A[i * n + i];
  }
  return x;
}

export function fitBody(body: BodyModel, measurer: Measurer, targets: FitTargets, opts: FitOptions = {}): FitResult {
  const names = Object.keys(targets) as MeasurementName[];
  const preset = body.presets[opts.preset ?? 'female'];
  const Kf = Math.min(opts.pcaComponents ?? 16, body.components);
  const maxIt = opts.maxIterations ?? 80;
  const tol = opts.tolerance ?? 0.1;

  // Local controls: a left/right pair is driven by one parameter so the body stays symmetric.
  const groups: string[][] = [];
  for (const l of body.localLabels) {
    if (!isFitControl(l)) continue;
    if (l.startsWith('r-') && body.localLabels.includes('l-' + l.slice(2))) continue;
    groups.push(l.startsWith('l-') && body.localLabels.includes('r-' + l.slice(2)) ? [l, 'r-' + l.slice(2)] : [l]);
  }
  const P = Kf + groups.length;
  const baseWeight = Float64Array.from({ length: P }, (_, i) => (i < Kf ? Z_PRIOR : localPrior(groups[i - Kf][0].replace(/^l-/, ''))));
  const weight = Float64Array.from(baseWeight);
  let priorScale = 1;

  const paramsOf = (theta: Float64Array): BodyParams => {
    const z = Float64Array.from(preset);
    for (let k = 0; k < Kf; k++) z[k] += theta[k];
    const local: Record<string, number> = {};
    groups.forEach((g, i) => { for (const l of g) local[l] = theta[Kf + i]; });
    return { z, local };
  };
  const measureAt = (theta: Float64Array) => {
    const shape = body.evaluate(paramsOf(theta));
    const m = measurer.measure(shape, names);
    // A measurement that cannot be taken (no loop found) counts as a large miss, never as NaN.
    for (const n of names) if (!Number.isFinite(m[n])) m[n] = targets[n]! + 50;
    return { shape, m };
  };
  const residuals = (m: ReturnType<typeof measureAt>['m']) => names.map((n) => MEASURE_WEIGHT * (m[n] - targets[n]!));
  const prior = (theta: Float64Array) => Array.from(theta, (v, i) => weight[i] * v);
  const cost = (r: number[], p: number[]) => r.reduce((s, v) => s + v * v, 0) + p.reduce((s, v) => s + v * v, 0);

  let theta = new Float64Array(P);
  let cur = measureAt(theta);
  let r = residuals(cur.m);
  let pr = prior(theta);
  let c = cost(r, pr);
  let J: Float64Array | undefined; // names.length x P
  let mu = 1e-2;
  let it = 0;
  let sinceJ = 0;
  let stalls = 0;

  const maxErr = (m: typeof cur.m) => Math.max(0, ...names.map((n) => Math.abs(m[n] - targets[n]!)));

  for (; it < maxIt; it++) {
    if (maxErr(cur.m) < tol && it > 0) break;
    if (!J || sinceJ >= 4) {
      J = new Float64Array(names.length * P);
      for (let j = 0; j < P; j++) {
        const eps = 0.05;
        const t2 = Float64Array.from(theta);
        t2[j] += eps;
        const m2 = measureAt(t2).m;
        for (let i = 0; i < names.length; i++) J[i * P + j] = (MEASURE_WEIGHT * (m2[names[i]] - cur.m[names[i]])) / eps;
      }
      if (DEBUG) {
        const bad: string[] = [];
        for (let i = 0; i < names.length; i++) for (let j = 0; j < P; j++) if (!Number.isFinite(J[i * P + j])) bad.push(`${names[i]}/${j < Kf ? 'z' + j : groups[j - Kf][0]}`);
        process.stderr.write(`fit J nonfinite: ${bad.length} ${bad.slice(0, 6).join(' ')}\n`);
      }
      sinceJ = 0;
    }
    // Normal equations including the ridge prior rows.
    const A = new Float64Array(P * P);
    const g = new Float64Array(P);
    for (let i = 0; i < names.length; i++) {
      for (let a2 = 0; a2 < P; a2++) {
        const ja = J[i * P + a2];
        if (ja === 0) continue;
        g[a2] -= ja * r[i];
        for (let b2 = 0; b2 <= a2; b2++) A[a2 * P + b2] += ja * J[i * P + b2];
      }
    }
    for (let a2 = 0; a2 < P; a2++) {
      const w = weight[a2];
      A[a2 * P + a2] += w * w;
      g[a2] -= w * w * theta[a2];
      for (let b2 = a2 + 1; b2 < P; b2++) A[a2 * P + b2] = A[b2 * P + a2];
    }
    let accepted = false;
    const before = c;
    for (let tries = 0; tries < 12 && !accepted; tries++) {
      const M = Float64Array.from(A);
      for (let a2 = 0; a2 < P; a2++) M[a2 * P + a2] += mu * (A[a2 * P + a2] + 1e-6);
      const d = choleskySolve(M, Float64Array.from(g), P);
      const t2 = Float64Array.from(theta, (v, i) => {
        const lim = i < Kf ? MAX_STEP_Z : MAX_STEP_LOCAL;
        const nv = v + Math.max(-lim, Math.min(lim, d[i]));
        return i < Kf ? Math.max(-Z_LIMIT, Math.min(Z_LIMIT, nv)) : Math.max(-LOCAL_LIMIT, Math.min(LOCAL_LIMIT, nv));
      });
      const next = measureAt(t2);
      const r2 = residuals(next.m);
      const c2 = cost(r2, prior(t2));
      if (c2 < c) {
        theta = t2; cur = next; r = r2; pr = prior(t2); c = c2;
        mu = Math.max(1e-6, mu * 0.4);
        accepted = true;
      } else {
        mu *= 4;
      }
    }
    if (DEBUG) process.stderr.write(`fit it ${it} accepted ${accepted} cost ${before.toExponential(3)} -> ${c.toExponential(3)} mu ${mu.toExponential(2)} maxErr ${maxErr(cur.m).toFixed(2)}\n`);
    sinceJ++;
    if (!accepted || before - c < 1e-6 * before) {
      // No progress: try once with a fresh Jacobian, then give up.
      if (++stalls >= 3) {
        // Stalled. The measurements win over plausibility (R1): relax the priors and continue.
        if (maxErr(cur.m) < tol || priorScale < 1e-3) break;
        priorScale *= 0.2;
        for (let q = 0; q < P; q++) weight[q] = baseWeight[q] * priorScale;
        pr = prior(theta);
        c = cost(r, pr);
        stalls = 0;
        mu = 1e-2;
      }
      J = undefined;
    } else {
      stalls = 0;
    }
  }

  const errors: FitResult['errors'] = {};
  const measured: FitResult['measured'] = {};
  const unmet: FitResult['unmet'] = [];
  for (const n of names) {
    measured[n] = cur.m[n];
    errors[n] = cur.m[n] - targets[n]!;
    if (!(Math.abs(errors[n]!) <= R1_TOLERANCE_CM)) unmet.push({ name: n, target: targets[n]!, achieved: cur.m[n] });
  }
  const warnings: string[] = [];
  const h = targets.height;
  if (h) {
    for (const [n, lo, hi] of RATIO_RANGES) {
      const v = targets[n];
      if (v !== undefined && (v / h < lo || v / h > hi)) warnings.push(`${n} of ${v} cm is unusual for a height of ${h} cm (${((100 * v) / h).toFixed(0)}% of height; typical ${lo * 100}-${hi * 100}%)`);
    }
  }
  const bigZ = Array.from(theta.slice(0, Kf)).filter((v) => Math.abs(v) > 3).length;
  if (bigZ) warnings.push(`overall body shape is far from typical (${bigZ} shape component(s) beyond 3 standard deviations)`);
  groups.forEach((gr, i) => {
    const v = theta[Kf + i];
    if (!gr[0].startsWith('measure-') && Math.abs(v) > 3) warnings.push(`unusual adjustment of ${gr[0].replace(/^l-/, '')} (${v.toFixed(1)}) was needed to meet the measurements`);
  });
  return { params: paramsOf(theta), shape: cur.shape, measured, errors, maxError: maxErr(cur.m), iterations: it, unmet, warnings };
}
