import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeStandings } from '../src/index.ts';
import type { Match, Outcome, Scenario, Tournament } from '../src/index.ts';
import { finalRoundPairing } from '../src/pairing.ts';
import { FULL_FIXTURES, fixtureTournament, readJson, swissRoundIds } from './helpers.ts';

/**
 * Backtest: rewind each real event to just before its final Swiss round and
 * compare what the engine said with what happened. Run with BACKTEST_WRITE=1
 * to regenerate docs/research/backtest.md.
 */

const WINDOW = 4; // ranks either side of the cut line
const SEED = 20261116;
const SIMS = 2000;
const DOC = fileURLToPath(new URL('../../../docs/research/backtest.md', import.meta.url));

type Mode = 'predicted' | 'posted';

function outcomeOf(m: Match, pid: string): Outcome | null {
  const r = m.result;
  if (!r) return null;
  if (r.kind === 'bye') return 'win';
  if (r.kind === 'forfeit') return 'loss';
  const mine = m.a === pid ? r.aWins : r.bWins;
  const theirs = m.a === pid ? r.bWins : r.aWins;
  return mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
}

function isId(m: Match): boolean {
  return m.result?.kind === 'games' && m.result.aWins === 0 && m.result.bWins === 0 && m.result.draws === 3;
}

/**
 * The event as it looked before the last round. Melee reports a player's status
 * as of capture, so a player who dropped after playing the final round is shown
 * as dropped; undo that (drops we can attribute to before the round are kept).
 */
function snapshot(full: Tournament, mode: Mode): Tournament {
  const last = full.rounds.length;
  const finalRound = full.rounds[last - 1]!;
  const played = new Set<string>();
  for (const m of finalRound.matches) {
    played.add(m.a);
    if (m.b) played.add(m.b);
  }
  const players = full.players.map((p) => ({ ...p, dropped: p.dropped && !played.has(p.id) }));
  const rounds = full.rounds.slice(0, last - 1);
  if (mode === 'posted') {
    rounds.push({
      ...finalRound,
      status: 'in-progress',
      matches: finalRound.matches.map((m) => ({ ...m, result: null })),
    });
  }
  return { ...full, players, rounds };
}

interface Row {
  fixture: string;
  mode: Mode;
  player: string;
  rankBefore: number;
  outcome: Outcome;
  probability: number;
  certainty: Scenario['certainty'];
  status: Scenario['status'];
  made: boolean;
}

interface PairingRow {
  fixture: string;
  player: string;
  predicted: string | null;
  actual: string | null;
}

interface IdRow {
  fixture: string;
  a: string;
  b: string;
  rankA: number;
  rankB: number;
  predicted: { probability: number; status: string; certainty: string } | null;
  posted: { probability: number; status: string; certainty: string } | null;
  bothMade: [boolean, boolean];
}

interface Result {
  id: string;
  players: number;
  swiss: number;
  topCut: number;
  analyzed: number;
  rows: Row[];
  pairing: PairingRow[];
  ids: IdRow[];
}

function backtest(id: string): Result {
  const full = fixtureTournament(id);
  const last = full.rounds.length;
  const finalRound = full.rounds[last - 1]!;
  const finalRows = readJson(`standings-${swissRoundIds(id)[last - 1]}.json`, id).data as any[];
  const finalRank = new Map(finalRows.map((r) => [String(r.Team.ID), r.Rank as number]));
  const made = (p: string) => (finalRank.get(p) ?? Infinity) <= full.topCut;
  const matchOf = new Map<string, Match>();
  for (const m of finalRound.matches) {
    matchOf.set(m.a, m);
    if (m.b) matchOf.set(m.b, m);
  }

  const before = computeStandings(snapshot(full, 'predicted'), last - 1);
  const rankBefore = new Map(before.map((r) => [r.playerId, r.rank]));
  const idPlayers = new Set<string>();
  for (const m of finalRound.matches) if (m.b && isId(m)) idPlayers.add(m.a).add(m.b);
  const focus = before
    .filter((r) => !r.dropped && matchOf.has(r.playerId) && (Math.abs(r.rank - full.topCut - 0.5) <= WINDOW + 0.5 || idPlayers.has(r.playerId)))
    .map((r) => r.playerId);

  const rows: Row[] = [];
  const pairing: PairingRow[] = [];
  const byPlayer = new Map<string, Partial<Record<Mode, Scenario | undefined>>>();
  for (const mode of ['predicted', 'posted'] as const) {
    const snap = snapshot(full, mode);
    for (const pid of focus) {
      const m = matchOf.get(pid)!;
      const o = outcomeOf(m, pid)!;
      const a = analyze(snap, { playerId: pid, seed: SEED, simulations: SIMS });
      const sc = a.scenarios.find((s) => s.outcomes[0] === o)!;
      rows.push({
        fixture: id,
        mode,
        player: pid,
        rankBefore: rankBefore.get(pid)!,
        outcome: o,
        probability: sc.probability,
        certainty: sc.certainty,
        status: sc.status,
        made: made(pid),
      });
      byPlayer.set(pid, { ...byPlayer.get(pid), [mode]: a.scenarios.find((s) => s.outcomes[0] === 'draw') });
      if (mode === 'predicted') {
        const actual = m.b === null ? null : m.a === pid ? m.b : m.a;
        pairing.push({ fixture: id, player: pid, predicted: a.nextOpponent?.playerId ?? null, actual });
      }
    }
  }

  const ids: IdRow[] = [];
  for (const m of finalRound.matches) {
    if (!m.b || !isId(m)) continue;
    const pick = (s: Scenario | undefined) => (s ? { probability: s.probability, status: s.status, certainty: s.certainty } : null);
    ids.push({
      fixture: id,
      a: m.a,
      b: m.b,
      rankA: rankBefore.get(m.a)!,
      rankB: rankBefore.get(m.b)!,
      predicted: pick(byPlayer.get(m.a)?.predicted),
      posted: pick(byPlayer.get(m.a)?.posted),
      bothMade: [made(m.a), made(m.b)],
    });
  }
  return { id, players: full.playerCount, swiss: last, topCut: full.topCut, analyzed: focus.length, rows, pairing, ids };
}

