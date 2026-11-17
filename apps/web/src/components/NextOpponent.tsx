import { Swords } from 'lucide-react';
import type { Analysis } from '@swu-tcc/core';
import { recordString } from '../format.ts';
import { SectionLabel } from './ui.tsx';

export function NextOpponent({ analysis }: { analysis: Analysis }) {
  const opp = analysis.nextOpponent;
  const row = opp ? analysis.currentStandings.find((r) => r.playerId === opp.playerId) : undefined;
  return (
    <section aria-labelledby="opp-h" className="block">
      <h2 id="opp-h" className="section-label">
        <SectionLabel>next opponent</SectionLabel>
      </h2>
      <div className="card opp">
        {opp ? (
          <>
            <Swords size={20} aria-hidden="true" />
            <div className="opp-main">
              <p className="opp-name">{opp.name}</p>
              {row && (
                <p className="scen-meta tcc-num">
                  RANK {row.rank} · {recordString(row.record)} · {row.points} PTS
                </p>
              )}
            </div>
            <span className="tag">{opp.predicted ? 'PREDICTED' : 'POSTED'}</span>
          </>
        ) : (
          <p className="muted">No rounds left to play. These are your final Swiss standings.</p>
        )}
      </div>
      {opp?.predicted && (
        <p className="mono-note">Pairings are not posted yet. The last round is paired by standings (1 v 2, 3 v 4, ...).</p>
      )}
    </section>
  );
}
