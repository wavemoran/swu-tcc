import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, computeStandings } from '../src/index.ts';
import type { Analysis, Match, Outcome, PastedStandings, PastedVariant, Scenario, Tournament } from '../src/index.ts';
import { analyzePastedAll, DEFAULT_PASTED_VARIANT } from '../src/pasted.ts';
import { PASTED_ID_SAFE_THRESHOLD } from '../src/analyze.ts';
import { FULL_FIXTURES, fixtureTournament, readJson, swissRoundIds } from './helpers.ts';

/**
 * Backtest of paste mode: rewind each real event to the end of the
 * second-to-last Swiss round, reduce it to what a player could copy from
 * Melee's standings page (and, optionally, the posted final pairings), and
 * compare `analyzePasted` with full-data `analyze` and with what happened.
 * Regenerate docs/research/backtest-pasted.md with
 * BACKTEST_WRITE=1 npx vitest run test/backtest-pasted.test.ts (in packages/core).
 */

const WINDOW = 4;
const SEED = 20261116;
const SIMS = 2000;
const DOC = fileURLToPath(new URL('../../../docs/research/backtest-pasted.md', import.meta.url));
const RECO = fileURLToPath(new URL('./backtest-pasted.recommendation.md', import.meta.url));
const VARIANTS: PastedVariant[] = ['A', 'B', 'C'];
const OUTS: Outcome[] = ['win', 'draw', 'loss'];

type PairMode = 'predicted' | 'posted';
interface Cfg {
  pairing: PairMode;
  games: boolean;
}
const CFGS: Cfg[] = [
  { pairing: 'predicted', games: true },
  { pairing: 'posted', games: true },
  { pairing: 'predicted', games: false },
  { pairing: 'posted', games: false },
];
const cfgName = (c: Cfg) => `${c.pairing}${c.games ? '' : ', no game record'}`;

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

/** Same un-drop logic as backtest.test.ts: players with a final-round match were not dropped before it. */
function snapshot(full: Tournament, mode: PairMode): Tournament {
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
    rounds.push({ ...finalRound, status: 'in-progress', matches: finalRound.matches.map((m) => ({ ...m, result: null })) });
  }
  return { ...full, players, rounds };
}

const REC = (s: string): { wins: number; losses: number; draws: number } => {
  const [w, l, d] = s.split('-').map(Number);
  return { wins: w!, losses: l!, draws: d! };
};
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** What the player would copy from Melee's standings page after round `last - 1`. */
function pasteFor(full: Tournament, id: string, cfg: Cfg): PastedStandings {
  const last = full.rounds.length;
  const snap = snapshot(full, 'predicted');
  const dropped = new Map(snap.players.map((p) => [p.id, p.dropped]));
  const names = new Map(full.players.map((p) => [p.id, p.name]));
  const rows = (readJson(`standings-${swissRoundIds(id)[last - 2]}.json`, id).data as any[]).map((r) => {
    const pid = String(r.Team.ID);
    return {
      rank: r.Rank as number,
      name: names.get(pid)!,
      points: r.Points as number,
      record: REC(r.MatchRecord),
      ...(cfg.games ? { games: REC(r.GameRecord) } : {}),
      omw: r4(r.OpponentMatchWinPercentage),
      gw: r4(r.TeamGameWinPercentage),
      ogw: r4(r.OpponentGameWinPercentage),
      dropped: dropped.get(pid) === true,
    };
  });
  const finalRound = full.rounds[last - 1]!;
  const out: PastedStandings = { topCut: full.topCut, swissRounds: last, roundsPlayed: last - 1, rows };
  if (cfg.pairing === 'posted') {
    out.nextRound = finalRound.matches.map((m) => ({ a: names.get(m.a)!, b: m.b ? names.get(m.b)! : null }));
  }
  return out;
}

