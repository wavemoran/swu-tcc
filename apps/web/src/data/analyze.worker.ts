import { analyze } from '@swu-tcc/core';
import type { Analysis, AnalysisOptions, Tournament } from '@swu-tcc/core';

export type WorkerRequest = { id: number; tournament: Tournament; options: AnalysisOptions };
export type WorkerResponse = { id: number; analysis: Analysis } | { id: number; error: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, tournament, options } = ev.data;
  try {
    (self as unknown as Worker).postMessage({ id, analysis: analyze(tournament, options) } satisfies WorkerResponse);
  } catch (e) {
    (self as unknown as Worker).postMessage({
      id,
      error: e instanceof Error ? e.message : String(e),
    } satisfies WorkerResponse);
  }
};
