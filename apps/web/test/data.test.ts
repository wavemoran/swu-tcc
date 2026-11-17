import { afterEach, describe, expect, it, vi } from 'vitest';

import { pool } from '../src/data/api.ts';
import { loadTournament } from '../src/data/load.ts';
import { mockTournament } from '../src/data/mock.ts';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'x-tcc-fetched-at': '2025-10-04T17:00:00Z' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('data layer (explicit mock mode)', () => {
  it('VITE_MOCK=1 serves mock data without touching the network', async () => {
    vi.stubEnv('VITE_MOCK', '1');
    vi.resetModules();
    const { loadTournament, standingsFor } = await import('../src/data/load.ts');
    const { runAnalysis } = await import('../src/data/analysis.ts');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const loaded = await loadTournament('484511');
    expect(loaded.kind).toBe('ready');
    if (loaded.kind !== 'ready') return;
    expect(loaded.mock).toBe(true);
    expect(loaded.tournament.players.length).toBe(52);
    expect(fetchMock).not.toHaveBeenCalled();

    const rows = standingsFor(loaded.tournament, true);
    expect(rows.find((r) => r.name === 'Player 003')).toMatchObject({ rank: 6, points: 12 });

    const analysis = await runAnalysis(loaded.tournament, { playerId: 'p6' }, loaded.mock);
    expect(analysis.verdict.status).toBe('id-safe');
    expect(analysis.verdict.basis).toBe('draw');
    expect(analysis.scenarios.map((s) => s.finalPoints)).toEqual([15, 13, 12]);
  });

  it('fetches only started Swiss rounds, chosen by ProxyRound.kind', async () => {
    const proxy = {
      id: 484511,
      name: 'Homeworlds PQ',
      startDate: null,
      statusText: null,
      rounds: [
        { id: 1, name: 'Round 1', started: true, completed: true, kind: 'swiss' },
        { id: 2, name: 'Round 2', started: true, completed: false, kind: 'swiss' },
        { id: 3, name: 'Round 3', started: false, completed: false, kind: 'swiss' },
        { id: 4, name: 'Quarterfinals', started: true, completed: false, kind: 'playoff' },
      ],
      standingsConfig: {},
      fetchedAt: '2025-10-04T17:00:00Z',
    };
    const fetchMock = vi.fn(async (url: string) => (url.startsWith('/api/tournaments/') ? json(proxy) : json({ data: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await loadTournament('484511').catch(() => undefined);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls.sort()).toEqual([
      '/api/rounds/1/matches?completed=1',
      '/api/rounds/1/standings?completed=1',
      '/api/rounds/2/matches?completed=0',
      '/api/rounds/2/standings?completed=0',
      '/api/tournaments/484511',
    ]);
  });

  it('reports an empty state when no Swiss round has started', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ id: 1, name: 'Future', startDate: null, statusText: null, rounds: [{ id: 9, name: 'Round 1', started: false, completed: false, kind: 'swiss' }], standingsConfig: null, fetchedAt: 'x' }),
      ),
    );
    expect((await loadTournament('1')).kind).toBe('empty');
  });

  it('maps ProxyError bodies to ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_found', message: 'nope' }), { status: 404 })));
    await expect(loadTournament('2')).rejects.toMatchObject({ kind: 'not_found', message: 'nope' });
  });

  it('limits concurrency in pool()', async () => {
    let active = 0;
    let peak = 0;
    await pool(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBe(4);
  });

  it('mock tournament is the 484511 case', () => {
    const t = mockTournament();
    expect(t).toMatchObject({ id: '484511', playerCount: 52, swissRounds: 6, topCut: 8 });
  });
});

describe('api retry', () => {
  const err = (status: number, body?: unknown) =>
    new Response(body === undefined ? '<html>error code: 1102</html>' : JSON.stringify(body), { status });

  async function run<T>(p: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(1000);
    return p;
  }

  it('retries once on 5xx and succeeds', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValueOnce(err(503)).mockResolvedValueOnce(json({ ok: 1 }));
      vi.stubGlobal('fetch', fetchMock);
      const { fetchRoundStandings } = await import('../src/data/api.ts');
      const p = fetchRoundStandings(5, false);
      expect(await run(p)).toEqual({ ok: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries once after a network error', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('boom')).mockResolvedValueOnce(json({ ok: 2 }));
      vi.stubGlobal('fetch', fetchMock);
      const { fetchRoundMatches } = await import('../src/data/api.ts');
      expect(await run(fetchRoundMatches(5, true))).toEqual({ ok: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [404, 'not_found'],
    [429, 'rate_limited'],
    [403, 'not_authorized'],
    [503, 'disabled'],
  ])('does not retry ProxyError %i %s', async (status, kind) => {
    const fetchMock = vi.fn().mockResolvedValue(err(status, { error: kind, message: 'm' }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchTournament } = await import('../src/data/api.ts');
        try {
      const p = fetchTournament('1').catch((e) => e);
      const e = await p;
      expect(e.kind).toBe(kind);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry upstream_error (Melee refused or failed): one request to Melee is enough', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(err(502, { error: 'upstream_error', message: 'Melee said no' }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchTournament } = await import('../src/data/api.ts');
    const e = await fetchTournament('1').catch((x) => x);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(e.kind).toBe('upstream_error');
    expect(e.message).toBe('Melee said no');
  });

  it('gives up after one retry and keeps the original error mapping', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(err(503))
        .mockResolvedValueOnce(err(500));
      vi.stubGlobal('fetch', fetchMock);
      const { fetchTournament } = await import('../src/data/api.ts');
      const p = fetchTournament('1').catch((e) => e);
      await vi.advanceTimersByTimeAsync(1000);
      const e = await p;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(e.status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps two network failures to a network error', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
      vi.stubGlobal('fetch', fetchMock);
      const { fetchTournament } = await import('../src/data/api.ts');
      const p = fetchTournament('1').catch((e) => e);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).kind).toBe('network');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
