# melee.gg data access for SWU TCC (research notes, 2026-11-16)

Legend: **[V]** = verified by an actual HTTP request today. **[I]** = inferred / not directly verified.

## TL;DR

- The **official API** (`/api/...`) needs **HTTP Basic auth with a client ID and secret**. melee.gg issues these **only to organizations and their staff**, by email to contact@melee.gg. Even then, you only get data for tournaments where you are at least Coverage Staff. **This won't work for a public "paste any URL" tool.**
- The **website's own JSON endpoints work without auth** [V]:
  - `POST /Standing/GetRoundStandings`: standings with full tiebreakers.
  - `POST /Match/GetRoundMatches/{roundId}`: pairings and results.
  - `GET /Standing/GetStandingsConfig/{tournamentId}`: scoring and tiebreaker config.
  - Round IDs come from scraping `GET /Tournament/View/{id}` HTML (`button.round-selector[data-id]`).
- **There is no CORS on any endpoint** [V]. A browser-only app can't read these responses, so **you need a server-side proxy** (serverless function or worker).
- **ToS** bans "any robot, spider, scraper, crawler or other automated means to access the Services". robots.txt sets `Crawl-Delay: 5` but does not disallow `/Tournament/View`, `/Standing/`, or `/Match/`. Using the unofficial endpoints is a ToS gray area. Keep traffic low, cache, and fetch on demand only.

---

## 1. Official API

- Authentication: HTTP Basic, per user. Requests "will have access to tournaments that user has access to on the Melee site." Every endpoint requires it.

Relevant GET endpoints. Paged ones take `variables.page`, `variables.pageSize`, `variables.offset`, `variables.ignoreCache`. Responses are wrapped in `ApiResult {statusCode, page, pageSize, recordsFiltered, recordsTotal, content, hasMore}`.

| Endpoint | Purpose |
|---|---|
| `/api/tournament/{id}` | Tournament details ("requires staff-level authorization") |
| `/api/tournament/list` | Tournaments where the caller is staff (`startDateFrom`, `startDateTo`, `tournamentId`, `lastUpdatedDate`) |
| `/api/standing/list/current/{tournamentId}` | Current standings |
| `/api/standing/list/round/{roundId}` | Standings for a round |
| `/api/standing/{teamId}` | Latest standing for one team |
| `/api/match/list/{tournamentId}` | All matches |
| `/api/match/list/current/{tournamentId}` | Matches for the current round |
| `/api/match/list/round/{roundId}` | Matches for a round |
| `/api/match/{guid}` | One match |
| `/api/player/list/{tournamentId}`, `/api/player/{id}`, `/api/player/metadata/...` | Players |
| `/api/team/list/{tournamentId}`, `/api/team/{id}` | Teams (registrations) |
| `/api/decklist/...` | Decklists |
| `/api/reports/{guid}` | Saved admin reports |

There is no dedicated phases/rounds listing endpoint. Response schemas are mostly untyped, so the worker's adapter (`apps/worker/src/apiAdapter.ts`) treats the shapes as assumptions until real responses are captured.

### 2. Authentication [V + docs]

Unauthenticated calls [V]:
- `GET /api/tournament/484511` → **401** `{"Error":true,"Code":401,"Message":"Authentication is required to access this resource."}`
- The same 401 comes back from `standing/list/current/484511`, `standing/list/round/1749836`, `match/list/round/1749836`, `player/list/484511`, and `team/list/484511`.
- `GET /api/tournament/list` → **400** with an `ApiResult` wrapper: `"Could not authenticate user."`
- With bogus Basic credentials (`-u foo:bar`) → 401.
- No `WWW-Authenticate` header and no CORS headers. `OPTIONS` returns `405 Allow: GET`.

