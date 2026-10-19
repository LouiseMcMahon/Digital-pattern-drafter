import { SurfaceField } from './core/bodyField';
import { type ClothPatternResult, type ClothPiece, type ClothProgress, clothPatternsSteps } from './core/cloth';
import type { Mesh } from './core/mesh';

export interface ClothRequest { body: Mesh; pieces: ClothPiece[]; targets: Float64Array }
export type ClothMessage =
  | { kind: 'progress'; progress: ClothProgress }
  | { kind: 'done'; results: ClothPatternResult[] }
  | { kind: 'error'; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<ClothRequest>) => void) | null; postMessage(m: ClothMessage): void };

ctx.onmessage = (e) => {
  try {
    const { body, pieces, targets } = e.data;
    const steps = clothPatternsSteps(pieces, new SurfaceField(body), { targets });
    let step = steps.next();
    while (!step.done) {
      ctx.postMessage({ kind: 'progress', progress: step.value });
      step = steps.next();
    }
    ctx.postMessage({ kind: 'done', results: step.value });
  } catch (err) {
    ctx.postMessage({ kind: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
