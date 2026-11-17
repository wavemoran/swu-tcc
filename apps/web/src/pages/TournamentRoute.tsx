import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Tournament } from '@swu-tcc/core';
import { Layout } from '../Layout.tsx';
import { ApiError } from '../data/api.ts';
import { standingsFor } from '../data/load.ts';
import { useAnalysis, useTournament } from '../hooks.ts';
import { Link, navigate, playerPath, tournamentPath } from '../router.tsx';
import { getLastPlayer, setLastPlayer } from '../storage.ts';
import { EventHeader } from '../components/EventHeader.tsx';
import { NextOpponent } from '../components/NextOpponent.tsx';
import { PlayerSearch } from '../components/PlayerSearch.tsx';
import { Scenarios } from '../components/Scenarios.tsx';
import { StandingsTable, nearRanks } from '../components/StandingsTable.tsx';
import { SyncPill } from '../components/SyncPill.tsx';
import { Verdict } from '../components/Verdict.tsx';
import { WhatIf } from '../components/WhatIf.tsx';
import type { WhatIfValue } from '../components/WhatIf.tsx';
import { Loading, ManualLink, Notice, SectionLabel } from '../components/ui.tsx';

export function describeError(e: ApiError): { title: string; body: string; manual: boolean } {
  switch (e.kind) {
    case 'not_found':
      return { title: 'Tournament not found', body: 'Melee.gg has no tournament with that number. Check the link and try again.', manual: false };
    case 'bad_request':
      return { title: 'That link did not work', body: 'The tournament number looks wrong. Paste the link from the Melee.gg tournament page.', manual: false };
    case 'upstream_error':
      return {
        title: 'Melee blocked the request',
        body: 'Melee.gg did not answer this time, or it is refusing automated requests. Try again in a minute, or enter the standings by hand.',
        manual: true,
      };
    case 'not_authorized':
      return {
        title: "This tournament isn't available to SWU TCC yet",
        body: "Melee.gg only shares tournaments with accounts that have staff access, and SWU TCC doesn't have access to this one yet. You can still enter the standings by hand.",
        manual: true,
      };
    case 'rate_limited':
      return { title: 'Too many requests', body: 'Give it a minute, then refresh. Melee.gg limits how often we can ask.', manual: false };
    case 'disabled':
      return { title: 'Live import is switched off', body: 'Importing from Melee.gg is paused right now. You can still enter standings by hand.', manual: true };
    case 'network':
      return { title: 'You appear to be offline', body: 'We could not reach the server. Check your connection and try again.', manual: false };
    default:
      return { title: 'Something went wrong', body: e.message || 'Unexpected error while loading this tournament.', manual: true };
  }
}

export function TournamentRoute({ id, playerId }: { id: string; playerId?: string }) {
  const { state, refreshing, refresh } = useTournament(id);
  const mock = state.status === 'ready' && state.loaded.mock;

  return (
    <Layout mock={mock}>
      {state.status === 'loading' && (
        <Loading label="Fetching standings from Melee.gg" progress={{ done: state.done, total: state.total }} />
      )}
      {state.status === 'error' && <ErrorView error={state.error} onRetry={refresh} />}
      {state.status === 'empty' && (
        <>
          <h1 className="event-name">{state.loaded.proxy.name}</h1>
          <Notice tone="info" title="No rounds have started yet">
            <p>Standings appear once round 1 is paired. Check back after the first pairings are posted.</p>
            <p className="mono-note">{state.loaded.proxy.statusText ?? ''}</p>
          </Notice>
          <div className="actions">
            <button type="button" className="btn primary" onClick={refresh} disabled={refreshing}>
              Check again
            </button>
          </div>
        </>
      )}
      {state.status === 'ready' && (
        <Ready
          id={id}
          playerId={playerId}
          tournament={state.loaded.tournament}
          mock={state.loaded.mock}
          fetchedAt={state.loaded.fetchedAt}
          refreshing={refreshing}
          onRefresh={refresh}
        />
      )}
    </Layout>
  );
}

