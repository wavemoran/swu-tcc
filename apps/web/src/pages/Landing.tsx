import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { FORCE_MOCK } from '../data/load.ts';
import { MOCK_STATE_PLAYERS, MOCK_TOURNAMENT_ID } from '../data/mock.ts';
import { STATUS_LABEL, parseMeleeInput } from '../format.ts';
import { Link, navigate, playerPath, tournamentPath } from '../router.tsx';
import { StatusIcon } from '../components/Status.tsx';
import { SectionLabel } from '../components/ui.tsx';

export function Landing() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = parseMeleeInput(value);
    if (!id) {
      setError('That does not look like a Melee.gg tournament link. Try https://melee.gg/Tournament/View/484511 or just the number.');
      return;
    }
    navigate(tournamentPath(id));
  };

  return (
    <div className="landing">
      <div className="hero">
        <img className="lockup" src="/brand/lockup-stacked.svg" alt="SWU TCC, Top Cut Calculator" />
        <h1 className="hero-title">Can you make top cut?</h1>
        <p className="hero-sub">
          Open this between rounds. Paste your Melee.gg tournament link and see whether you make the cut, and whether an intentional draw
          (ID) is safe.
        </p>
      </div>

      <form className="card landing-form" onSubmit={submit} noValidate>
        <label htmlFor="melee-link" className="field-label">
          Paste your Melee.gg tournament link
        </label>
        <input
          id="melee-link"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://melee.gg/Tournament/View/484511"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'melee-link-err' : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id="melee-link-err" className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary block-btn">
          Load standings <ArrowRight size={18} aria-hidden="true" />
        </button>
        <Link to="/manual" className="btn ghost block-btn">
          Enter standings by hand
        </Link>
      </form>

      {FORCE_MOCK && (
        <section className="block" aria-labelledby="mock-h">
          <h2 id="mock-h" className="section-label">
            <SectionLabel>mock states</SectionLabel>
          </h2>
          <ul className="mock-states">
            {MOCK_STATE_PLAYERS.map((m) => (
              <li key={m.status}>
                <Link to={playerPath(MOCK_TOURNAMENT_ID, m.playerId)} className={`btn secondary st-${m.status}`}>
                  <StatusIcon status={m.status} size={16} />
                  <span>{STATUS_LABEL[m.status]}</span>
                  <span className="muted">{m.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function Manual() {
  return (
    <div className="state">
      <h1 className="page-title">Enter standings by hand</h1>
      <p className="muted">
        Manual entry is coming soon: type in your record, the round and the event size, and get the same verdict without Melee.gg.
      </p>
      <div className="actions">
        <Link to="/" className="btn primary">
          Back to Melee link
        </Link>
      </div>
    </div>
  );
}
