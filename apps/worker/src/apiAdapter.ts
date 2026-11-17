/**
 * THE ADAPTER: the one place that guesses the shape of `GET /api/tournament/{id}`.
 *
 * The API's reference types that response as a bare `object`, and has no
 * rounds endpoint. Everything below is a best
 * reading, not knowledge. On day one run `tools/capture-melee-api.ts`, compare
 * `fixtures/melee-api/<id>/raw/tournament-<id>.json` with this file, and fix
 * ONLY this file. Anything unrecognized throws `API response shape not
 * recognized: <field>` (an `upstream_error`) instead of guessing.
 *
 * ASSUMPTIONS (each marked A1..A6 below):
 *   A1  the body is the tournament object, or an ApiResult whose `content` is it
 *   A2  keys may be camelCase or PascalCase (matched case-insensitively)
 *   A3  `name` (or `title`) holds the tournament name
 *   A4  rounds are `phases[].rounds[]`, or a top-level `rounds[]`
 *   A5  a round has an id (`id`/`roundId`), a name (`name`/`description`, else a
 *       number), and either a status string or boolean started/completed flags
 *   A6  a phase whose name says Swiss/playoff classifies its rounds
 */
import type { ProxyRound } from '@swu-tcc/core';
import { shapeError } from './api.ts';
import { roundKind } from './shared.ts';

export interface AdaptedTournament {
  name: string;
  startDate: string | null;
  statusText: string | null;
  rounds: ProxyRound[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A2: case-insensitive lookup of the first present key among `names`. */
function pick(o: Rec, ...names: string[]): unknown {
  const wanted = names.map((n) => n.toLowerCase());
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && wanted.includes(k.toLowerCase())) return v;
  }
  return undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function roundFrom(r: unknown, where: string, phaseName: string | null): ProxyRound {
  if (!isRec(r)) throw shapeError(`${where} (expected an object)`);
  const rawId = pick(r, 'id', 'roundId');
  const id = typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : rawId;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw shapeError(`${where}.id`);

  let name = str(pick(r, 'name', 'description', 'roundName'));
  if (!name) {
    const n = pick(r, 'number', 'roundNumber');
    if (typeof n === 'number') name = `Round ${n}`;
  }
  if (!name) throw shapeError(`${where}.name`);

  // A5: a status string wins; otherwise both booleans are required.
  const status = str(pick(r, 'status', 'statusDescription'))?.toLowerCase() ?? null;
  let started: boolean | null;
  let completed: boolean | null;
  if (status) {
    completed = /complete|finished|ended/.test(status);
    started = completed || /progress|started|active|running/.test(status);
  } else {
    completed = bool(pick(r, 'isCompleted', 'completed', 'isComplete'));
    started = bool(pick(r, 'isStarted', 'started'));
    if (completed === null) throw shapeError(`${where}.isCompleted`);
    if (started === null) throw shapeError(`${where}.isStarted`);
  }

  // A6: the phase's own label beats parsing the round name.
  let kind: ProxyRound['kind'] = roundKind(name);
  if (phaseName) {
    if (/swiss/i.test(phaseName)) kind = 'swiss';
    else if (/playoff|top\s*cut|bracket|elimination/i.test(phaseName)) kind = 'playoff';
  }
  return { id, name, started, completed, kind };
}

/** Map `GET /api/tournament/{id}` to the pieces of `ProxyTournament` the site scrape used to give us. */
export function adaptTournamentDetails(body: unknown): AdaptedTournament {
  // A1
  let t: unknown = body;
  if (isRec(t) && pick(t, 'name', 'title') === undefined && isRec(t.content)) t = t.content;
  if (!isRec(t)) throw shapeError('tournament (expected an object)');

  // A3
  const name = str(pick(t, 'name', 'title'));
  if (!name) throw shapeError('name');

  const startRaw = str(pick(t, 'startDate', 'startDateTime', 'startsAt', 'start'));
  const startDate = startRaw && !Number.isNaN(Date.parse(startRaw)) ? startRaw : null;
  const statusText = str(pick(t, 'statusDescription', 'status'));

  // A4
  const rounds: ProxyRound[] = [];
  const phases = pick(t, 'phases');
  if (Array.isArray(phases)) {
    phases.forEach((p, pi) => {
      if (!isRec(p)) throw shapeError(`phases[${pi}] (expected an object)`);
      const list = pick(p, 'rounds');
      if (!Array.isArray(list)) throw shapeError(`phases[${pi}].rounds`);
      const phaseName = str(pick(p, 'name', 'description', 'matchingMethodDescription', 'type'));
      list.forEach((r, ri) => rounds.push(roundFrom(r, `phases[${pi}].rounds[${ri}]`, phaseName)));
    });
  } else {
    const list = pick(t, 'rounds');
    if (!Array.isArray(list)) throw shapeError('phases (or rounds)');
    list.forEach((r, ri) => rounds.push(roundFrom(r, `rounds[${ri}]`, null)));
  }
  return { name, startDate, statusText, rounds };
}
