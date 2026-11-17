import { Minus, Plus } from 'lucide-react';
import { SectionLabel } from './ui.tsx';

const CUTS = [4, 8, 16, 32];

export interface WhatIfValue {
  topCut: number;
  swissRounds: number;
}

export function WhatIf({
  value,
  defaults,
  minRounds,
  onChange,
}: {
  value: WhatIfValue;
  defaults: WhatIfValue;
  minRounds: number;
  onChange: (v: WhatIfValue) => void;
}) {
  const changed = value.topCut !== defaults.topCut || value.swissRounds !== defaults.swissRounds;
  return (
    <section aria-labelledby="whatif-h" className="block">
      <h2 id="whatif-h" className="section-label">
        <SectionLabel>what if</SectionLabel>
      </h2>
      <div className="card controls">
        <fieldset className="field">
          <legend className="field-label">Top cut size</legend>
          <div className="segmented" role="radiogroup" aria-label="Top cut size">
            {CUTS.map((c) => (
              <label key={c} className={value.topCut === c ? 'on' : undefined}>
                <input
                  type="radio"
                  name="topcut"
                  checked={value.topCut === c}
                  onChange={() => onChange({ ...value, topCut: c })}
                />
                <span>Top {c}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <span className="field-label" id="rounds-label">
            Swiss rounds
          </span>
          <div className="stepper" role="group" aria-labelledby="rounds-label">
            <button
              type="button"
              className="btn secondary icon"
              aria-label="Fewer Swiss rounds"
              disabled={value.swissRounds <= minRounds}
              onClick={() => onChange({ ...value, swissRounds: value.swissRounds - 1 })}
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <output className="tcc-num stepper-val" aria-live="polite">
              {value.swissRounds}
            </output>
            <button
              type="button"
              className="btn secondary icon"
              aria-label="More Swiss rounds"
              disabled={value.swissRounds >= 12}
              onClick={() => onChange({ ...value, swissRounds: value.swissRounds + 1 })}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {changed && (
          <button type="button" className="btn ghost" onClick={() => onChange(defaults)}>
            Reset to event structure
          </button>
        )}
      </div>
    </section>
  );
}
