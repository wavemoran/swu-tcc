import type { Analysis } from '@swu-tcc/core';
import { formatPercent } from '../format.ts';
import { StatusChip } from './Status.tsx';
import { SectionLabel } from './ui.tsx';

export function Verdict({ analysis }: { analysis: Analysis }) {
  const { verdict, method, assumptions, topCut, roundsRemaining } = analysis;
  const pct = formatPercent(verdict.probability, verdict.certainty);
  const caption =
    roundsRemaining === 0
      ? `to make top ${topCut}`
      : verdict.basis === 'draw'
        ? `to make top ${topCut} if you ID`
        : verdict.basis === 'loss'
          ? `to make top ${topCut} even if you lose`
          : `to make top ${topCut} if you win${roundsRemaining > 1 ? ' out' : ''}`;
  const barWidth = verdict.certainty === 'certain' ? 100 : verdict.certainty === 'impossible' ? 0 : Math.min(99, Math.max(1, Math.round(verdict.probability * 100)));
  const methodText =
    method.kind === 'exhaustive'
      ? `EXHAUSTIVE · ${method.samples.toLocaleString('en-US')} OUTCOMES`
      : `MONTE CARLO · ${method.samples.toLocaleString('en-US')} SIMULATIONS`;

  return (
    <section className={`verdict st-${verdict.status}`} aria-labelledby="verdict-h" data-testid="verdict">
      <div className="verdict-in">
        <h2 id="verdict-h" className="section-label">
          <SectionLabel>verdict</SectionLabel>
        </h2>
        <StatusChip status={verdict.status} />
        <p className="verdict-pct tcc-num" data-testid="verdict-pct">
          {pct}
        </p>
        <p className="verdict-caption">{caption}</p>
        <div className="confbar" role="presentation">
          <span style={{ width: `${barWidth}%` }} />
        </div>
        <p className="mono-note">{methodText}</p>
        <p className="verdict-summary">{verdict.summary}</p>
        <details className="disclosure">
          <summary>Assumptions</summary>
          <ul>
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="mono-note">
            Method: {method.kind === 'exhaustive' ? 'exhaustive enumeration' : 'Monte Carlo'}, {method.samples.toLocaleString('en-US')}{' '}
            {method.kind === 'exhaustive' ? 'outcomes' : 'samples'}, seed {method.seed}.
          </p>
        </details>
      </div>
    </section>
  );
}