/** Did `pid` finish inside the cut if their final match had ended as `o` and every other result were as played? */
function counterfactual(full: Tournament, pid: string, o: Outcome): boolean {
  const last = full.rounds.length;
  const snap = snapshot(full, 'predicted');
  const rounds = full.rounds.map((r, i) =>
    i < last - 1
      ? r
      : {
          ...r,
          matches: r.matches.map((m) => {
            if (m.a !== pid && m.b !== pid) return m;
            const mine = o === 'win' ? 2 : 0;
            const theirs = o === 'loss' ? 2 : 0;
            const draws = o === 'draw' ? 3 : 0;
            const aWins = m.a === pid ? mine : theirs;
            const bWins = m.a === pid ? theirs : mine;
            return { ...m, result: { kind: 'games' as const, aWins, bWins, draws } };
          }),
        },
  );
  const t = { ...snap, rounds };
  const dropped = new Set(t.players.filter((p) => p.dropped).map((p) => p.id));
  const active = computeStandings(t, last).filter((r) => !dropped.has(r.playerId));
  return active.findIndex((r) => r.playerId === pid) + 1 <= full.topCut && !dropped.has(pid);
}

interface Sc {
  p: number;
  cert: Scenario['certainty'];
  status: Scenario['status'];
}
const sc = (a: Analysis, o: Outcome): Sc => {
  const s = a.scenarios.find((x) => x.outcomes[0] === o)!;
  return { p: s.probability, cert: s.certainty, status: s.status };
};

interface Rec {
  fixture: string;
  pid: string;
  name: string;
  rank: number;
  bye: boolean;
  actual: Outcome;
  made: boolean;
  cf: Record<Outcome, boolean>;
  full: Record<PairMode, Record<Outcome, Sc>>;
  pasted: Array<{ cfg: Cfg; v: Record<PastedVariant, Record<Outcome, Sc>> }>;
}

interface IdRec {
  fixture: string;
  a: string;
  b: string;
  rankA: number;
  rankB: number;
  bothMade: [boolean, boolean];
}

const recs: Rec[] = [];
const ids: IdRec[] = [];
let cfMismatch = 0;
let cfChecked = 0;
const fixtureInfo: Array<{ id: string; players: number; swiss: number; topCut: number; analyzed: number }> = [];

function run(id: string): void {
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
  const nameOf = new Map(full.players.map((p) => [p.id, p.name]));
  if (new Set(full.players.map((p) => p.name)).size !== full.players.length) throw new Error(`duplicate names in ${id}`);
  const pastes = CFGS.map((cfg) => ({ cfg, input: pasteFor(full, id, cfg) }));
  const snaps = { predicted: snapshot(full, 'predicted'), posted: snapshot(full, 'posted') };

  for (const pid of focus) {
    const m = matchOf.get(pid)!;
    const actual = outcomeOf(m, pid)!;
    const bye = m.b === null;
    const cf = { win: counterfactual(full, pid, 'win'), draw: counterfactual(full, pid, 'draw'), loss: counterfactual(full, pid, 'loss') };
    cfChecked++;
    if (!bye && cf[actual] !== made(pid)) cfMismatch++;
    const fullA = {
      predicted: analyze(snaps.predicted, { playerId: pid, seed: SEED, simulations: SIMS }),
      posted: analyze(snaps.posted, { playerId: pid, seed: SEED, simulations: SIMS }),
    };
    const rec: Rec = {
      fixture: id,
      pid,
      name: nameOf.get(pid)!,
      rank: rankBefore.get(pid)!,
      bye,
      actual,
      made: made(pid),
      cf,
      full: {
        predicted: Object.fromEntries(OUTS.map((o) => [o, sc(fullA.predicted, o)])) as Record<Outcome, Sc>,
        posted: Object.fromEntries(OUTS.map((o) => [o, sc(fullA.posted, o)])) as Record<Outcome, Sc>,
      },
      pasted: [],
    };
    for (const { cfg, input } of pastes) {
      const all = analyzePastedAll(input, { playerName: nameOf.get(pid)!, seed: SEED, simulations: SIMS });
      rec.pasted.push({
        cfg,
        v: Object.fromEntries(VARIANTS.map((v) => [v, Object.fromEntries(OUTS.map((o) => [o, sc(all[v], o)]))])) as Rec['pasted'][number]['v'],
      });
    }
    recs.push(rec);
  }
  for (const m of finalRound.matches) {
    if (!m.b || !isId(m)) continue;
    ids.push({ fixture: id, a: m.a, b: m.b, rankA: rankBefore.get(m.a)!, rankB: rankBefore.get(m.b)!, bothMade: [made(m.a), made(m.b)] });
  }
  fixtureInfo.push({ id, players: full.playerCount, swiss: last, topCut: full.topCut, analyzed: focus.length });
}

