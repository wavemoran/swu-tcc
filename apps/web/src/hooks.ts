import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis, AnalysisOptions, Tournament } from '@swu-tcc/core';
import { ApiError } from './data/api.ts';
import { runAnalysis } from './data/analysis.ts';
import { loadTournament } from './data/load.ts';
import type { Loaded } from './data/load.ts';

export type TournamentState =
  | { status: 'loading'; done: number; total: number }
  | { status: 'error'; error: ApiError }
  | { status: 'empty'; loaded: Extract<Loaded, { kind: 'empty' }> }
  | { status: 'ready'; loaded: Extract<Loaded, { kind: 'ready' }> };

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError('unknown', e instanceof Error ? e.message : 'Something went wrong.');
}

export function useTournament(id: string) {
  const [state, setState] = useState<TournamentState>({ status: 'loading', done: 0, total: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const hasData = useRef(false);

  const load = useCallback(
    async (background: boolean) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (background) setRefreshing(true);
      else setState({ status: 'loading', done: 0, total: 0 });
      try {
        const loaded = await loadTournament(id, {
          signal: c.signal,
          onProgress: (done, total) => {
            if (!background && !c.signal.aborted) setState({ status: 'loading', done, total });
          },
        });
        if (c.signal.aborted) return;
        hasData.current = loaded.kind === 'ready';
        setState(loaded.kind === 'ready' ? { status: 'ready', loaded } : { status: 'empty', loaded });
      } catch (e) {
        if (c.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        // A failed background refresh keeps the data we already have.
        if (!background) setState({ status: 'error', error: toApiError(e) });
      } finally {
        if (!c.signal.aborted) setRefreshing(false);
      }
    },
    [id],
  );

  useEffect(() => {
    hasData.current = false;
    void load(false);
    return () => ctrl.current?.abort();
  }, [load]);

  const refresh = useCallback(() => load(hasData.current), [load]);
  return { state, refreshing, refresh };
}

export type AnalysisState =
  | { status: 'loading'; analysis: Analysis | null }
  | { status: 'ready'; analysis: Analysis }
  | { status: 'error'; message: string; analysis: Analysis | null };

export function useAnalysis(t: Tournament, mock: boolean, options: AnalysisOptions): AnalysisState {
  const [state, setState] = useState<AnalysisState>({ status: 'loading', analysis: null });
  const key = JSON.stringify(options);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ status: 'loading', analysis: s.analysis }));
    runAnalysis(t, JSON.parse(key) as AnalysisOptions, mock).then(
      (analysis) => !cancelled && setState({ status: 'ready', analysis }),
      (e: unknown) =>
        !cancelled &&
        setState((s) => ({ status: 'error', message: e instanceof Error ? e.message : String(e), analysis: s.analysis })),
    );
    return () => {
      cancelled = true;
    };
  }, [t, mock, key]);
  return state;
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