const results = FULL_FIXTURES.map(backtest);
const allRows = results.flatMap((r) => r.rows);
const allPairing = results.flatMap((r) => r.pairing);

const BINS: Array<[number, number]> = [
  [0, 0.1],
  [0.1, 0.3],
  [0.3, 0.5],
  [0.5, 0.7],
  [0.7, 0.9],
  [0.9, 1.0000001],
];

function brier(rows: Row[]): number {
  return rows.length === 0 ? 0 : rows.reduce((s, r) => s + (r.probability - (r.made ? 1 : 0)) ** 2, 0) / rows.length;
}

function reliability(rows: Row[]): string[] {
  const out = ['| Predicted | Scenarios | Mean predicted | Made the cut |', '|---|---|---|---|'];
  for (const [lo, hi] of BINS) {
    const b = rows.filter((r) => r.probability >= lo && r.probability < hi);
    if (b.length === 0) continue;
    const mean = b.reduce((s, r) => s + r.probability, 0) / b.length;
    const hit = b.filter((r) => r.made).length;
    out.push(`| ${(lo * 100).toFixed(0)}% to ${Math.min(hi, 1) * 100}% | ${b.length} | ${(mean * 100).toFixed(1)}% | ${hit} (${((hit / b.length) * 100).toFixed(1)}%) |`);
  }
  return out;
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);
const pairHit = (rows: PairingRow[]) => rows.filter((r) => r.predicted === r.actual).length;