How to get credentials (help.melee.gg "API use", https://help.melee.gg/?p=11549):
> "We only allow API access to organizations and their designated staff." ... "please send an email to contact@melee.gg requesting api access." For an org you don't own, "the owner of that organization must confirm it is OK" ... "Once we confirm acceptance, we will generate the client ID and secret to allow api access." ... "you must be at least given Coverage Staff clearance on every tournament or organization you wish to pull data for."

[I] Presumably `Authorization: Basic base64(clientId:clientSecret)`. Bottom line: the official API is not usable for arbitrary public tournaments.

## 3. Unofficial website endpoints (no auth) [V]

All tested against tournament 484511. No cookies were needed.

### 3a. Tournament page → round IDs
`GET https://melee.gg/Tournament/View/484511` → 200 HTML (~115 KB).
- `<title>Star Wars: Unlimited — Homeworlds Planetary Qualifier | Melee</title>`
- `<input id="tournament-id" type="hidden" value="484511">`, `TournamentGuid`, `DecklistEnabled`
- Start date: `#tournament-headline-start-date-field span[data-value="2026-11-14T18:00:00.0000000Z"]`
- Headline text: `Format: Premier | Ended | 52 of 88 Enrolled Players`
- Two selector containers, `#standings-round-selector-container` and `#pairings-round-selector-container`. Each has:
  ```html
  <button class="btn btn-gray round-selector" data-id="1725211" data-name="Round 1" data-is-completed="True">Round 1</button>
  ...
  <button ... data-id="1749836" data-name="Round 6" data-is-completed="True">Round 6</button>
  <button ... data-id="1725216" data-name="Quarterfinals" data-is-completed="True">
  <button ... data-id="1725217" data-name="Semifinals" ...>
  <button ... data-id="1725218" data-name="Finals" ...>
  ```
  - Standings buttons carry `data-is-completed`. Pairings buttons carry `data-is-started`.
  - The site JS selects the last `data-is-completed="True"` round by default.
  - Round 6 has a much later ID (1749836) than Rounds 1–5 and the playoffs (1725211–1725218). **[I] The TO created Rounds 1–5 plus a top-8 bracket up front, then added Round 6 during the event.** So the number of Swiss rounds shown before the event finishes may not be final. Treat it as "rounds currently listed" and let the user override.
  - Top cut size [I]: the first playoff round's name ("Quarterfinals" = top 8, "Semifinals" = top 4). It is also confirmed by the 4 matches in `GetRoundMatches/1725216`. Swiss vs playoff can also be read from `PhaseId` / `MatchingMethodDescription` in the JSON (`"Swiss"`, phase 492437; playoffs are phase 492438).
- HEAD requests return 302 to `/Error` [V], so use GET.

Scripts that call these endpoints: `/Scripts/Views/Tournament/standings-section.min.js`, `pairings-section.min.js`, `flattsware.datatables.min.js`, `flattsware.standings.min.js`.

### 3b. Standings config
`GET /Standing/GetStandingsConfig/484511` → 200 JSON [V]. Key fields:
`GameDescription:"STAR WARS: Unlimited"`, `ScoreDescription:"Magic: The Gathering Default"` (W=3, D=1, L=0; confirmed: 5-0-1 = 16 pts), `ScoreName:"Points"`.

Tiebreakers in order:
1. `OMW%` (Desc)
2. `TGW%` (Desc)
3. `OGW%` (Desc)
4. `Team Id` (Asc; the final arbitrary tiebreak)

`Tiebreaker{1,2,3}FallbackPercentage:"1/3"` (the 33% floor).

### 3c. Round standings
`POST https://melee.gg/Standing/GetRoundStandings`, `Content-Type: application/x-www-form-urlencoded` (DataTables server-side protocol):

```
draw=1&start=0&length=-1&roundId=1749836                         -> 200, all 52 rows (simplest)
draw=1&start=0&length=25&roundId=1749836&columns[0][data]=Rank&order[0][column]=0&order[0][dir]=asc -> 200, paged
```
Request-shape findings [V]:
- `roundId` must be a form field. `GET ?roundId=` → 302 to /Error. `roundId` alone → 302.
- Paging with `length` ≥ 1 **requires** the `columns[0][data]` + `order[0][...]` params, or you get a 302 to `/Error/...`. `length=-1` (all rows) works without them.
- `search[value]=Player 003` filters server-side (200). A broad search without order params → 302.
- Failures come back as a **302 redirect to an HTML error page**, not a JSON error. Treat any non-JSON response as an error.

Response: `{draw, recordsTotal, recordsFiltered, data:[...]}`. Per-row fields (sample, Rank 1):
```json
{"Team":{"Players":[{"TeamId":5001,"ID":1001,"DisplayName":"Player 001","Username":"Player 001",...}],
         "ID":5001,"StatusDescription":"Active","IsActive":true},
 "Rank":1,"Points":16,"MatchRecord":"5-0-1","GameRecord":"10-0-3",
 "MatchWins":5,"MatchLosses":0,"MatchDraws":1,"MatchCount":6,
 "GameWins":10,"GameLosses":0,"GameDraws":3,"GameCount":13,
 "OpponentMatchWinPercentage":0.6666667,"TeamGameWinPercentage":0.8461538,
 "OpponentGameWinPercentage":0.5920635,"FinalTiebreaker":5001.0,
 "OpponentCount":0,"RoundNumber":6,"Round":"Round 6","RoundId":1749836,"PhaseId":492437,
 "MatchingMethodDescription":"Swiss","TournamentId":484511,"StandingsPublished":true,
 "Decklists":[{"DecklistId":"...","DecklistName":"Greef Karga, Gracious Magistrate - Imperial Command Complex"}]}
```
- `OpponentCount` was 0 on every row, so it doesn't help.
- **No opponent list in standings.** To get opponents (needed to simulate OMW changes), fetch matches for every round.

### 3d. Round matches/pairings
`POST https://melee.gg/Match/GetRoundMatches/{roundId}` with body `draw=1&start=0&length=-1` → 200 [V]. `length=25` without order params also works. Round 6 has 21 matches. Per-match fields:
- `Competitors[]`, each with:
  - `Team.Players[].Username/DisplayName`, `Team.ID`, `Team.StatusDescription`
  - `GameWins`, `GameByes`, `ResultConfirmed`, `CheckedIn`
- `TableNumber`, `HasResult`, `GameDraws`, `ResultString` (e.g. `"Player 021 won 2-1-0"`, `"0-0-3 Draw"`, `"1-1-0 Draw"`)
- `ByeReasonDescription`, `LossReasonDescription`, `RoundNumber`, `RoundId`, `PhaseId`, `RoundDescription`, `TypeDescription:"Best of Three"`, `Guid`

Representations:
- **Intentional draw**: `ResultString:"0-0-3 Draw"`, `GameDraws:3`, both `GameWins:0`. This is what Table 1 (Player 009–Player 001), Table 3 (Player 003–Player 018) and Table 23 (Player 036–Player 006) reported in R6.
- **Bye**: a single competitor, `ResultString:"Player 039 was awarded a bye"`, `ByeReasonDescription:"Staff Assigned"` (R1).
- **Forfeit/no-show**: a single competitor, `"Player 052 forfeited the match"`.
- **Unreported match** [I]: `HasResult:false` (not observed in this ended event).

## 4. CORS [V]
Tested with `Origin: https://example.com`:
- `POST /Standing/GetRoundStandings` → 200, **no `Access-Control-Allow-Origin`**.
- `OPTIONS` preflight → 302 to /Error.
- `GET /Standing/GetStandingsConfig/...` → no ACAO.
- `GET /Tournament/View/...` → no ACAO. The page also sets `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- `/api/*` → no ACAO, `OPTIONS` → 405.

So a browser-only app can't call melee.gg directly. **A proxy is required.** A form-encoded POST counts as a "simple" request, so the browser would send it, but it would block reading the response.

## 5. Tournament 484511 snapshot [V]
"Star Wars: Unlimited — Homeworlds Planetary Qualifier", Game Kastle Redwood City, Premier, Bo3, started 2026-11-14 18:00Z, **Ended**.
- **52 players** ("52 of 88 Enrolled"; `recordsTotal: 52`).
- **6 Swiss rounds**.
- **Top 8** (QF/SF/F).

Final Swiss standings (after R6):

| Rk | Player | Rec | Pts | OMW | TGW | OGW | Status |
|---|---|---|---|---|---|---|---|
| 1 | Player 001 | 5-0-1 | 16 | 66.67 | 84.62 | 59.21 | Active |
| 2 | Player 009 | 5-0-1 | 16 | 63.89 | 78.57 | 58.08 | Eliminated |
| 3 | Player 023 | 5-1-0 | 15 | 56.48 | 68.75 | 51.32 | Active |
| 4 | Player 006 | 4-1-1 | 13 | 65.74 | 56.25 | 59.37 | Eliminated |
| 5 | Player 018 | 4-1-1 | 13 | 60.19 | 60.00 | 56.42 | Active |
| 6 | Player 036 | 4-1-1 | 13 | 58.33 | 60.00 | 57.57 | Eliminated |
| **7** | **Player 003** | **4-1-1** | **13** | **57.41** | **64.29** | **55.43** | Active |
| 8 | Player 039 | 4-2-0 | 12 | 67.78 | 60.00 | 62.90 | Active |
| 9 | Player 043 | 4-2-0 | 12 | 62.96 | 60.00 | 58.34 | Cut |
| 10 | Player 046 | 4-2-0 | 12 | 61.11 | 62.50 | 55.21 | Cut |
| 11 | Player 007 | 4-2-0 | 12 | 58.33 | 62.50 | 56.33 | Cut |
| 12 | Player 051 | 4-2-0 | 12 | 53.70 | 66.67 | 51.01 | Cut |
| 13 | Player 049 | 4-2-0 | 12 | 50.93 | 69.23 | 51.78 | Cut |
| 14 | Player 008 | 4-2-0 | 12 | 49.07 | 60.00 | 47.59 | Cut |
| 15 | Player 020 | 4-2-0 | 12 | 48.15 | 60.00 | 48.98 | Cut |

Before the last round (R5 standings, roundId 1725215): Player 003 was **6th, 4-1-0, 12 pts** (OMW 56.67 / TGW 72.73 / OGW 55.84). The other 12-pointers were ranks 3–8: Player 006, Player 036, Player 018, Player 003, Player 023, Player 007. Ranks 1–2 were 5-0-0. Next were two 3-1-1 players at 10 pts.

Player 003 ID'd with Player 018 in R6 and made top 8 at 7th, then lost the QF to Player 009 2-1. This is a good real-world test case.

**Drops and statuses.** `Team.StatusDescription` values seen: `Active`, `Eliminated` (lost in top cut), `Cut` (missed the cut), `Dropped (Self)`, `Dropped (Staff)`. `IsActive` is false for all but Active.
- Dropped players **stay in the standings** with their partial record, e.g. `Player 017 2-2-0 Dropped (Self)`, and keep counting toward opponents' OMW.
- [I] The status is the team's **current** status, not its status as of that round. Historical round standings show today's statuses.
- For live use: a player who is not `Active` and whose `StatusDescription` starts with `Dropped` won't be paired again.

## 6. Rate limits, robots.txt, ToS
- **robots.txt** [V]: `User-agent: * / Crawl-Delay: 5`. It disallows `/Scripts/`, `/Account/`, `/Card/`, `/Decklist/View/`, `/Tournament/Search*`, `/Tournament/SearchActivePlayers/`, and others. It does **not** disallow `/Tournament/View/`, `/Standing/`, or `/Match/`.
- **Rate limits**: no rate-limit headers seen. I made roughly 50 requests over a few minutes without any 429. [I] Limits are unknown. Respect the 5 s crawl delay where practical and cache responses. A full analysis costs about 1 page + 1 config + 1 standings + N match calls.
- **ToS** (`/Policy/Terms`) [V], quote: "...use any robot, spider, scraper, crawler or other automated means to access the Services for any purpose". It also bans reverse engineering and commercial resale. A user-triggered on-demand proxy for public data is a gray area. Options: contact contact@melee.gg, keep the tool non-commercial and low-volume, and credit or link back to melee.gg.

## Suggested fetch sequence for the app [I]
1. Parse the tournament ID from the URL (`/Tournament/View/(\d+)`).
2. Proxy `GET /Tournament/View/{id}`. Parse `#standings-round-selector-container .round-selector` → `[{id, name, completed}]`, `#pairings-round-selector-container` → `started`, plus the headline (player count, status).
3. Proxy `GET /Standing/GetStandingsConfig/{id}` for tiebreaker order.
4. Proxy `POST /Standing/GetRoundStandings` with `draw=1&start=0&length=-1&roundId={latest completed Swiss round}`.
5. Proxy `POST /Match/GetRoundMatches/{roundId}` with `draw=1&start=0&length=-1` for every Swiss round. This rebuilds opponent lists (to simulate OMW after hypothetical results) and current-round pairings (who plays whom in the round being considered for an ID).
6. Classify Swiss vs playoffs with `MatchingMethodDescription`/`PhaseId` from the JSON, or by round name. Get the cut size from the playoff round names. Let the user override both the cut size and the remaining Swiss rounds.