for (const id of FULL_FIXTURES) run(id);

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const BINS: Array<[number, number]> = [
  [0, 0.1],
  [0.1, 0.3],
  [0.3, 0.5],
  [0.5, 0.7],
  [0.7, 0.9],
  [0.9, 1.0000001],
];
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);
const f4 = (x: number) => x.toFixed(4);

interface Pt {
  p: number;
  y: boolean;
}
const brier = (pts: Pt[]) => (pts.length === 0 ? 0 : pts.reduce((s, x) => s + (x.p - (x.y ? 1 : 0)) ** 2, 0) / pts.length);

function reliability(pts: Pt[]): string[] {
  const out = ['| Predicted | Scenarios | Mean predicted | Made the cut |', '|---|---|---|---|'];
  for (const [lo, hi] of BINS) {
    const b = pts.filter((r) => r.p >= lo && r.p < hi);
    if (b.length === 0) continue;
    const mean = b.reduce((s, r) => s + r.p, 0) / b.length;
    const hit = b.filter((r) => r.y).length;
    out.push(`| ${(lo * 100).toFixed(0)}% to ${Math.min(hi, 1) * 100}% | ${b.length} | ${(mean * 100).toFixed(1)}% | ${hit} (${pct(hit, b.length)}) |`);
  }
  return out;
}

const forCfg = (c: Cfg) => (r: Rec) => r.pasted.find((x) => x.cfg.pairing === c.pairing && x.cfg.games === c.games)!;

/** Probability of the scenario that actually happened vs whether the player made the cut. */
function actualPts(c: Cfg, v: PastedVariant): Pt[] {
  return recs.map((r) => ({ p: forCfg(c)(r).v[v][r.actual].p, y: r.made }));
}
/** All three scenarios of every player vs the counterfactual outcome (others' real results fixed). */
function cfPts(c: Cfg, v: PastedVariant): Pt[] {
  return recs.flatMap((r) => OUTS.filter((o) => !(r.bye && o !== 'win')).map((o) => ({ p: forCfg(c)(r).v[v][o].p, y: r.cf[o] })));
}
function fullActualPts(mode: PairMode): Pt[] {
  return recs.map((r) => ({ p: r.full[mode][r.actual].p, y: r.made }));
}
function fullCfPts(mode: PairMode): Pt[] {
  return recs.flatMap((r) => OUTS.filter((o) => !(r.bye && o !== 'win')).map((o) => ({ p: r.full[mode][o].p, y: r.cf[o] })));
}

function certBad(c: Cfg, v: PastedVariant): { cert: number; imp: number; bad: number } {
  let cert = 0;
  let imp = 0;
  let bad = 0;
  for (const r of recs)
    for (const o of OUTS) {
      const s = forCfg(c)(r).v[v][o];
      if (r.bye && o !== 'win') continue;
      if (s.cert === 'certain') {
        cert++;
        if (!r.cf[o]) bad++;
      } else if (s.cert === 'impossible') {
        imp++;
        if (r.cf[o]) bad++;
      }
    }
  return { cert, imp, bad };
}

/** Actual-outcome version of the hard check (spec item a). */
function certBadActual(c: Cfg, v: PastedVariant): number {
  return recs.filter((r) => {
    const s = forCfg(c)(r).v[v][r.actual];
    return (s.cert === 'certain' && !r.made) || (s.cert === 'impossible' && r.made);
  }).length;
}

interface Danger {
  rec: Rec;
  p: number;
  fullP: number;
  actualDrew: boolean;
}
/** Pasted draw scenario >= 0.9 but a draw would have missed the cut. */
function dangerous(c: Cfg, v: PastedVariant): Danger[] {
  const out: Danger[] = [];
  for (const r of recs) {
    if (r.bye) continue;
    const s = forCfg(c)(r).v[v].draw;
    if (s.p >= 0.9 && !r.cf.draw) out.push({ rec: r, p: s.p, fullP: r.full[c.pairing].draw.p, actualDrew: r.actual === 'draw' });
  }
  return out;
}
function fullDangerous(mode: PairMode): Rec[] {
  return recs.filter((r) => !r.bye && r.full[mode].draw.p >= 0.9 && !r.cf.draw);
}
const safeCount = (c: Cfg, v: PastedVariant) => recs.filter((r) => !r.bye && forCfg(c)(r).v[v].draw.p >= 0.9).length;

