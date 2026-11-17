import { describe, expect, it } from 'vitest';
import { computeStandings, fromMelee } from '../src/index.ts';
import { MeleeShapeError, parseMatches, parseStandings, pascalizeKeys } from '../src/melee/raw.ts';
import { fixtureInput } from './helpers.ts';

/** What the official API might send: camelCase keys (`id` rather than `ID`). */
function camelize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camelize);
  if (typeof v !== 'object' || v === null) return v;
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) => [k === 'ID' ? 'id' : k[0]!.toLowerCase() + k.slice(1), camelize(x)]),
  );
}

/** `ApiResult` wrapper from the spec (MtgMelee.Models.Api.ApiResult). */
function apiResult(rows: unknown[]) {
  return {
    statusCode: 'OK',
    ignoreCache: false,
    page: 1,
    pageSize: 250,
    recordsFiltered: rows.length,
    recordsTotal: rows.length,
    content: rows,
    hasMore: false,
  };
}

describe('API-shaped bodies', () => {
  const base = fixtureInput();
  const baseline = fromMelee(base);

  function convert(wrap: (rows: unknown[]) => unknown, camel: boolean) {
    const input = fixtureInput();
    for (const key of Object.keys(input.standings)) {
      const rows = (input.standings[Number(key)] as { data: unknown[] }).data;
      input.standings[Number(key)] = wrap(camel ? (camelize(rows) as unknown[]) : rows);
      const mrows = (input.matches[Number(key)] as { data: unknown[] }).data;
      input.matches[Number(key)] = wrap(camel ? (camelize(mrows) as unknown[]) : mrows);
    }
    return input;
  }

  it('accepts bare arrays', () => {
    expect(fromMelee(convert((r) => r, false))).toEqual(baseline);
  });

  it('accepts the ApiResult wrapper (content)', () => {
    expect(fromMelee(convert(apiResult, false))).toEqual(baseline);
  });

  it('accepts camelCase keys inside an ApiResult wrapper', () => {
    const t = fromMelee(convert(apiResult, true));
    expect(t).toEqual(baseline);
    expect(computeStandings(t, 6).map((r) => r.playerId)).toEqual(computeStandings(baseline, 6).map((r) => r.playerId));
  });

  it('accepts camelCase bare arrays and the content.data nesting', () => {
    expect(fromMelee(convert((r) => r, true))).toEqual(baseline);
    expect(fromMelee(convert((r) => ({ content: { data: r } }), false))).toEqual(baseline);
  });

  it('reports recordsTotal from the wrapper when present', () => {
    expect(parseStandings(apiResult([])).recordsTotal).toBe(0);
    expect(parseStandings({ content: [], recordsTotal: 99 }).recordsTotal).toBe(99);
  });

  it('names what it expected when the body has no rows', () => {
    expect(() => parseStandings({ statusCode: 'OK', content: { rows: [] } }, 'standings for round 5')).toThrow(
      /standings for round 5.*bare array.*"data" or "content"/,
    );
    expect(() => parseMatches('x', 'matches for round 5')).toThrow(MeleeShapeError);
  });

  it('reports the missing field with the row position (camelCase input)', () => {
    const rows = camelize([{ Team: { ID: 1, StatusDescription: 'Active', Players: [] }, Rank: 1 }]);
    expect(() => parseStandings(rows)).toThrow(/standings row 0.*"Points" should be a number/);
  });

  it('pascalizeKeys maps id to ID and leaves Pascal keys alone', () => {
    expect(pascalizeKeys({ id: 1, teamId: 2, Rank: 3, nested: [{ id: 4 }] })).toEqual({
      ID: 1,
      TeamId: 2,
      Rank: 3,
      Nested: [{ ID: 4 }],
    });
  });
});
