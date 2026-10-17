import { type BodyModel, loadBodyFromUrl } from './core/bodyModel';
import { type FitOptions, type FitResult, type FitTargets, fitBody } from './core/fit';
import { Measurer } from './core/measure';

export interface FitRequest { targets: FitTargets; options: FitOptions }
export type FitResponse = Pick<FitResult, 'errors' | 'measured' | 'unmet' | 'warnings' | 'iterations' | 'maxError'> & { z: number[]; local: Record<string, number> };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<FitRequest>) => void) | null; postMessage(m: FitResponse): void };
let ready: Promise<{ body: BodyModel; measurer: Measurer }> | undefined;

ctx.onmessage = async (e) => {
  ready ??= loadBodyFromUrl(import.meta.env.BASE_URL + 'body').then((body) => ({ body, measurer: new Measurer(body) }));
  const { body, measurer } = await ready;
  const r = fitBody(body, measurer, e.data.targets, e.data.options);
  ctx.postMessage({ z: Array.from(r.params.z ?? []), local: r.params.local ?? {}, errors: r.errors, measured: r.measured, unmet: r.unmet, warnings: r.warnings, iterations: r.iterations, maxError: r.maxError });
};