interface Agree {
  statusMatch: number;
  total: number;
  dp: Record<Outcome, number>;
  n: number;
}
function agreement(c: Cfg, v: PastedVariant): Agree {
  const a: Agree = { statusMatch: 0, total: 0, dp: { win: 0, draw: 0, loss: 0 }, n: 0 };
  for (const r of recs) {
    if (r.bye) continue;
    a.n++;
    for (const o of OUTS) {
      const p = forCfg(c)(r).v[v][o];
      const f = r.full[c.pairing][o];
      a.total++;
      if (p.status === f.status) a.statusMatch++;
      a.dp[o] += Math.abs(p.p - f.p);
    }
  }
  return a;
}

function report(reco: string): string {
  const L: string[] = [];
  L.push('# Backtest of paste mode', '');
  L.push(reco.trim(), '');
  L.push('## Method', '');
  L.push(
    'Generated by `packages/core/test/backtest-pasted.test.ts` (`BACKTEST_WRITE=1 npx vitest run test/backtest-pasted.test.ts` in `packages/core`). Each of the 8 full fixtures is rewound to the end of the second-to-last Swiss round and reduced to what a player could copy from Melee\'s standings page: rank, name, points, match record, game record, OMW, GW, OGW (rounded to 2 decimal places of a percent, as displayed) and dropped status (as of that round, with the same un-drop logic as `backtest.test.ts`). Four input shapes are tried: final pairings **predicted** (no `nextRound`) or **posted** (`nextRound` taken from the real final-round matches, no results), each with and without the game record column.',
    '',
    `The player set is the existing backtest's: within ${WINDOW} ranks of the cut line plus every real final-round IDer (${recs.length} players over 8 events). Seed ${SEED}, ${SIMS} simulations (the final round is enumerated, so the seed rarely matters).`,
    '',
    'Truth. Two yardsticks: (1) **actual**: the probability of the scenario matching what the player really did, against whether they finished in the cut per Melee; (2) **counterfactual**: for all three scenarios of each player, the final standings recomputed by the full engine with the player\'s match replaced by a win, draw or loss and every other real result left as played. (2) triples the data and is the only way to judge the draw scenario for players who did not draw. The counterfactual reproduces the real outcome for the actual scenario in ' +
      `${cfChecked - cfMismatch} of ${cfChecked} players (byes excluded from the mismatch check count as matches).`,
    '',
    'Tiebreaker variants (see `packages/core/src/pasted.ts`): **A** OMW/OGW frozen as pasted, GW updated from the simulated games when a game record is present; **B** A plus an estimate of how the final round moves OMW/OGW, `OMW\' = (k*(OMW*n+0.5)/(n+1) + pct(q))/(k+1)`; **C** players tied on points after the round are ordered by current rank with a logistic coin-flip margin (scale 2 ranks). `certain`/`impossible` are proven from points alone in every variant.',
    '',
  );

  L.push('## Hard check: certain and impossible', '');
  L.push('| Input | Variant | Certain | Impossible | Wrong (counterfactual, all 3 scenarios) | Wrong (actual outcome only) |', '|---|---|---|---|---|---|');
  for (const c of CFGS)
    for (const v of VARIANTS) {
      const x = certBad(c, v);
      L.push(`| ${cfgName(c)} | ${v} | ${x.cert} | ${x.imp} | ${x.bad} | ${certBadActual(c, v)} |`);
    }
  L.push('');

  L.push('## Calibration', '');
  L.push('Brier score (lower is better; 0.25 is a coin flip). "Actual" has one scenario per player; "counterfactual" has up to three. The full-data engine is the benchmark.', '');
  L.push('| Input | Variant | Brier, actual | Brier, counterfactual | Draw scenario only, counterfactual |', '|---|---|---|---|---|');
  const drawPts = (c: Cfg, v: PastedVariant): Pt[] => recs.filter((r) => !r.bye).map((r) => ({ p: forCfg(c)(r).v[v].draw.p, y: r.cf.draw }));
  for (const mode of ['predicted', 'posted'] as const)
    L.push(
      `| full data, ${mode} | n/a | ${f4(brier(fullActualPts(mode)))} | ${f4(brier(fullCfPts(mode)))} | ${f4(brier(recs.filter((r) => !r.bye).map((r) => ({ p: r.full[mode].draw.p, y: r.cf.draw }))))} |`,
    );
  for (const c of CFGS)
    for (const v of VARIANTS) L.push(`| pasted, ${cfgName(c)} | ${v} | ${f4(brier(actualPts(c, v)))} | ${f4(brier(cfPts(c, v)))} | ${f4(brier(drawPts(c, v)))} |`);
  L.push('');
  for (const c of [CFGS[0]!, CFGS[1]!]) {
    for (const v of VARIANTS) {
      L.push(`### Reliability, pasted ${cfgName(c)}, variant ${v} (counterfactual, all scenarios)`, '', ...reliability(cfPts(c, v)), '');
    }
  }
  L.push('### Reliability, full data (counterfactual, all scenarios, both pairing modes)', '', ...reliability([...fullCfPts('predicted'), ...fullCfPts('posted')]), '');

  L.push('## Agreement with full mode', '');
  L.push('Same pairing knowledge on both sides (pasted predicted vs full predicted, pasted posted vs full posted). Status match is over all three scenarios of every player with a real table (no byes); mean |difference in probability| is per scenario.', '');
  L.push('| Input | Variant | Status match | Mean abs diff win | draw | loss |', '|---|---|---|---|---|---|');
  for (const c of CFGS)
    for (const v of VARIANTS) {
      const a = agreement(c, v);
      L.push(`| ${cfgName(c)} | ${v} | ${pct(a.statusMatch, a.total)} | ${f4(a.dp.win / a.n)} | ${f4(a.dp.draw / a.n)} | ${f4(a.dp.loss / a.n)} |`);
    }
  L.push('');

  L.push('## Dangerous errors: pasted says the draw is safe (>= 90%) but a draw would have missed the cut', '');
  L.push('A draw scenario at 90% or more (including proven) while the counterfactual draw, with every other real result fixed, misses the cut. "Said safe" is how often the pasted draw scenario was at least 90% for a player with a real table. The last column is the same error from the full-data engine.', '');
  L.push('| Input | Variant | Said safe | Dangerous | of which actually drew and missed | Full-data engine, same pairing mode |', '|---|---|---|---|---|---|');
  for (const c of CFGS)
    for (const v of VARIANTS) {
      const d = dangerous(c, v);
      L.push(`| ${cfgName(c)} | ${v} | ${safeCount(c, v)} | ${d.length} | ${d.filter((x) => x.actualDrew).length} | ${fullDangerous(c.pairing).length} |`);
    }
  L.push('');
  const listed = new Set<string>();
  const dl: string[] = [];
  for (const c of CFGS.slice(0, 2))
    for (const v of VARIANTS)
      for (const d of dangerous(c, v)) {
        const k = `${d.rec.fixture}/${d.rec.pid}/${cfgName(c)}/${v}`;
        if (listed.has(k)) continue;
        listed.add(k);
        dl.push(`| ${d.rec.fixture} | ${d.rec.name} | ${d.rec.rank} | ${cfgName(c)} | ${v} | ${(d.p * 100).toFixed(1)}% | ${(d.fullP * 100).toFixed(1)}% | ${d.actualDrew ? 'yes' : 'no'} | ${d.rec.made ? 'in' : 'out'} |`);
      }
  if (dl.length) {
    L.push('Every dangerous case with the game record present:', '', '| Fixture | Player | Rank before | Input | Variant | Pasted draw | Full-data draw | Actually drew | Final result |', '|---|---|---|---|---|---|---|---|---|', ...dl, '');
  } else L.push('No dangerous cases with the game record present.', '');

  L.push('## Safe-draw threshold sensitivity', '');
  L.push('Pasted draw scenario at or above a threshold, split by whether points alone prove it (`certain`) or it is an estimate that rests on approximate tiebreakers. Counts are players with a real table, over the two game-record inputs (predicted and posted) together.', '');
  L.push('| Variant | Proven by points | Proven, wrong | Estimated >= 90% | wrong | >= 95% | wrong | >= 97% | wrong | >= 99% | wrong |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const v of VARIANTS) {
    const cells: Sc[][] = [];
    const all: Array<{ s: Sc; ok: boolean }> = [];
    for (const c of [CFGS[0]!, CFGS[1]!]) for (const r of recs) if (!r.bye) all.push({ s: forCfg(c)(r).v[v].draw, ok: r.cf.draw });
    void cells;
    const proven = all.filter((x) => x.s.cert === 'certain');
    const row = [`${proven.length}`, `${proven.filter((x) => !x.ok).length}`];
    for (const t of [0.9, 0.95, 0.97, 0.99]) {
      const e = all.filter((x) => x.s.cert === 'estimated' && x.s.p >= t);
      row.push(`${e.length}`, `${e.filter((x) => !x.ok).length}`);
    }
    L.push(`| ${v} | ${row.join(' | ')} |`);
  }
  L.push('');
  L.push('## Real final-round IDs (0-0-3)', '');
  L.push('First player of each pair. Pasted columns use the game record. Draw scenario: probability and status. "Both made it" is each player\'s final Melee rank within the cut; the last column is the counterfactual for the first player.', '');
  const fmt = (x: Sc) => `${(x.p * 100).toFixed(1)}% ${x.status}${x.cert === 'estimated' ? '' : ` (${x.cert})`}`;
  const defV = DEFAULT_PASTED_VARIANT;
  L.push(`| Fixture | Ranks | Full, predicted | Full, posted | Pasted ${defV}, predicted | Pasted ${defV}, posted | Pasted A, posted | Pasted B, posted | Both made it |`, '|---|---|---|---|---|---|---|---|---|');
  for (const i of ids) {
    const r = recs.find((x) => x.fixture === i.fixture && x.pid === i.a);
    if (!r) continue;
    const g = (c: Cfg, v: PastedVariant) => fmt(forCfg(c)(r).v[v].draw);
    L.push(
      `| ${i.fixture} | ${i.rankA} and ${i.rankB} | ${fmt(r.full.predicted.draw)} | ${fmt(r.full.posted.draw)} | ${g(CFGS[0]!, defV)} | ${g(CFGS[1]!, defV)} | ${g(CFGS[1]!, 'A')} | ${g(CFGS[1]!, 'B')} | ${i.bothMade[0] && i.bothMade[1] ? 'yes' : `no (${i.bothMade.map((b) => (b ? 'in' : 'out')).join(', ')})`} |`,
    );
  }
  L.push('');
  L.push('## Per fixture', '');
  L.push('| Fixture | Players | Swiss | Cut | Players analyzed | Brier actual, full posted | Brier actual, pasted posted (default variant) |', '|---|---|---|---|---|---|---|');
  for (const f of fixtureInfo) {
    const sub = recs.filter((r) => r.fixture === f.id);
    const b1 = brier(sub.map((r) => ({ p: r.full.posted[r.actual].p, y: r.made })));
    const b2 = brier(sub.map((r) => ({ p: forCfg(CFGS[1]!)(r).v[defV][r.actual].p, y: r.made })));
    L.push(`| ${f.id} | ${f.players} | ${f.swiss} | ${f.topCut} | ${f.analyzed} | ${f4(b1)} | ${f4(b2)} |`);
  }
  L.push('');
  return L.join('\n');
}

