import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openPlayer, T, test } from './fixtures';

async function expectNoSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`).join('\n')}`),
  ).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`accessibility (${theme})`, () => {
    test.use({ theme });

    test('landing', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('tournament', async ({ page }) => {
      await page.goto(`/t/${T.live}`);
      await expect(page.locator('table.standings')).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('player', async ({ page }) => {
      await openPlayer(page, T.live, 'Player 003');
      await page.locator('details.disclosure summary').click();
      await expectNoSeriousViolations(page);
    });
  });
}
