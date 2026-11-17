import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { App as AppType } from '../src/App.tsx';

/** Loads App with VITE_MOCK=1 (the flag is read at module load). */
async function mockApp(): Promise<typeof AppType> {
  vi.stubEnv('VITE_MOCK', '1');
  vi.resetModules();
  return (await import('../src/App.tsx')).App;
}

const proxy = {
  id: 484511,
  name: 'Homeworlds Planetary Qualifier',
  startDate: null,
  statusText: null,
  rounds: [{ id: 1, name: 'Round 1', started: true, completed: true, kind: 'swiss' }],
  standingsConfig: {},
  fetchedAt: new Date().toISOString(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.pushState(null, '', '/');
});

describe('App (VITE_MOCK=1)', () => {
  it('renders the player analysis with verdict, scenarios and the cut line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/tournaments/') ? proxy : {}), { status: 200 })),
    );
    window.history.pushState(null, '', '/t/484511/p/p6');
    const App = await mockApp();
    render(<App />);
    expect(await screen.findByTestId('verdict')).toBeInTheDocument();
    expect(screen.getAllByText('ID SAFE').length).toBeGreaterThan(0);
    expect(screen.getByText('Draw (ID)')).toBeInTheDocument();
    expect(screen.getAllByText('CUT · TOP 8').length).toBeGreaterThan(0);
    expect(screen.getByText(/unofficial fan-made tool/)).toBeInTheDocument();
  });

  it('links the footer to the privacy page, which renders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    window.history.pushState(null, '', '/');
    const App = await mockApp();
    render(<App />);
    const link = screen.getByRole('link', { name: 'Privacy' });
    expect(link).toHaveAttribute('href', '/privacy');
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByText(/No cookies/)).toBeInTheDocument();
    expect(screen.getByText(/local storage/)).toBeInTheDocument();
  });

  it('shows the not-found state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_found', message: 'x' }), { status: 404 })));
    window.history.pushState(null, '', '/t/1');
    vi.resetModules();
    const { App } = await import('../src/App.tsx');
    render(<App />);
    expect(await screen.findByText('Tournament not found')).toBeInTheDocument();
  });
});
