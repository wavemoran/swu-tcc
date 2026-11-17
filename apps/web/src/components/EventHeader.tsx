import { isSingleDayEvent, MAX_SINGLE_DAY_PLAYERS, type Tournament } from '@swu-tcc/core';

export function EventHeader({ t, topCut, swissRounds }: { t: Tournament; topCut?: number; swissRounds?: number }) {
  const started = t.rounds.filter((r) => r.status !== 'not-started').length;
  const done = t.rounds.filter((r) => r.status === 'completed').length;
  const meta = [
    `${t.playerCount} PLAYERS`,
    `SWISS ${swissRounds ?? t.swissRounds}`,
    `TOP ${topCut ?? t.topCut}`,
    started > done ? `ROUND ${started} LIVE` : `${done} ROUND${done === 1 ? '' : 'S'} DONE`,
  ];
  const date = t.startDate ? new Date(t.startDate) : null;
  return (
    <header className="event">
      <h1 className="event-name">{t.name}</h1>
      <p className="event-meta tcc-num">{meta.join(' · ')}</p>
      {date && !Number.isNaN(date.getTime()) && (
        <p className="event-meta tcc-num">
          <time dateTime={t.startDate ?? undefined}>
            {date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase()}
          </time>
        </p>
      )}
      {!isSingleDayEvent(t.playerCount) && (
        <p className="event-notice" role="note">
          Day 2 events aren't supported yet. Events over {MAX_SINGLE_DAY_PLAYERS} players usually qualify for Day 2 by
          match points (for example, 6 wins), not by a top cut, so the numbers below are only a rough guide.
        </p>
      )}
    </header>
  );
}
