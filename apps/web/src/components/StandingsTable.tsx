import { Fragment } from 'react';
import type { StandingRow } from '@swu-tcc/core';
import { recordString } from '../format.ts';
import { Link } from '../router.tsx';

const pct = (x: number) => `${(x * 100).toFixed(1)}`;

/** Ranks to show for "standings near you": +-6 around the player and +-2 around the cut. */
export function nearRanks(rows: StandingRow[], playerId: string, topCut: number): Set<number> {
  const me = rows.find((r) => r.playerId === playerId);
  const keep = new Set<number>();
  const add = (center: number, span: number) => {
    for (let r = center - span; r <= center + span; r++) if (r >= 1 && r <= rows.length) keep.add(r);
  };
  if (me) add(me.rank, 6);
  add(topCut, 2);
  add(topCut + 1, 2);
  return keep;
}

interface Props {
  rows: StandingRow[];
  topCut: number;
  selectedId?: string | null;
  /** When set, only these ranks are shown, with gap markers between runs. */
  onlyRanks?: Set<number>;
  hrefFor?: (playerId: string) => string;
  caption: string;
}

export function StandingsTable({ rows, topCut, selectedId, onlyRanks, hrefFor, caption }: Props) {
  const shown = onlyRanks ? rows.filter((r) => onlyRanks.has(r.rank)) : rows;
  return (
    <div className="table-wrap">
      <table className="standings">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Player</th>
            <th scope="col" className="num">W-L-D</th>
            <th scope="col" className="num">Pts</th>
            <th scope="col" className="num">OMW%</th>
            <th scope="col" className="num wide">GW%</th>
            <th scope="col" className="num wide">OGW%</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const prev = shown[i - 1];
            const gap = onlyRanks && prev && r.rank - prev.rank > 1;
            const mine = r.playerId === selectedId;
            const name = hrefFor ? (
              <Link to={hrefFor(r.playerId)} className="row-link">
                {r.name}
              </Link>
            ) : (
              r.name
            );
            return (
              <Fragment key={r.playerId}>
                {gap && (
                  <tr className="gap-row" aria-hidden="true">
                    <td colSpan={7}>...</td>
                  </tr>
                )}
                <tr className={`${mine ? 'me' : ''}${r.dropped ? ' dropped' : ''}`} aria-current={mine ? 'true' : undefined}>
                  <td className="num rank">{r.rank}</td>
                  <th scope="row" className="pname">
                    {name}
                    {mine && <span className="tag you">YOU</span>}
                    {r.dropped && <span className="tag">DROPPED</span>}
                  </th>
                  <td className="num">{recordString(r.record)}</td>
                  <td className="num strong">{r.points}</td>
                  <td className="num">{pct(r.omw)}</td>
                  <td className="num wide">{pct(r.gw)}</td>
                  <td className="num wide">{pct(r.ogw)}</td>
                </tr>
                {r.rank === topCut && rows.length > topCut && (
                  <tr className="cut-row">
                    <td colSpan={7}>
                      <div className="cut-wrap">
                        <div className="tcc-cut-line" />
                        <span className="cut-label">CUT · TOP {topCut}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
