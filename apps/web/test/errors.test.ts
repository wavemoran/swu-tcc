import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/data/api.ts';
import { describeError } from '../src/pages/TournamentRoute.tsx';

describe('describeError', () => {
  it('says the tournament is not available yet for not_authorized, and offers manual entry', () => {
    const d = describeError(new ApiError('not_authorized', 'The Melee API refused our credentials', 403));
    expect(d.title).toBe("This tournament isn't available to SWU TCC yet");
    expect(d.manual).toBe(true);
  });
});
