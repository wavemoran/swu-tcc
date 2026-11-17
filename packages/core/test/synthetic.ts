import type { Match, Round, Tournament } from '../src/index.ts';

/** Deterministic tiny PRNG for building synthetic events. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A random Swiss event with `roundsDone` completed rounds (no posted next round). */
export function synthetic(n: number, roundsDone: number, opts: { seed?: number; swissRounds: number; topCut: number }): Tournament {
  const rnd = lcg(opts.seed ?? 7);
  const ids = Array.from({ length: n }, (_, i) => String(1000 + i));
  const pts = new Map(ids.map((id) => [id, 0]));
  const played = new Map(ids.map((id) => [id, new Set<string>()]));
  const hadBye = new Set<string>();
  const rounds: Round[] = [];
  for (let r = 1; r <= roundsDone; r++) {
    const order = [...ids].sort((a, b) => pts.get(b)! - pts.get(a)! || rnd() - 0.5);
    const matches: Match[] = [];
    let byeId: string | null = null;
    if (order.length % 2 === 1) {
      byeId = [...order].reverse().find((p) => !hadBye.has(p)) ?? order[order.length - 1]!;
      order.splice(order.indexOf(byeId), 1);
    }
    let table = 1;
    while (order.length > 1) {
      const a = order.shift()!;
      let k = order.findIndex((b) => !played.get(a)!.has(b));
      if (k < 0) k = 0;
      const b = order.splice(k, 1)[0]!;
      played.get(a)!.add(b);
      played.get(b)!.add(a);
      const x = rnd();
      let result: Match['result'];
      if (x < 0.07) {
        result = { kind: 'games', aWins: 0, bWins: 0, draws: 3 };
        pts.set(a, pts.get(a)! + 1);
        pts.set(b, pts.get(b)! + 1);
      } else if (x < 0.53) {
        result = { kind: 'games', aWins: 2, bWins: rnd() < 0.5 ? 0 : 1, draws: 0 };
        pts.set(a, pts.get(a)! + 3);
      } else {
        result = { kind: 'games', aWins: rnd() < 0.5 ? 0 : 1, bWins: 2, draws: 0 };
        pts.set(b, pts.get(b)! + 3);
      }
      matches.push({ table: table++, a, b, result });
    }
    if (byeId) {
      hadBye.add(byeId);
      pts.set(byeId, pts.get(byeId)! + 3);
      matches.push({ table: null, a: byeId, b: null, result: { kind: 'bye' } });
    }
    rounds.push({ number: r, status: 'completed', matches });
  }
  return {
    id: 'synthetic',
    source: 'manual',
    name: 'Synthetic',
    startDate: null,
    playerCount: n,
    swissRounds: opts.swissRounds,
    topCut: opts.topCut,
    players: ids.map((id) => ({ id, name: `P${id}`, dropped: false })),
    rounds,
    scoring: { win: 3, draw: 1, loss: 0, percentageFloor: 1 / 3 },
    fetchedAt: null,
  };
}
