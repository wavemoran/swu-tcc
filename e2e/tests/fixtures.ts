import { test as base, expect, type Page } from '@playwright/test';

export const FAKE_MELEE = 'http://127.0.0.1:4010';

/** Tournament ids understood by e2e/fake-melee/server.ts. */
export const T = {
  finished: '484511',
  live: '900001',
  blocked: '900403',
  redirect: '900302',
  slow: '900500',
  unknown: '999999',
} as const;

export type Theme = 'dark' | 'light';

let ipCounter = 0;

export const test = base.extend<{ theme: Theme; fonts: boolean }>({
  theme: ['dark', { option: true }],
  // Google Fonts are blocked by default to keep runs hermetic; screenshots turn them on.
  fonts: [false, { option: true }],

  // The worker rate-limits per cf-connecting-ip (60/min); give every test its own client address.
  extraHTTPHeaders: async ({}, use) => {
    ipCounter += 1;
    await use({ 'cf-connecting-ip': `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` });
  },

  page: async ({ page, theme, fonts }, use) => {
    // Hard guard: tests must never reach the real Melee. Fonts are blocked to keep runs hermetic.
    const forbidden: string[] = [];
    await page.route(/^https?:\/\/([^/]*\.)?melee\.gg(\/|$)/, (route) => {
      forbidden.push(route.request().url());
      return route.abort();
    });
    if (!fonts) {
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    }
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('swu-tcc:theme', t);
      } catch {
        /* ignore */
      }
    }, theme);
    await page.emulateMedia({ colorScheme: theme });
    await use(page);
    expect(forbidden, 'requests to the real Melee.gg').toEqual([]);
  },
});

export { expect };

/** Fake-Melee request counts, keyed "METHOD path". */
export async function upstreamStats(request: import('@playwright/test').APIRequestContext): Promise<Record<string, number>> {
  const res = await request.get(`${FAKE_MELEE}/__stats`);
  return (await res.json()) as Record<string, number>;
}

/** Open a tournament and click a player's name in the standings. */
export async function openPlayer(page: Page, tournamentId: string, name: string) {
  await page.goto(`/t/${tournamentId}`);
  await page.getByRole('table').getByRole('link', { name, exact: true }).click();
  await expect(page.getByTestId('verdict')).toBeVisible();
}