function ErrorView({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const d = describeError(error);
  return (
    <Notice
      title={d.title}
      actions={
        <>
          <button type="button" className="btn primary" onClick={onRetry}>
            Try again
          </button>
          {d.manual && <ManualLink />}
          <Link to="/" className="btn ghost">
            Use another link
          </Link>
        </>
      }
    >
      <p>{d.body}</p>
      {error.message && error.message !== d.body && <p className="mono-note">{error.message}</p>}
    </Notice>
  );
}

interface ReadyProps {
  id: string;
  playerId?: string;
  tournament: Tournament;
  mock: boolean;
  fetchedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}

function Ready(p: ReadyProps) {
  return (
    <>
      <div className="head-row">
        <EventHeader t={p.tournament} />
        <SyncPill fetchedAt={p.fetchedAt} onRefresh={p.onRefresh} refreshing={p.refreshing} mock={p.mock} />
      </div>
      {p.playerId ? <PlayerView {...p} playerId={p.playerId} /> : <StandingsView {...p} />}
    </>
  );
}

function StandingsView({ id, tournament, mock }: ReadyProps) {
  const rows = useMemo(() => standingsFor(tournament, mock), [tournament, mock]);
  const [remembered] = useState(() => getLastPlayer(id));
  const selected = tournament.players.find((pl) => pl.id === remembered)?.id ?? null;
  const [picked, setPicked] = useState<string | null>(selected);
  const pickedName = tournament.players.find((pl) => pl.id === picked)?.name;

  const choose = (pid: string) => {
    setPicked(pid);
    setLastPlayer(id, pid);
  };

  return (
    <>
      <section className="block" aria-labelledby="find-h">
        <h2 id="find-h" className="section-label">
          <SectionLabel>find yourself</SectionLabel>
        </h2>
        <PlayerSearch players={tournament.players} selectedId={picked} onSelect={choose} />
      </section>

      {rows.length === 0 ? (
        <Notice tone="info" title="No standings yet">
          <p>Round 1 has not finished. Standings will show up after the first results are in.</p>
        </Notice>
      ) : (
        <section className="block" aria-labelledby="stand-h">
          <h2 id="stand-h" className="section-label">
            <SectionLabel>standings</SectionLabel>
          </h2>
          <StandingsTable
            rows={rows}
            topCut={tournament.topCut}
            selectedId={picked}
            hrefFor={(pid) => playerPath(id, pid)}
            caption={`Swiss standings for ${tournament.name}`}
          />
        </section>
      )}

      {picked && (
        <div className="action-bar">
          <Link to={playerPath(id, picked)} className="btn primary block-btn" onClick={() => setLastPlayer(id, picked)}>
            Analyze {pickedName} <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      )}
    </>
  );
}

function PlayerView({ id, playerId, tournament, mock }: ReadyProps & { playerId: string }) {
  const player = tournament.players.find((pl) => pl.id === playerId);
  const completed = tournament.rounds.filter((r) => r.status === 'completed').length;
  const defaults: WhatIfValue = { topCut: tournament.topCut, swissRounds: tournament.swissRounds };
  const [whatIf, setWhatIf] = useState<WhatIfValue>(defaults);
  const options = useMemo(
    () => ({
      playerId,
      ...(whatIf.topCut !== defaults.topCut ? { topCut: whatIf.topCut } : {}),
      ...(whatIf.swissRounds !== defaults.swissRounds ? { swissRounds: whatIf.swissRounds } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playerId, whatIf, defaults.topCut, defaults.swissRounds],
  );
  const result = useAnalysis(tournament, mock, options);

  useEffect(() => {
    if (player) setLastPlayer(id, playerId);
  }, [id, playerId, player]);

  if (!player) {
    return (
      <Notice
        title="Player not found"
        actions={
          <Link to={tournamentPath(id)} className="btn primary">
            Pick your name
          </Link>
        }
      >
        <p>That player is not in this tournament.</p>
      </Notice>
    );
  }

  const analysis = result.analysis;
  return (
    <>
      <div className="player-head">
        <Link to={tournamentPath(id)} className="btn ghost back">
          <ArrowLeft size={18} aria-hidden="true" /> Standings
        </Link>
        <h2 className="player-name">{player.name}</h2>
        <button type="button" className="linklike" onClick={() => navigate(tournamentPath(id))}>
          Change player
        </button>
      </div>

      {result.status === 'error' && (
        <Notice title="Could not run the analysis">
          <p>{result.message}</p>
        </Notice>
      )}
      {result.status === 'loading' && !analysis && <Loading label="Running the numbers" />}
      {analysis && (
        <div className="analysis" aria-busy={result.status === 'loading'} data-stale={result.status === 'loading' || undefined}>
          <Verdict analysis={analysis} />
          <Scenarios analysis={analysis} />
          <NextOpponent analysis={analysis} />
          <WhatIf value={whatIf} defaults={defaults} minRounds={Math.max(1, completed)} onChange={setWhatIf} />
          <section className="block" aria-labelledby="near-h">
            <h2 id="near-h" className="section-label">
              <SectionLabel>standings near you</SectionLabel>
            </h2>
            <StandingsTable
              rows={analysis.currentStandings}
              topCut={analysis.topCut}
              selectedId={playerId}
              onlyRanks={nearRanks(analysis.currentStandings, playerId, analysis.topCut)}
              hrefFor={(pid) => playerPath(id, pid)}
              caption="Standings near you and near the cut line"
            />
          </section>
        </div>
      )}
    </>
  );
}