function report(): string {
  const L: string[] = [];
  L.push('# Backtest against real events', '');
  L.push(
    'Generated by `packages/core/test/backtest.test.ts` (`BACKTEST_WRITE=1 npx vitest run test/backtest.test.ts` in `packages/core`). Each full fixture is rewound to the end of the second-to-last Swiss round, in two ways: **predicted** (final-round pairings not posted, so the engine predicts them from standings, CEG 10.4) and **posted** (final pairings known, no results). For every player within ' +
      `${WINDOW} ranks of the cut line, and every player who actually ID'd the final round, the engine is run and compared with what happened: the pairing it predicted vs the real opponent, and the probability of the scenario matching the player's **actual** result vs whether they finished in the top cut per Melee's final Swiss standings.`,
    '',
    `Seed ${SEED}, ${SIMS} simulations (the final round is enumerated exhaustively, so the seed only affects the rare Monte Carlo fallback).`,
    '',
    'Melee reports a player\'s status as of capture, so someone who dropped after playing the final round shows as dropped; the backtest undoes that for players who have a final-round match. Players who dropped before the final round stay dropped.',
    '',
  );
  L.push('## Summary', '');
  L.push('| Fixture | Players | Swiss | Cut | Players analyzed | Pairing accuracy (analyzed) | Pairing accuracy (all) | Brier predicted | Brier posted |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const analyzedHits = pairHit(r.pairing);
    const all = fieldPairing.get(r.id)!;
    L.push(
      `| ${r.id} | ${r.players} | ${r.swiss} | ${r.topCut} | ${r.analyzed} | ${pct(analyzedHits, r.pairing.length)} (${analyzedHits}/${r.pairing.length}) | ${pct(all.hit, all.total)} (${all.hit}/${all.total}) | ${brier(r.rows.filter((x) => x.mode === 'predicted')).toFixed(4)} | ${brier(r.rows.filter((x) => x.mode === 'posted')).toFixed(4)} |`,
    );
  }
  const ah = pairHit(allPairing);
  const fh = [...fieldPairing.values()].reduce((s, x) => s + x.hit, 0);
  const ft = [...fieldPairing.values()].reduce((s, x) => s + x.total, 0);
  L.push(
    `| **All** | | | | ${allPairing.length} | **${pct(ah, allPairing.length)}** (${ah}/${allPairing.length}) | ${pct(fh, ft)} (${fh}/${ft}) | ${brier(allRows.filter((x) => x.mode === 'predicted')).toFixed(4)} | ${brier(allRows.filter((x) => x.mode === 'posted')).toFixed(4)} |`,
    '',
  );
  const cert = allRows.filter((r) => r.certainty === 'certain');
  const imp = allRows.filter((r) => r.certainty === 'impossible');
  L.push(
    `Certain scenarios: ${cert.length}, of which ${cert.filter((r) => r.made).length} made the cut. Impossible scenarios: ${imp.length}, of which ${imp.filter((r) => !r.made).length} missed. Any difference is a bug.`,
    '',
    '## Reliability (all fixtures, both modes)',
    '',
    ...reliability(allRows),
    '',
  );
  for (const mode of ['predicted', 'posted'] as const) {
    L.push(`### ${mode === 'predicted' ? 'Predicted pairings' : 'Posted pairings'}`, '', ...reliability(allRows.filter((r) => r.mode === mode)), '');
  }
  L.push(
    '## Findings',
    '',
    '- **Bug found and fixed: stranded rematches.** The first run predicted a rematch in fixtures 464438 and 465966 (greedy 1v2, 3v4, ... left the last two players, who had already met). Melee re-pairs higher up instead (for example 20v26 and 21v23 rather than 20v21 and 23v26). `pairByStandings` now backtracks, so the top player takes the highest-ranked opponent for whom everyone below can still be paired without a rematch. Whole-field accuracy went from 295/307 to 303/307. Regression tests are in `pairing.test.ts`.',
    '- **Unexplained deviation: 493469 (Leon, 12 players).** Melee paired ranks 2v5 and 4v6; CEG 10.4 gives 2v4 and 5v6 (nobody had met, ranks 4 and 5 both on 6 points). Both pairings cost the same in points, so Melee is probably using a matching algorithm with its own tie-break. It is the only event with this pattern, it affects four players, and every one of them was proven in or out either way, so it is not special-cased.',
    '- Every scenario the engine proved certain made the cut and every one it proved impossible missed (counts above).',
    '',
    '## Per fixture',
    '',
  );
  for (const r of results) {
    L.push(`### ${r.id} (${r.players} players, ${r.swiss} Swiss rounds, top ${r.topCut})`, '');
    L.push(...reliability(r.rows), '');
    const wrong = r.pairing.filter((p) => p.predicted !== p.actual);
    if (wrong.length) L.push(`Mispredicted pairings among analyzed players: ${wrong.length} of ${r.pairing.length}.`, '');
  }
  L.push('## Real final-round IDs (0-0-3)', '');
  L.push('Engine view of the draw scenario for the first player of each pair, before the round. Rank is the rank going into the final round. "Both made it" is each player\'s final Swiss rank within the cut.', '');
  L.push('| Fixture | Ranks | Predicted pairings | Posted pairings | Both made it |', '|---|---|---|---|---|');
  const fmt = (x: IdRow['predicted']) => (x ? `${(x.probability * 100).toFixed(1)}% ${x.status}${x.certainty === 'estimated' ? '' : ` (${x.certainty})`}` : 'n/a');
  for (const r of results)
    for (const i of r.ids) L.push(`| ${i.fixture} | ${i.rankA} and ${i.rankB} | ${fmt(i.predicted)} | ${fmt(i.posted)} | ${i.bothMade[0] && i.bothMade[1] ? 'yes' : `no (${i.bothMade.map((b) => (b ? 'in' : 'out')).join(', ')})`} |`);
  L.push('');
  return L.join('\n');
}

// Whole-field pairing accuracy (not just the players near the cut).
const fieldPairing = new Map<string, { hit: number; total: number }>();
for (const id of FULL_FIXTURES) {
  const full = fixtureTournament(id);
  const snap = snapshot(full, 'predicted');
  const actual = new Map<string, string | null>();
  for (const m of full.rounds.at(-1)!.matches) {
    actual.set(m.a, m.b);
    if (m.b) actual.set(m.b, m.a);
  }
  const pred = new Map<string, string | null>();
  for (const m of finalRoundPairingFor(snap)) {
    pred.set(m.a, m.b);
    if (m.b) pred.set(m.b, m.a);
  }
  let hit = 0;
  for (const [p, o] of actual) if (pred.get(p) === o) hit++;
  fieldPairing.set(id, { hit, total: actual.size });
}
function finalRoundPairingFor(t: Tournament): Match[] {
  return finalRoundPairing(t)!.matches;
}

describe('backtest on real events', () => {
  it('prints the report', () => {
    const text = report();
    console.log(text);
    if (process.env.BACKTEST_WRITE) writeFileSync(DOC, text);
    expect(allRows.length).toBeGreaterThan(0);
  });

  it('predicts the final-round opponent at least 90% of the time for players near the cut', () => {
    expect(pairHit(allPairing) / allPairing.length).toBeGreaterThanOrEqual(0.9);
  });

  it('every scenario marked certain made the cut, every impossible one missed', () => {
    const bad = allRows.filter((r) => (r.certainty === 'certain' && !r.made) || (r.certainty === 'impossible' && r.made));
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });

  it('is better calibrated than a coin flip', () => {
    expect(brier(allRows)).toBeLessThan(0.25);
  });
});
