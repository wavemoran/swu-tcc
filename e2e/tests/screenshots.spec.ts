import { openPlayer, T, test, expect } from './fixtures';

// Artifacts for humans to look at, not visual-regression asserts. Written to e2e/screenshots/ (gitignored).
const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1280, height: 800 },
} as const;

for (const theme of ['dark', 'light'] as const) {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    test.describe(`screenshots ${theme} ${vp}`, () => {
      test.use({ theme, viewport: size });
      const file = (name: string) => `screenshots/${name}-${vp}-${theme}.png`;

      test('landing', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.screenshot({ path: file('landing'), fullPage: true });
      });

      test('tournament', async ({ page }) => {
        await page.goto(`/t/${T.live}`);
        await expect(page.locator('table.standings')).toBeVisible();
        await page.screenshot({ path: file('tournament'), fullPage: true });
      });

      test('player', async ({ page }) => {
        await openPlayer(page, T.live, 'Player 003');
        await expect(page.locator('ul.scenarios > li')).toHaveCount(3);
        await page.screenshot({ path: file('player-003'), fullPage: true });
      });
    });
  }
}
