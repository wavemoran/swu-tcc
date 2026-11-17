// Replaces personal data in fixtures/melee/<id>/raw/*.json with stable pseudonyms.
//
//   node --experimental-strip-types tools/pseudonymize-fixtures.ts [--check] [--print-map] [<tournament-id>...]
//
// Run it after every capture (tools/capture-melee-site.sh) and before
// committing a fixture. It is idempotent (running it on already-pseudonymized
// files changes nothing) and deterministic (no randomness, no clock).
//
// Per tournament:
// - Players are numbered by their original Melee player id, ascending, and
//   named "Player 001", "Player 002", ... in every file (standings, matches,
//   result strings). Pronouns and profile image fields are cleared.
// - Player ids and team ids are remapped to small integers with an
//   order-preserving mapping, so "team id ascending" (the final tiebreaker)
//   ranks players exactly as before. FinalTiebreaker is the team id and is
//   remapped the same way.
// - Decklist ids become fake UUIDs and decklist names become "Decklist" (the
//   engine and the web app never read them).
// - Tournament, round, phase, match and format ids are public event
//   identifiers and are left alone. tournament.html holds the public page
//   template and no player data (this tool warns if a player name ever shows
//   up in it); only Melee's Datadog RUM clientToken/applicationId are redacted.
//
// --check    report files that still need changes (exit 1) without writing.
// --print-map  (writes nothing) print original -> new ids and names as JSON (contains the
//              originals: redirect to a file outside the repo, never commit it).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'fixtures', 'melee');
const PLAYER_ID_BASE = 1000;
const TEAM_ID_BASE = 5000;

const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlayer = (o: Obj): boolean => 'Username' in o || 'DisplayName' in o;

interface Maps {
  player: Map<number, number>;
  team: Map<number, number>;
  pseudonym: Map<number, string>; // new player id -> "Player NNN"
  names: Map<string, string>; // original name (lowercased) -> pseudonym
  decklist: Map<string, string>;
  nameRe: RegExp | null;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pass 1: collect every player id, team id, name and decklist id in the tournament. */
function collect(files: Json[]): { players: Map<number, Obj>; teams: Set<number>; decklists: Set<string> } {
  const players = new Map<number, Obj>();
  const teams = new Set<number>();
  const decklists = new Set<string>();
  const walk = (v: Json): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!isObj(v)) return;
    if (isPlayer(v) && typeof v.ID === 'number') {
      if (!players.has(v.ID)) players.set(v.ID, v);
      if (typeof v.TeamId === 'number') teams.add(v.TeamId);
    }
    if (typeof v.DecklistId === 'string') decklists.add(v.DecklistId);
    if (typeof v.TeamId === 'number') teams.add(v.TeamId);
    if (typeof v.FinalTiebreaker === 'number') teams.add(v.FinalTiebreaker);
    if (isObj(v.Team) && typeof v.Team.ID === 'number') teams.add(v.Team.ID);
    for (const x of Object.values(v)) walk(x);
  };
  files.forEach(walk);
  return { players, teams, decklists };
}

