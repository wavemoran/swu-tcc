import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Status } from '@swu-tcc/core';
import { mockAnalyze, mockTournament, MOCK_STATE_PLAYERS } from '../src/data/mock.ts';
import { STATUS_LABEL } from '../src/format.ts';
import { Verdict } from '../src/components/Verdict.tsx';

const t = mockTournament();

describe('Verdict panel', () => {
  it.each(MOCK_STATE_PLAYERS.map((m) => [m.status, m.playerId] as [Status, string]))(
    'renders %s with its label and icon',
    (status, playerId) => {
      const { container } = render(<Verdict analysis={mockAnalyze(t, { playerId })} />);
      expect(screen.getByText(STATUS_LABEL[status])).toBeInTheDocument();
      expect(container.querySelector(`[data-status-icon="${status}"]`)).not.toBeNull();
      expect(screen.getByText('Assumptions')).toBeInTheDocument();
    },
  );

  it('never shows 100% for an estimated 0.999', () => {
    const a = mockAnalyze(t, { playerId: 'p6' });
    a.verdict = { ...a.verdict, probability: 0.999, certainty: 'estimated' };
    render(<Verdict analysis={a} />);
    expect(screen.getByTestId('verdict-pct')).toHaveTextContent('>99%');
    expect(screen.queryByText('100%')).toBeNull();
  });

  it('shows 100% when certain', () => {
    render(<Verdict analysis={mockAnalyze(t, { playerId: 'p1' })} />);
    expect(screen.getByTestId('verdict-pct')).toHaveTextContent('100%');
  });

  it('lists the assumptions and sample count', () => {
    render(<Verdict analysis={mockAnalyze(t, { playerId: 'p6' })} />);
    expect(screen.getByText(/Other tables are 50\/50/)).toBeInTheDocument();
    expect(screen.getAllByText(/5,000/).length).toBeGreaterThan(0);
  });
});
