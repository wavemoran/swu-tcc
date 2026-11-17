import { describe, expect, it } from 'vitest';
import { formatPercent, parseMeleeInput } from '../src/format.ts';

describe('parseMeleeInput', () => {
  it.each([
    ['https://melee.gg/Tournament/View/484511', '484511'],
    ['http://www.melee.gg/Tournament/View/484511/', '484511'],
    ['melee.gg/Tournament/View/484511', '484511'],
    ['  https://melee.gg/Tournament/View/484511?tab=standings#x ', '484511'],
    ['484511', '484511'],
  ])('parses %s', (input, id) => {
    expect(parseMeleeInput(input)).toBe(id);
  });

  it.each(['', 'hello', 'https://example.com/Tournament/View/1', 'melee.gg/Profile/View/12', '12abc', 'https://melee.gg/Tournament/View/'])(
    'rejects %j',
    (input) => {
      expect(parseMeleeInput(input)).toBeNull();
    },
  );
});

describe('formatPercent', () => {
  it('rounds estimates to whole numbers', () => {
    expect(formatPercent(0.94, 'estimated')).toBe('94%');
    expect(formatPercent(0.5, 'estimated')).toBe('50%');
  });
  it('never shows 100% or 0% for estimates', () => {
    expect(formatPercent(0.999, 'estimated')).toBe('>99%');
    expect(formatPercent(1, 'estimated')).toBe('>99%');
    expect(formatPercent(0.001, 'estimated')).toBe('<1%');
    expect(formatPercent(0, 'estimated')).toBe('<1%');
  });
  it('shows 100% / 0% only for proven results', () => {
    expect(formatPercent(1, 'certain')).toBe('100%');
    expect(formatPercent(0, 'impossible')).toBe('0%');
  });
});
