# Tiebreaker validation against Melee (eight fixtures)

Result: **exact match on all eight full fixtures** (484511, 493469, 464438, 484355, 465966, 505142, 504384, 504989; 47 Swiss rounds in total, 12 to 70 players, including a Limited-format event). No new convention or special case was needed. `computeStandings(t, n)` reproduces Melee's `Rank`, `Points`, `MatchRecord`, `GameRecord`, OMW%, TGW% and OGW% (to 4 decimal places) for every player in `standings-<roundId>.json`, for every Swiss round of each event. The test is parametrized over the fixtures and is `packages/core/test/tiebreakers.test.ts`.

## Conventions confirmed

- **Points** 3/1/0. A bye is a match win (3 points, 1-0-0).
- **Bye game record is 2-0-0.** It counts in the player's own game record and TGW% (Round 1: the bye player shows `2-0-0`, TGW 1.0).
- **Byes are not opponents.** They are left out of everyone's OMW%/OGW% opponent list.
- **A forfeit with no opponent** is a match loss with an empty game record (`0-0-0`). It still counts as a match played, so match-win% is 0, floored to 1/3.
- **Percentages:** `max(1/3, points / (3 * count))`, for both match win% and game win% (game points are 3 per win, 1 per draw). OMW%/OGW% average each opponent's floored value, and an opponent counts once per match played against them. Dropped opponents count with the record they have.
- **An ID is 0-0-3** (three drawn games), as recorded by Melee. Game win% includes the draws.
- **Sort:** points, OMW%, TGW%, OGW%, then Melee team id ascending.

## One Melee quirk

A player with no opponents at all (Round 1 bye) gets OMW% and OGW% of **0.3333** (truncated), not 0.3333333. In Round 1 Melee ranks this player behind everyone else tied on 3 points, 2-0, OMW 1/3 and OGW 1/3, even though their team id is lower. We reproduce this by using the floor truncated to four decimals when a player has no opponents (`tiebreaks()` in `src/ledger.ts`). It only matters in round 1 (a bye player always has opponents from round 2 on, because byes are not repeated).

## Added coverage from the seven newer fixtures

Byes in later rounds, several dropped players, odd and even fields, 4 to 7 Swiss rounds, a 12-player event, and Limited format all matched with the same rules. The 498211 fixture (Baltimore, 484 players, Day 2) is page-only and not validated.

## Not covered by the fixtures

- Players who dropped mid-event and kept playing in the data: dropped players are present in the fixture and match.
- Multiple byes for one player (the fixture has one player with two: round 1 forfeit and round 3 bye; both match).
- Melee's behaviour for a player with only forfeit matches is not exercised beyond the case above.
