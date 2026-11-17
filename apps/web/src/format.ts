import type { Outcome, Scenario, Status } from '@swu-tcc/core';

/** Extract a Melee tournament id from a pasted link or a bare id. Returns null if unrecognized. */
export function parseMeleeInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d{1,12}$/.test(s)) return s;
  const m = /^(?:https?:\/\/)?(?:www\.)?melee\.gg\/Tournament\/View\/(\d{1,12})(?:[/?#].*)?$/i.exec(s);
  return m?.[1] ?? null;
}

/**
 * Whole-number percentage. Honest odds: never "100%" or "0%" unless the engine
 * proved it ('certain' / 'impossible'); near-certainty shows ">99%" / "<1%".
 */
export function formatPercent(p: number, certainty: Scenario['certainty']): string {
  if (certainty === 'certain') return '100%';
  if (certainty === 'impossible') return '0%';
  const pct = Math.round(p * 100);
  if (pct >= 100) return '>99%';
  if (pct <= 0) return '<1%';
  return `${pct}%`;
}

export function minutesAgo(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60000));
}

export function formatAge(mins: number): string {
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins} MIN AGO`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} H AGO` : `${Math.floor(h / 24)} D AGO`;
}

export function recordString(r: { wins: number; losses: number; draws: number }): string {
  return `${r.wins}-${r.losses}-${r.draws}`;
}

export const STATUS_LABEL: Record<Status, string> = {
  locked: 'LOCKED',
  'id-safe': 'ID SAFE',
  bubble: 'BUBBLE',
  'win-and-in': 'WIN & IN',
  out: 'OUT',
};

const OUTCOME_LABEL: Record<Outcome, string> = { win: 'Win', draw: 'Draw', loss: 'Loss' };

export function scenarioLabel(outcomes: Outcome[]): string {
  if (outcomes.length === 0) return 'Final';
  const text = outcomes.map((o) => OUTCOME_LABEL[o]).join(' + ');
  return outcomes.length === 1 && outcomes[0] === 'draw' ? 'Draw (ID)' : text;
}

/** Index of the best scenario, or -1 when all are equal (nothing to choose between). */
export function bestScenarioIndex(scenarios: Scenario[]): number {
  if (scenarios.length < 2) return -1;
  let best = 0;
  for (let i = 1; i < scenarios.length; i++) {
    if (scenarios[i]!.probability > scenarios[best]!.probability) best = i;
  }
  const allEqual = scenarios.every((s) => s.probability === scenarios[0]!.probability);
  return allEqual ? -1 : best;
}
