import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromMelee } from '../src/index.ts';
import type { ProxyRound, ProxyTournament, Tournament } from '../src/index.ts';

const DEFAULT_ID = '484511';

function rawDir(id: string): string {
  return fileURLToPath(new URL(`../../../fixtures/melee/${id}/raw/`, import.meta.url));
}

export function readJson(name: string, id: string = DEFAULT_ID): any {
  return JSON.parse(readFileSync(rawDir(id) + name, 'utf8'));
}

/** Fixtures with standings and matches for every round (Baltimore, 498211, is page-only). */
export const FULL_FIXTURES = ['484511', '493469', '464438', '484355', '465966', '505142', '504384', '504989'] as const;

export function proxyRounds(id: string = DEFAULT_ID): ProxyRound[] {
  const html = readFileSync(rawDir(id) + 'tournament.html', 'utf8');
  const out: ProxyRound[] = [];
  const seen = new Set<number>();
  for (const m of html.matchAll(/<button[^>]*round-selector[^>]*data-id="(\d+)" data-name="([^"]+)"[^>]*>/g)) {
    const id = Number(m[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: m[2]!, started: true, completed: true, kind: /^round\s*\d+$/i.test(m[2]!) ? 'swiss' : 'playoff' });
  }
  return out;
}

/** Swiss round ids in order, read from the tournament page. */
export function swissRoundIds(id: string = DEFAULT_ID): number[] {
  return proxyRounds(id).filter((r) => r.kind === 'swiss').map((r) => r.id);
}

export const SWISS_ROUND_IDS = swissRoundIds(DEFAULT_ID);

export function fixtureInput(id: string = DEFAULT_ID): { tournament: ProxyTournament; standings: Record<number, unknown>; matches: Record<number, unknown> } {
  const rounds = proxyRounds(id);
  const standings: Record<number, unknown> = {};
  const matches: Record<number, unknown> = {};
  for (const r of rounds) {
    standings[r.id] = readJson(`standings-${r.id}.json`, id);
    matches[r.id] = readJson(`matches-${r.id}.json`, id);
  }
  return {
    tournament: {
      id: Number(id),
      name: `Fixture ${id}`,
      startDate: '2026-11-14T18:00:00.0000000Z',
      statusText: 'Ended',
      rounds,
      standingsConfig: readJson('standings-config.json', id),
      fetchedAt: '2026-11-16T00:00:00Z',
      source: 'site',
    },
    standings,
    matches,
  };
}

export function fixtureTournament(id: string = DEFAULT_ID): Tournament {
  return fromMelee(fixtureInput(id));
}

/** Fixture truncated to `through` Swiss rounds (later rounds dropped entirely). */
export function truncated(t: Tournament, through: number, opts: { postedNext?: boolean } = {}): Tournament {
  const rounds = t.rounds
    .filter((r) => r.number <= through + (opts.postedNext ? 1 : 0))
    .map((r) =>
      r.number <= through
        ? r
        : { ...r, status: 'in-progress' as const, matches: r.matches.map((m) => ({ ...m, result: null })) },
    );
  return { ...t, rounds };
}
