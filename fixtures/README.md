# Fixtures

Raw responses saved from public Melee.gg endpoints, used as test data. Each
tournament has a `raw/` folder holding exactly what Melee returned:

- `tournament.html`: `GET /Tournament/View/{id}`
- `standings-config.json`: `GET /Standing/GetStandingsConfig/{id}`
- `standings-{roundId}.json`: `POST /Standing/GetRoundStandings` (`draw=1&start=0&length=-1&roundId=…`)
- `matches-{roundId}.json`: `POST /Match/GetRoundMatches/{roundId}` (`draw=1&start=0&length=-1`)

## Index

Captured with `tools/capture-melee-site.sh [--page-only] <id>...` (polite, one request at a time; skips files already saved). Core tests load any of them by id (`packages/core/test/helpers.ts`).

| Id | Event | Players | Swiss | Cut | Notes |
|---|---|---|---|---|---|
| 484511 | PQ Redwood City, US | 52 | 6 | 8 | The reference case: Player 003 (6th at 12 points, ID'd, finished 7th). |
| 493469 | PQ Leon, MX | 12 | 4 | 8 | Played a top 8 (four quarterfinals) with only 12 players. CompetitiveHub wrongly lists it as top 4 and CEG App. D says top 4 for 9-16 players, so the cut must come from Melee's playoff round names. |
| 464438 | PQ Ridgeland, US | 26 | 5 | 8 | Greedy final-round pairing stranded a rematch here (fixed by backtracking). |
| 484355 | PQ Lisboa, PT | 33 | 6 | 8 | |
| 465966 | PQ Seattle, US | 63 | 6 | 8 | Same stranded-rematch case as 464438. |
| 505142 | PQ Tustin, US | 64 | 6 | 8 | Limited format. |
| 504384 | PQ Santiago, CL | 69 | 7 | 8 | |
| 504989 | PQ Villepinte, FR | 70 | 7 | 8 | |
| 498211 | SQ Baltimore, US | 484 | 12 | 8 | `tournament.html` only (Day 2 event, out of scope). Used to test page parsing and the "Not modeled" assumption. |

## Pseudonymization

Fixtures hold no personal data. After every capture, run

```sh
node --experimental-strip-types tools/pseudonymize-fixtures.ts           # rewrite in place
node --experimental-strip-types tools/pseudonymize-fixtures.ts --check    # exit 1 if a file still needs it
```

before committing. It is deterministic and idempotent, and per tournament it:

- names players `Player 001`, `Player 002`, ... in order of their original Melee player id, everywhere they appear (standings, matches, result strings such as `Player 007 won 2-1-0`), and clears pronouns and profile image fields;
- remaps player ids and team ids to small integers with an order-preserving mapping, so the final tiebreaker (team id ascending) ranks players exactly as before (player ids become 1001+, team ids 5001+);
- replaces decklist ids with fake UUIDs and decklist names with `Decklist` (nothing reads them);
- leaves public event identifiers alone: tournament, round, phase, match and format ids, and `tournament.html` (the page template carries no player data).

Numbers are re-serialized (`5001.00000000` becomes `5001`), which parses to the same values.

Player status in the standings files is as of capture: most players show as dropped or eliminated after the event, so tests must not treat it as the status at the time of a round (the backtest, `docs/research/backtest.md`, accounts for this).

## 484511: Homeworlds Planetary Qualifier, Game Kastle Redwood City

52 players, 6 Swiss rounds, top 8. Captured 2026-11-16, after the event ended.
Round IDs: 1725211–1725215 (rounds 1–5), 1749836 (round 6, added during the
event), 1725216–1725218 (quarterfinals, semifinals, finals).

The reference case: **Player 003** was 6th at 4-1-0 (12 points) after round 5,
intentionally drew round 6 against Player 018, and finished 7th, inside
the top 8.

Player data is pseudonymized (see below), so players appear as `Player 001`
and so on.

## melee-api/ (not yet populated)

`tools/capture-melee-api.ts` writes raw responses from the official API to
`fixtures/melee-api/<tournamentId>/raw/`, one file per request
(`tournament-<id>.json`, `standing-list-round-<roundId>-p<page>.json`,
`match-list-round-<roundId>-p<page>.json`). These hold real player data and
the pseudonymizer does not cover them, so do not commit them.
