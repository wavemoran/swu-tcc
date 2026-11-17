import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import type { ProxyTournament } from '@swu-tcc/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';

const RAW = resolve(import.meta.dirname, '../../../fixtures/melee/484511/raw') + '/';
const raw = (name: string) => readFileSync(RAW + name, 'utf8');

/** Round ids from fixtures/README.md: 1-5, 6 (1749836), then quarterfinals, semifinals, finals. */
const SWISS = [1725211, 1725212, 1725213, 1725214, 1725215, 1749836];
const PLAYOFF = [1725216, 1725217, 1725218];
const FOCUS = 5003; // Melee TeamId, from standings-1725215.json

const proxy: ProxyTournament = {
  id: 484511,
  name: 'Homeworlds Planetary Qualifier',
  startDate: '2026-11-14T18:00:00.0000000Z',
  statusText: null,
  rounds: [
    ...SWISS.map((id, i) => ({
      id,
      name: `Round ${i + 1}`,
      kind: 'swiss' as const,
      // Round 6 (the final Swiss round) has not started yet: the state Player 003 was in when deciding to ID.
      started: i < 5,
      completed: i < 5,
    })),
    ...['Quarterfinals', 'Semifinals', 'Finals'].map((name, i) => ({
      id: PLAYOFF[i]!,
      name,
      kind: 'playoff' as const,
      started: false,
      completed: false,
    })),
  ],
  standingsConfig: JSON.parse(raw('standings-config.json')),
  fetchedAt: new Date().toISOString(),
  source: 'site',
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState(null, '', '/');
});

describe('player page against the real 484511 fixture', () => {
  it('shows ID SAFE for Player 003 before round 6', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const t = /^\/api\/tournaments\/(\d+)/.exec(url);
      if (t) return new Response(JSON.stringify(proxy), { status: 200 });
      const r = /^\/api\/rounds\/(\d+)\/(standings|matches)/.exec(url);
      if (r) return new Response(raw(`${r[2]}-${r[1]}.json`), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState(null, '', `/t/484511/p/${FOCUS}`);
    render(<App />);

    const verdict = await screen.findByTestId('verdict', undefined, { timeout: 20000 });
    expect(verdict).toHaveTextContent('ID SAFE');
    expect(verdict).toHaveTextContent(/if you ID/);
    // Round 6 and the playoffs were never requested.
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes('1749836') || u.includes('1725216'))).toBe(false);
  }, 30000);
});
