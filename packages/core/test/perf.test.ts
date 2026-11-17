import { expect, it } from 'vitest';
import { analyze, computeStandings } from '../src/index.ts';
import { synthetic } from './synthetic.ts';

it('128-player final-round analysis finishes well under 300 ms', () => {
  const t = synthetic(128, 6, { swissRounds: 7, topCut: 8, seed: 3 });
  const rows = computeStandings(t);
  const focus = rows[7]!.playerId; // on the bubble
  analyze(t, { playerId: focus }); // warm up
  const t0 = performance.now();
  const a = analyze(t, { playerId: focus });
  const ms = performance.now() - t0;
  console.log(`128 players final round: ${ms.toFixed(1)} ms`, a.scenarios.map((s) => s.probability), a.method);
  expect(ms).toBeLessThan(300);
});

it('128-player two-round analysis (Monte Carlo)', () => {
  const t = synthetic(128, 5, { swissRounds: 7, topCut: 8, seed: 3 });
  const rows = computeStandings(t);
  const focus = rows[7]!.playerId;
  const t0 = performance.now();
  const a = analyze(t, { playerId: focus });
  const ms = performance.now() - t0;
  console.log(`128 players two rounds: ${ms.toFixed(1)} ms`, a.method);
  expect(a.scenarios).toHaveLength(9);
});
