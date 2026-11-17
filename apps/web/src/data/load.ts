import { computeStandings, fromMelee } from '@swu-tcc/core';
import type { ProxyTournament, StandingRow, Tournament } from '@swu-tcc/core';
import { ApiError, fetchRoundMatches, fetchRoundStandings, fetchTournament, pool } from './api.ts';
import { mockStandings, mockTournament } from './mock.ts';

/** True when VITE_MOCK=1: never touch the network or core. */
export const FORCE_MOCK = import.meta.env.VITE_MOCK === '1';

export type Loaded =
  | { kind: 'ready'; tournament: Tournament; mock: boolean; fetchedAt: string | null; proxy: ProxyTournament | null }
  | { kind: 'empty'; proxy: ProxyTournament };

export interface LoadOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const MAX_CONCURRENT = 4;

export async function loadTournament(id: string, opts: LoadOptions = {}): Promise<Loaded> {
  if (FORCE_MOCK) {
    const t = mockTournament();
    return { kind: 'ready', tournament: t, mock: true, fetchedAt: t.fetchedAt, proxy: null };
  }

  const proxy = await fetchTournament(id, opts.signal);
  const started = proxy.rounds.filter((r) => r.kind === 'swiss' && r.started);
  if (started.length === 0) return { kind: 'empty', proxy };

  const tasks = started.flatMap((r) => [
    { roundId: r.id, kind: 'standings' as const, completed: r.completed },
    { roundId: r.id, kind: 'matches' as const, completed: r.completed },
  ]);
  let done = 0;
  opts.onProgress?.(0, tasks.length);
  const bodies = await pool(tasks, MAX_CONCURRENT, async (task) => {
    const body =
      task.kind === 'standings'
        ? await fetchRoundStandings(task.roundId, task.completed, opts.signal)
        : await fetchRoundMatches(task.roundId, task.completed, opts.signal);
    opts.onProgress?.(++done, tasks.length);
    return body;
  });

  const standings: Record<number, unknown> = {};
  const matches: Record<number, unknown> = {};
  tasks.forEach((task, i) => {
    (task.kind === 'standings' ? standings : matches)[task.roundId] = bodies[i];
  });

  try {
    const tournament = fromMelee({ tournament: proxy, standings, matches });
    return { kind: 'ready', tournament, mock: false, fetchedAt: tournament.fetchedAt ?? proxy.fetchedAt, proxy };
  } catch {
    throw new ApiError('unknown', "Melee's data came back in a shape we could not read.");
  }
}

/** Standings table rows (mock rows only in explicit VITE_MOCK=1 mode). */
export function standingsFor(t: Tournament, mock: boolean): StandingRow[] {
  if (mock || FORCE_MOCK) return mockStandings(t);
  return computeStandings(t);
}
