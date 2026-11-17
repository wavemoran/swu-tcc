# SWU organized-play rules relevant to a Top-Cut / ID calculator

Sources (fetched 2026-11-16):
- **CEG** = Comprehensive Event Guide v1.5 (header says "Updated: 10/9/2026"), https://cdn.starwarsunlimited.com//Comprehensive_Event_Guide_v1_5_FINAL_8_2e86283787.pdf. Text extracted locally to `ceg.txt` in this scratchpad.
- **M-Standings** = Melee "Understanding Melee's Swiss, Top Cut Pairings and Standings". Despite its title it only covers tiebreakers. https://help.melee.gg/docs/understanding-melees-swiss-top-cut-pairings-and-standings/
- **M-TB-old** = Melee "Star Wars: Unlimited Tiebreakers". It is marked superseded: "Update 3/14/2025: SWU official tournament structure has changed", and it links to M-Standings. https://help.melee.gg/docs/star-wars-unlimited-tiebreakers/
- **M-Top8** = Melee "Custom Tournament Structure with a Top 8 – Setup Guide". This is the most important page for final-round pairing. https://help.melee.gg/docs/creating-a-tournament-with-a-top-8/
- **M-Status** = Melee "Player Status", https://help.melee.gg/docs/player-status/
- **M-PQ** = Melee "How to Create Your SWU Planetary Qualifier", https://help.melee.gg/docs/planetary-qualifier-setup-guide/
- Melee FAQ (https://help.melee.gg/docs/faq/) contains nothing relevant.

---

## 1. Match points, match format, game draws

- **Points: win = 3, draw = 1, loss = 0.** (CEG 5.4 #1; CEG App. B; M-Standings "Tiebreaker 1")
- **Byes give 3 match points** and count as a match win. (CEG 5.2.7; CEG 10.4: "treated as if they had won their match"; M-Standings: "Players receiving byes are considered to have won the match.")
- **Record format** is W-L-D. For example, "3-2-1" is 10 points out of 18 possible. (CEG App. B)
- **Bo3 vs Bo1:**
  - Best-of-three is used at **all Competitive-tier events**. Relaxed events may use Bo3. (CEG 5.2.2)
  - Single-game (Bo1) matches are "primarily" for Relaxed/Casual events, with no sideboarding. (CEG 5.2.1)
  - Time limits: Bo1 25 min, Bo3 55 min, top cut at least 75 min or untimed. (CEG 5.2.4, App. C)
  - Event tiers (CEG App. A): Galactic Championship = Master. Regional Championship Day 1 = Competitive, Day 2 = Master. Planetary Qualifier and Sector Qualifier = Competitive. Store Showdown = Relaxed (Competitive optional). Weekly Play and Prerelease = Relaxed.
  - All Championship Series events (PQ, SQ, RC, GC) are Competitive or Master. (CEG 2.3.3)
  - Competitive events "play full swiss rounds, followed by a cut to single elimination". (CEG 2.3.3) Relaxed events have no progression cuts. (CEG 5.1.3)
- **Drawn games:** a drawn game does not count toward the 2 wins needed. (CEG 5.2.2)
- **Unfinished matches at time** (CEG 5.2.6):
  1. When time is called, players finish the current game round, then play one additional action phase.
  2. If the game is still incomplete, that game is a **draw**.
  3. The player with more game wins in the match wins it. Equal game wins makes the **match a draw**. So 1-1-1, 0-0-1 and 1-1-0 at time are all match draws.
  4. No new game starts after time is called.
- **No draws in single elimination.** At time, the higher remaining base HP wins. If HP is tied, the player who had the initiative wins. If time ends between games, the player who would have had initiative wins. (CEG 5.2.6)
- **Historical note:** M-TB-old (pre-3/14/2025) ranked by "Match Wins", where "any match that concludes without a winner will account for 0 Match Wins for all players", and OMW counted wins only. That was **superseded**. Current rules are the 3/1/0 points above. Don't implement the old scheme.

## 2. Intentional draws (CEG 5.3, CEG 8.2)

- **Permitted**, but **only during Swiss rounds** and only by **mutual agreement**. If either player declines, the match is played normally. (CEG 5.3)
- No tier restriction is stated, so IDs are allowed at Relaxed, Competitive and Master alike.
- **Timing:** "Before playing any games of a match, if both players mutually wish..." the match "immediately ends". The next paragraph adds: "Players can intentionally draw at any point in the match." (CEG 5.3) CEG 8.2 says players may "concede or intentionally draw a game at any time before the end of the game, so long as there was no discussion."
- **Restrictions** (CEG 5.3, 8.2):
  - Players may **not refer to tournament standings after they have sat** for the match. **This matters for the tool: it is meant to be used BEFORE sitting down.**
  - No agreements made in conjunction with other matches.
  - Players may not leave their seats during the match or "go to great lengths to gain information".
  - No offering or accepting an ID or concession for any reward or incentive. That is Bribery/Collusion and leads to Disqualification.
  - A player may **ask for an ID or concession once per match**. Convincing or manipulating an opponent into one is cheating and leads to DQ.
  - Recommended practice: call a judge over when requesting.
  - "Asking an opponent to concede in any shape or form falls under collusion." Asking for a *draw* once is allowed.
  - Determining a result by random means (dice, etc.) or other non-game methods is prohibited. CEG 8.x "Illegally Determining a Result" covers determining a winner by any means other than playing, including ID and concession misuse.
- **Recording:** "The match immediately ends and is reported as a **0-0-3** draw for both players." (CEG 5.3)
  - Given the W-L-D convention (CEG App. B), 0-0-3 means **0 game wins, 0 game losses, 3 game draws**.
  - Game points for that match are 3 / 9 = **33.3%**, which sits exactly at the GW% floor. An ID therefore pulls the player's own GW% toward 33% and adds 9 possible game points.
  - Example: a player at 8-2 in games (24/30 = 80%) who IDs 0-0-3 drops to 27/39 = 69.2%. If the ID were recorded 0-0-1 instead, the result would be 25/33 = 75.8%.
  - Match result: 1 match point each, so it adds 1/3 to the MW% numerator and denominator.
  - Melee's docs do not say how the "intentional draw" button records games. The CEG says 0-0-3, so a calculator should default to 0-0-3 and maybe expose the game record as a setting.
  - An unofficial non-SWU source (RiftJudge, about the Riftbound game) says ID game counts vary. Ignore it for SWU.

## 3. Rounds and top cut by attendance (CEG Appendix D)

- **Round count** is fixed by the number of players registered and present at the **start of round 1**. Late adds don't change it.
- The chart is **required for Official Competitive and Master events** and optional for Relaxed and unofficial events.
- **Design goal:** the fewest Swiss rounds such that "all players with no more than **one match loss** qualify for top cut (single-day)", or **two losses** for multi-day events.
- Top cuts happen only at Competitive events and **must occur**, so Competitive events need at least 9 players.
- **Day 2 cut:** "The Top X players or players with the minimum required match points (whichever number of players is greater)" advance.
- Melee's "Swiss Plus Top Cut" structure auto-calculates the number of rounds "upon matching round 1". (M-PQ)

**Constructed Tournament Rounds Chart**

| Players | Day 1 Swiss | Day 2 cut | Day 2 Swiss | Top cut |
|---|---|---|---|---|
| 3-4 | 2 | – | – | none |
| 5-8 | 3 | – | – | none |
| 9-16 | 4 | – | – | 4 |
| 17-32 | 5 | – | – | 8 |
| 33-64 | 6 | – | – | 8 |
| 65-128 | 7 | – | – | 8 |
| 129-181 | 7 | Top 32 or 15 pts | 3 | 8 |
| 182-310 | 7 | Top 32 or 15 pts | 4 | 8 |
| 311-540 | 8 | Top 64 or 18 pts | 4 | 8 |
| 541-640 | 9 | Top 64 or 21 pts | 4 | 8 |
| 641-952 | 9 | Top 128 or 21 pts | 4 | 8 |
| 953+ | 9 | Top 128 or 21 pts | 5 | 8 |

**Limited Tournament Rounds Chart**

| Players | Day 1 Swiss | Day 2 cut | Day 2 Swiss | Top cut |
|---|---|---|---|---|
| 3-4 | 2 | – | – | none |
| 5-8 | 3 | – | – | none |
| 9-16 | 4 | – | – | 4 |
| 17-32 | 5 | – | – | 8 |
| 33-64 | 6 | – | – | 8 |
| 65-128 | 7 | – | – | 8 |
| 129-181 | 7 | Top 32 or 15 pts | 3 | 8 |
| 182-311 | 8 | Top 32 or 18 pts | 3 | 8 |
| 312-949 | 8 | Top 64 or 18 pts | 5 | 8 |
| 950+ | 8 | Top 64 or 18 pts | 6 | 8 |

Footnote: a 9-16 player Limited event with a Booster Draft top cut plays "one fewer round of swiss (four instead of five)" and cuts to top 8 instead of top 4. That conflicts with the table, which already lists 4 rounds for 9-16, so the footnote looks like a stale v1.x leftover. Treat it as "3 rounds, top 8" or let the user override.

- The Day 2 cut threshold examples are worth noting: 15 pts after 7 rounds is 5-2, 18 pts is 6-x, and 21 pts after 9 rounds is 7-2.
- The guide has **no separate per-tier chart** (Store Showdown vs PQ vs SQ vs RC). The same chart applies to every Official Competitive/Master event.
- A Store Showdown run as Relaxed doesn't need a cut. If it's run Competitive, the chart applies.
- The calculator should let the user override rounds and cut size.

## 4. Tiebreakers: exact order and formulas

Order (CEG 5.4; M-Standings):
1. **Match Points** (3/1/0)
2. **OMW%**: Opponents' Match-Win %
3. **GW%**: player's Game-Win %. Melee calls it "TGW" or "TMW" (Team/Player Game-Win %).
4. **OGW%**: Opponents' Game-Win %

**Head-to-head is NOT a tiebreaker.** After OGW the guide specifies nothing further. Melee presumably falls back to something arbitrary or random, but this isn't documented.

Formulas (CEG App. B; M-Standings):
- `MW%(p) = max(0.33, matchPoints(p) / (3 * matchesPlayed(p)))`
  - Melee's text says "lower than 0.33%" for the MW floor. That's a typo for 33%: CEG 5.4 says 33%, and the old Melee page says 33.33%.
  - Use **1/3** (33.33%). The CEG says "33%"; the difference is negligible but could break exact ties.
- `OMW%(p) = mean over p's opponents o of MW%(o)`. It's a simple average, not weighted.
- `GW%(p) = max(0.33, gamePoints(p) / (3 * gamesPlayed(p)))`
  - Game points: win = 3, draw = 1, loss = 0. "Total possible points are all finished games * 3."
  - The floor applies to GW% everywhere, including the player's own GW% (CEG 5.4: "If a player's match win percentage or game win percentage is ever lower than 33%, it will become 33%").
- `OGW%(p) = mean over opponents o of GW%(o)` (with o's floor applied)

**Not documented anywhere for SWU** (assumed MTG/Wizards-style behavior, so verify against real Melee standings):
- **Byes:** MTG excludes byes from the opponent list for OMW/OGW. Whether a bye counts as 2-0 in games for GW% isn't stated for SWU. CEG only says a bye is "3 match points" and "treated as if they had won".
- **Dropped opponents:** under the standard approach, a dropped opponent still counts in OMW/OGW using their record at the time they dropped (matches actually played). Neither CEG nor Melee says this explicitly.
- **Rounding:** Melee displays percentages, presumably rounded. Treat near-ties as uncertain.

## 5. Swiss pairing rules

**CEG 5.1.1:** players are paired with opponents with the same record "as much as possible while also preventing players from facing the same opponent more than once". Rematch avoidance is a hard goal.

**CEG 10.4 (Calculating Pairings):**
- Round 1 is random.
- Later rounds are random **within the same points group**. Start from the top group. If the group is odd, the leftover player is **paired down against a random player from the next group**, then the rest of that group is paired randomly, and so on down.
- Melee "will handle this process for you".
- The exact Melee algorithm (e.g. weighted matching) is not published.

**FINAL SWISS ROUND IS NOT RANDOM** when there is a single-elimination cut (CEG 10.4; M-Top8):
- CEG: "for the final round of swiss, players are paired against the player closest to their rank that they have not yet played against. This means that the first place player will play against second, third against fourth and so forth." Melee does this automatically "as long as the single elimination phase is created before the first round of swiss is paired".
- Melee (M-Top8): "The final round of Swiss will be '**Power Paired**'. Power pairings involve 1st seed playing against the 2nd seed if possible. If not, due to playing previously, they will instead be paired against the 3rd seed. This logic cascades until all players are paired and will be the same every time it is calculated." It is **deterministic, by current standings including tiebreakers**.
- Implication: the final-round pairings can be **predicted from standings after round N-1**: 1v2, 3v4, ..., skipping rematches. Better still, the real pairings are posted before players sit, and the tool can take them as input.
- For **two final rounds** (an ID in rounds N-1 and N), only the last round is power-paired. Round N-1 is random within points groups.
- If the event wasn't set up with a playoffs phase before round 1, the final round falls back to normal random-within-bracket pairing. The tool should support both modes.

**Byes:**
- Odd player count: round 1 bye goes to a random player.
- Later rounds: the bye goes to the "lowest-ranked player who has not yet received a bye" (CEG 10.4). CEG 5.2.7 instead says "a random player with the fewest match points who has not already received a bye".
- Either way, the bye goes to the bottom of the standings, so it's irrelevant to top-cut contenders except as a +3 to a bottom player.
- Melee sometimes produces multiple byes when there are too many rounds for the player count ("Troubleshooting: Multiple Byes in the Final Rounds").

**Top cut bracket:** 1v8, 2v7, 3v6, 4v5. The 1/8 winner plays the 4/5 winner. (CEG 10.5; M-Top8) The higher seed chooses initiative in game 1 (CEG 5.2.5 6c). This matters for "ID vs play for seed" advice.

## 6. Drops

- Players may drop at any time and must notify the scorekeeper before the next round is paired. Dropping before round 1 means the player doesn't appear in final standings. (CEG 5.13)
- If a player drops **after the cut**, no replacement is advanced. (CEG 5.13) In single elimination, their opponent gets a bye. (CEG 10.5)
- Dropping in exchange for a reward is bribery. (CEG 5.13)
- Melee statuses (M-Status) include Active, Dropped (Self/Staff), No Show ("equivalent to a Dropped player"), Disqualified, Cut, Eliminated, and Qualified (auto-bye each subsequent round, used for point-threshold qualification). **Dropped, No Show and Disqualified players "will not be paired".**
- **Can a dropped player make top cut?** Not stated explicitly.
  - In practice the cut is taken from active players, and dropped players stay in the standings with their final record.
  - The calculator should **exclude dropped players** from the set of rivals, but **keep their records in their opponents' OMW/OGW**.
  - A drop before the cut effectively moves everyone below them up one spot.
- A dropped player is never paired again, so their points are frozen. Remove them from the "can still reach X" count.

## 7. Melee-specific notes

- Standings columns:
  - The help pages use the names **Match Points, OMW (Opponents' Match-Win %), TGW/TMW (Team/Player Game-Win %), OGW**.
  - The live Melee standings table (from general familiarity, not from these docs, so verify) shows: Rank, Player, Points (Match Points), Match Record (W-L-D), Game Record, OMW, TGW (or GW), OGW.
  - Expect to parse "W-L-D" strings and percentage strings.
- Swiss and top cut are separate "phases". "Swiss Plus Top Cut" auto-computes rounds at round 1, and power-pairing of the last Swiss round depends on the Playoffs phase existing. (M-PQ, M-Top8)
- Result entry supports Bo3 scores including draws. Players report their own results, and the opponent doesn't confirm. (Melee "Submitting & Correcting Match Results", "Reporting Your Own Match Result")

---

## Math implications: is ID safe?

**Setup.** N players, R rounds, cut size K. The user stands at P points before the final round. ID gives T = P + 1. Example: 52 players means 6 rounds and top 8. A 4-1 player (12 pts) with an ID finishes at 13 (4-1-1).

**Step 1: classify every other active player by their reachable final points.** Each player has a current total p_i and r rounds left, so they can finish anywhere from p_i up to p_i + 3r. Count these groups:
- **A** = players who finish above T no matter what (p_i > T already). They are definitely ahead.
- **B** = players who **can** finish strictly above T. Players who can end exactly at T are in a tiebreak race. Note that 13 is only reachable from 12 (draw) or 10 (win). 13 is not reachable from 11, because 11+3 = 14.
- Players who cannot reach T are irrelevant.

**Step 2: apply pairing constraints.** Players who play each other can't both win. With a known (power-paired) final round, use the actual pairings. For each match (x, y), the outcomes are x wins (+3/+0), y wins (+0/+3), or a draw/ID (+1/+1). Worst case for the user: pick outcomes per match to **maximize the number of players finishing strictly above T**, then the number tied at T. Matches are independent given the pairings, so this is a per-match maximization:
- Two players at P (e.g. 12 v 12): a win puts **one** player at 15, above T. An ID puts **both** at 13, tied with T. So each such match yields either 1 player above T, or 2 players tied at T.
- 15 v 15: both already above T.
- 12 v 10: the 12 wins to reach 15 (above), or the 10 wins to reach 13 (tied), or a draw gives 13 and 11 (one tied).
- A player at 10 paired down against 7: can win and reach 13 (tied).

Worst-case rank = 1 + (number guaranteed above) + max(players above + players tied at T that the tiebreakers lose to). The user is **mathematically safe** if, even in the worst case, the number of players strictly above T plus the number at T who could out-tiebreak them is at most K - 1.

**Step 3: tiebreaker risk at exactly T.** Players who end on T are ranked by OMW, then GW, then OGW.
- The user's ID lowers their own GW% (a 0-0-3 adds 3/9) but does not change their OMW much (the opponent gets +1 draw).
- OMW also shifts in the final round because the user's earlier opponents play their own final matches. Exact tiebreak outcomes can't be known in advance, so model it either worst-case (assume every tied player beats the user) or estimate (compare current OMW, or simulate final-round outcomes).
- A rough heuristic is that OMW gaps of several percentage points rarely flip in one round.

**Step 4: simulate or enumerate.** For an exact answer with known pairings, enumerate 3^(#relevant matches) outcomes. Prune matches where neither player can reach T. Report:
- **(a) guaranteed** (top K in all outcomes)
- **(b) guaranteed on points but tiebreak-dependent**
- **(c) at risk**

Optionally add a probability estimate, e.g. P(win) = 0.5, P(ID) based on whether both players are "ID-safe".

**Worked 52/6/Top-8 example (illustrative).**
- Typical standings after round 5: about 1-2 players at 15 (5-0), about 7-9 at 12 (4-1), plus a few draws.
- Under power pairing, the 15s play each other or the top 12s, and the 12s mostly play each other: 12v12 pairs.
- Suppose the user is the 3rd-ranked 12 and the field is: 2 at 15, 8 at 12 (user included), 6 at 10, rest lower.
  - After the user's ID with opponent X (also 12), both have 13.
  - The 15s are above (2).
  - The remaining 6 other 12s form 3 matches. Worst case each produces a winner at 15, so 3 more above, totaling 5 above 13. Alternatively they all ID, giving 6 more at 13.
  - The 10s (6 of them) in 10v10 or 10v12 matches can produce up to 3 at 13 (10v10 winners), or more if paired down against lower players.
  - Worst case on points is 5 above, plus X, plus 3 to 6 others at 13. The user is then competing for 3 slots (positions 6-8) among a 13-point pile of size 5-8, so it is **tiebreak-dependent, not guaranteed**.
  - If instead only ~5 players were at 12 or higher entering the round, 13 would be guaranteed on points.
- General rule of thumb (from the CEG design goal): with the chart's round counts, **X-1 (one loss) always makes a single-day top cut if everyone plays it out**. An X-1 with an ID (X-1-1) is usually safe when ranked near the top of the X-1 bracket but must be checked against the count of players who can reach T+ and tiebreakers.
- In the last round, the top 2 (often at P+3 or more) can usually ID safely. At the P bracket, it depends on how many P-players there are relative to the remaining cut slots.