function buildMaps(files: Json[]): Maps {
  const { players, teams, decklists } = collect(files);
  const playerIds = [...players.keys()].sort((a, b) => a - b);
  const width = Math.max(3, String(playerIds.length).length);
  const maps: Maps = {
    player: new Map(),
    team: new Map(),
    pseudonym: new Map(),
    names: new Map(),
    decklist: new Map(),
    nameRe: null,
  };
  playerIds.forEach((id, i) => {
    const newId = PLAYER_ID_BASE + i + 1;
    const name = `Player ${pad(i + 1, width)}`;
    maps.player.set(id, newId);
    maps.pseudonym.set(newId, name);
    const p = players.get(id)!;
    for (const k of ['Username', 'DisplayName', 'DisplayNameLastFirst', 'ScreenName']) {
      const n = p[k];
      if (typeof n === 'string' && n.trim() && n !== 'N/A') maps.names.set(n.toLowerCase(), name);
    }
  });
  [...teams].sort((a, b) => a - b).forEach((id, i) => maps.team.set(id, TEAM_ID_BASE + i + 1));
  [...decklists].sort().forEach((id, i) => {
    maps.decklist.set(id, `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`);
  });
  // One alternation, longest names first, so a result string is rewritten in a
  // single pass (no chained replacements).
  const alts = [...maps.names.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  if (alts.length) maps.nameRe = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  return maps;
}

function mapNum(m: Map<number, number>, v: Json | undefined, what: string): number {
  if (typeof v !== 'number' || !m.has(v)) throw new Error(`unmapped ${what}: ${String(v)}`);
  return m.get(v)!;
}

/** Pass 2: rewrite one parsed file in place. */
function transform(v: Json, maps: Maps): void {
  if (Array.isArray(v)) return v.forEach((x) => transform(x, maps));
  if (!isObj(v)) return;
  if (isPlayer(v)) {
    const newId = mapNum(maps.player, v.ID, 'player id');
    const name = maps.pseudonym.get(newId)!;
    v.ID = newId;
    if ('TeamId' in v) v.TeamId = mapNum(maps.team, v.TeamId, 'team id');
    v.Username = name;
    v.DisplayName = name;
    v.DisplayNameLastFirst = name;
    if ('ScreenName' in v) v.ScreenName = 'N/A';
    if ('ProfileImageVersion' in v) v.ProfileImageVersion = 0;
    if ('PronounsDescription' in v) v.PronounsDescription = null;
    return; // nothing else nested inside a player
  }
  // Keys that carry a team id (standings rows, competitors, Team, FinalTiebreaker).
  if ('TeamId' in v) v.TeamId = mapNum(maps.team, v.TeamId, 'team id');
  if ('FinalTiebreaker' in v) v.FinalTiebreaker = mapNum(maps.team, v.FinalTiebreaker, 'team id');
  if ('Team' in v && isObj(v.Team) && 'ID' in v.Team) v.Team.ID = mapNum(maps.team, v.Team.ID, 'team id');
  // Decklists.
  if ('PlayerId' in v) v.PlayerId = mapNum(maps.player, v.PlayerId, 'player id');
  if (typeof v.DecklistId === 'string') {
    const fake = maps.decklist.get(v.DecklistId);
    if (!fake) throw new Error(`unmapped decklist id ${v.DecklistId}`);
    v.DecklistId = fake;
  }
  if ('DecklistName' in v) v.DecklistName = 'Decklist';
  for (const k of ['DecklistUrl', 'DecklistLink', 'Url', 'URL']) if (k in v) v[k] = null;
  // "X won 2-0-0" style free text.
  if (typeof v.ResultString === 'string' && maps.nameRe) {
    v.ResultString = v.ResultString.replace(maps.nameRe, (hit) => maps.names.get(hit.toLowerCase()) ?? hit);
  }
  for (const [k, x] of Object.entries(v)) if (k !== 'Team') transform(x, maps);
  if (isObj(v.Team)) transform(v.Team, maps);
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const printMap = args.includes('--print-map');
  const wanted = args.filter((a) => /^\d+$/.test(a));
  const ids = readdirSync(FIXTURES).filter((d) => /^\d+$/.test(d) && (!wanted.length || wanted.includes(d)));
  let stale = 0;
  const dump: Record<string, unknown> = {};
  for (const id of ids) {
    const raw = join(FIXTURES, id, 'raw');
    if (!existsSync(raw)) continue;
    const names = readdirSync(raw).filter((f) => f.endsWith('.json')).sort();
    const texts = names.map((f) => readFileSync(join(raw, f), 'utf8'));
    const parsed = texts.map((t) => JSON.parse(t) as Json);
    const maps = buildMaps(parsed);
    if (printMap) {
      dump[id] = {
        players: Object.fromEntries(maps.player),
        teams: Object.fromEntries(maps.team),
        names: Object.fromEntries(maps.names),
      };
    }
    // Warn if a player name leaked into the (otherwise template-only) page.
    const htmlPath = join(raw, 'tournament.html');
    if (existsSync(htmlPath) && maps.nameRe) {
      const html = readFileSync(htmlPath, 'utf8');
      const hit = html.match(maps.nameRe);
      if (hit && !/^player \d+$/i.test(hit[0])) console.warn(`  WARN ${id}/tournament.html contains a player name; scrub it by hand`);
    }
    let changed = 0;
    // Melee's page embeds its browser-monitoring (Datadog RUM) client token and app id.
    // Public by design, but secret scanners flag them, so never republish them.
    if (existsSync(htmlPath)) {
      const html = readFileSync(htmlPath, 'utf8');
      const out = html.replace(/\b(clientToken|applicationId)(\s*:\s*')[^']*'/g, "$1$2redacted'");
      if (out !== html) {
        changed++;
        if (!check && !printMap) writeFileSync(htmlPath, out);
      }
    }
    names.forEach((f, i) => {
      transform(parsed[i]!, maps);
      const out = JSON.stringify(parsed[i]);
      if (out !== texts[i]) {
        changed++;
        if (!check && !printMap) writeFileSync(join(raw, f), out);
      }
    });
    stale += changed;
    if (!printMap) console.log(`${id}: ${maps.player.size} players, ${changed}/${names.length} files ${check ? 'need changes' : 'rewritten'}`);
  }
  if (printMap) console.log(JSON.stringify(dump));
  if (check && stale) process.exit(1);
}

main();