describe('backtest of paste mode', () => {
  it('prints the report', () => {
    const reco = existsSync(RECO) ? readFileSync(RECO, 'utf8') : '## Recommendation\n\n(pending)';
    const text = report(reco);
    console.log(text);
    if (process.env.BACKTEST_WRITE) writeFileSync(DOC, text);
    expect(recs.length).toBeGreaterThan(0);
  });

  it('every certain scenario made the cut and every impossible one missed (actual and counterfactual)', () => {
    for (const c of CFGS)
      for (const v of VARIANTS) {
        expect(certBad(c, v).bad, `${cfgName(c)} ${v}`).toBe(0);
        expect(certBadActual(c, v), `${cfgName(c)} ${v}`).toBe(0);
      }
  });

  it('every variant is better calibrated than a coin flip', () => {
    for (const c of CFGS) for (const v of VARIANTS) expect(brier(actualPts(c, v))).toBeLessThan(0.25);
  });

  it('with the 95% paste-mode bar, the default variant never calls an estimated ID SAFE that misses', () => {
    for (const c of CFGS) {
      const bad = recs.filter((r) => {
        if (r.bye) return false;
        const d = forCfg(c)(r).v[DEFAULT_PASTED_VARIANT].draw;
        return d.p >= PASTED_ID_SAFE_THRESHOLD && !r.cf.draw;
      });
      expect(bad.map((r) => `${r.fixture} ${r.name}`), JSON.stringify(c)).toEqual([]);
    }
  });

  it('the counterfactual reproduces the real outcome', () => {
    expect(cfMismatch).toBe(0);
  });
});
