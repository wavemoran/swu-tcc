import { analyze } from '@swu-tcc/core';
import type { Analysis, AnalysisOptions, Tournament } from '@swu-tcc/core';
import { FORCE_MOCK } from './load.ts';
import { mockAnalyze } from './mock.ts';
import type { WorkerRequest, WorkerResponse } from './analyze.worker.ts';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (a: Analysis) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if ('error' in ev.data) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.analysis);
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('Analysis worker failed.'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

/**
 * Run core's `analyze` (in a Web Worker when available). Returns the
 * mock analysis only in explicit mock mode (`VITE_MOCK=1`).
 */
export async function runAnalysis(t: Tournament, options: AnalysisOptions, mock: boolean): Promise<Analysis> {
  if (mock || FORCE_MOCK) return mockAnalyze(t, options);
  const w = getWorker();
  if (!w) return analyze(t, options);
  const id = nextId++;
  return new Promise<Analysis>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, tournament: t, options } satisfies WorkerRequest);
  });
}
