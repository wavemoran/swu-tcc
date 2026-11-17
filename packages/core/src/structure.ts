/**
 * Rounds and top cut by attendance, from the Comprehensive Event Guide v1.5,
 * Appendix D (Constructed chart; the Limited chart only differs above 181).
 *
 *   9-16 -> 4 rounds, top 4      17-32 -> 5 rounds, top 8
 *   33-64 -> 6 rounds, top 8     65-128 -> 7 rounds, top 8
 *   129+ -> 7-9 rounds on Day 1 and a Day 2 (Top 32/64/128 or a point
 *           threshold). Out of scope (see MAX_SINGLE_DAY_PLAYERS); we return
 *           8 rounds / top 8 only so the numbers stay defined, and analyze()
 *           flags the result as not modeled.
 *   8 or fewer -> CEG gives 3 rounds and NO top cut. The contract needs a
 *           positive cut, so we ASSUME 3 rounds / top 4 (tiny events that
 *           still want a cut usually play a top 4).
 */
/**
 * Largest event SWU TCC models. Bigger events run a Day 2, which usually
 * qualifies players by a points threshold (for example, 6 match wins) rather
 * than a top-N cut. That is a different question, out of scope for now.
 */
export const MAX_SINGLE_DAY_PLAYERS = 128;

export function isSingleDayEvent(playerCount: number): boolean {
  return playerCount <= MAX_SINGLE_DAY_PLAYERS;
}

export function defaultStructure(playerCount: number): { swissRounds: number; topCut: number } {
  if (playerCount <= 8) return { swissRounds: 3, topCut: 4 };
  if (playerCount <= 16) return { swissRounds: 4, topCut: 4 };
  if (playerCount <= 32) return { swissRounds: 5, topCut: 8 };
  if (playerCount <= 64) return { swissRounds: 6, topCut: 8 };
  if (playerCount <= 128) return { swissRounds: 7, topCut: 8 };
  return { swissRounds: 8, topCut: 8 };
}
