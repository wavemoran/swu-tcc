import type { Analysis } from '@swu-tcc/core';
import { bestScenarioIndex, formatPercent, recordString, scenarioLabel, STATUS_LABEL } from '../format.ts';
import { StatusIcon } from './Status.tsx';
import { SectionLabel } from './ui.tsx';

export function Scenarios({ analysis }: { analysis: Analysis }) {
  const { scenarios, topCut } = analysis;
  const best = bestScenarioIndex(scenarios);
  return (
    <section aria-labelledby="scen-h" className="block">
      <h2 id="scen-h" className="section-label">
        <SectionLabel>scenarios</SectionLabel>
      </h2>
      <ul className="scenarios">
        {scenarios.map((s, i) => {
          const status = s.status;
          const isBest = i === best;
          return (
            <li key={s.outcomes.join('-') || 'final'} className={`scenario st-${status}${isBest ? ' best' : ''}`}>
              <span className="marker" aria-hidden="true">
                {isBest && <span className="dot" />}
              </span>
              <div className="scen-main">
                <p className="scen-name">
                  {scenarioLabel(s.outcomes)}
                  {isBest && <span className="best-tag"> · BEST CHOICE</span>}
                </p>
                <p className="scen-meta tcc-num">
                  {recordString(s.finalRecord)} · {s.finalPoints} PTS
                </p>
              </div>
              <div className="scen-right">
                <p className="scen-pct tcc-num" aria-label={`${formatPercent(s.probability, s.certainty)} to make top ${topCut}`}>
                  {formatPercent(s.probability, s.certainty)}
                </p>
                <p className="scen-status">
                  <StatusIcon status={status} size={16} />
                  <span>{STATUS_LABEL[status]}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
