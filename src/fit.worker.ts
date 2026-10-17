import { type BodyModel, loadBodyFromUrl } from './core/bodyModel';
import { type FitOptions, type FitResult, type FitTargets, fitBody } from './core/fit';
import { Measurer } from './core/measure';

export interface FitRequest { targets: FitTargets; options: FitOptions }
export type FitSuccess = Pick<FitResult, 'errors' | 'measured' | 'unmet' | 'warnings' | 'iterations' | 'maxError'> & { z: number[]; local: Record<string, number> };
/** Posted instead of a result when the fit throws or the body model cannot be loaded, so the page can recover. */
export interface FitFailure { error: string }
export type FitResponse = FitSuccess | FitFailure;

const ctx = self as unknown as { onmessage: ((e: MessageEvent<FitRequest>) => void) | null; postMessage(m: FitResponse): void };
let ready: Promise<{ body: BodyModel; measurer: Measurer }> | undefined;

ctx.onmessage = async (e) => {
  try {
    ready ??= loadBodyFromUrl(import.meta.env.BASE_URL + 'body').then((body) => ({ body, measurer: new Measurer(body) }));
    const { body, measurer } = await ready;
    const r = fitBody(body, measurer, e.data.targets, e.data.options);
    ctx.postMessage({ z: Array.from(r.params.z ?? []), local: r.params.local ?? {}, errors: r.errors, measured: r.measured, unmet: r.unmet, warnings: r.warnings, iterations: r.iterations, maxError: r.maxError });
  } catch (err) {
    ready = undefined; // allow a retry (the body fetch may have failed)
    ctx.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
