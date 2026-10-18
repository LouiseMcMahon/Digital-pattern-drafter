import type { PanelSeed } from './core/design';
import { type PanelsResult, computePanels } from './core/panelPipeline';
import { type Seam, SurfaceGraph } from './core/seam';

/** Cut the body along the seams and flatten every panel, off the main thread (a panel takes about a second). */
export interface PanelsRequest { id: number; positions: Float64Array; triangles: Uint32Array; seams: Seam[]; panels: PanelSeed[] }
export type PanelsResponse = { id: number; result: PanelsResult } | { id: number; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<PanelsRequest>) => void) | null; postMessage(m: PanelsResponse): void };
// The graph depends only on the mesh's topology, which never changes: build it once.
let graph: { key: string; value: SurfaceGraph } | undefined;

ctx.onmessage = (e) => {
  const { id, positions, triangles, seams, panels } = e.data;
  try {
    const key = `${triangles.length}:${positions.length}`;
    if (graph?.key !== key) graph = { key, value: new SurfaceGraph(triangles, positions.length / 3) };
    ctx.postMessage({ id, result: computePanels({ positions, triangles }, graph.value, seams, panels) });
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
