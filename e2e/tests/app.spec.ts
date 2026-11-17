import { expect, openPlayer, T, test, upstreamStats } from './fixtures';

test.describe('landing', () => {
  test('pasting a Melee link goes to the tournament page', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Paste your Melee.gg tournament link').fill('https://melee.gg/Tournament/View/484511');
    await page.getByRole('button', { name: 'Load standings' }).click();
    await expect(page).toHaveURL(/\/t\/484511$/);
  });

  test('rejects text that is not a Melee link', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Paste your Melee.gg tournament link').fill('hello');
    await page.getByLabel('Paste your Melee.gg tournament link').press('Enter');
    await expect(page.getByRole('alert')).toContainText('does not look like a Melee.gg tournament link');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('live event, after round 5', () => {
  test('tournament page: header, cut line and player search', async ({ page }) => {
    await page.goto(`/t/${T.live}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.event-meta').first()).toContainText('52 PLAYERS · SWISS 6 · TOP 8');

    const rows = page.locator('table.standings tbody tr:not(.cut-row)');
    await expect(rows).toHaveCount(52);
    // The cut line sits directly after rank 8.
    const cut = page.locator('table.standings tbody tr.cut-row');
    await expect(cut).toHaveCount(1);
    await expect(cut).toContainText('CUT · TOP 8');
    await expect(cut.locator('xpath=preceding-sibling::tr[1]/td[1]')).toHaveText('8');
    await expect(cut.locator('xpath=following-sibling::tr[1]/td[1]')).toHaveText('9');
    await expect(cut.locator('.tcc-cut-line')).toHaveCSS('border-top-style', 'dashed');

    const search = page.getByRole('combobox', { name: 'Find your name' });
    await search.fill('Player 003');
    const option = page.getByRole('option', { name: /Player 003/ });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(page.getByRole('link', { name: /Analyze Player 003/ })).toBeVisible();
  });

  test('player page: honest ID SAFE verdict, scenarios and next opponent', async ({ page }) => {
    await openPlayer(page, T.live, 'Player 003');

    const verdict = page.getByTestId('verdict');
    const chip = verdict.locator('.chip');
    await expect(chip).toContainText('ID SAFE');
    await expect(chip.locator('svg[data-status-icon="id-safe"]')).toBeVisible();

    // Honest odds: never a bare 100%.
    const pct = (await verdict.getByTestId('verdict-pct').innerText()).trim();
    expect(pct).not.toBe('100%');
    expect(pct).toBe('>99%');

    const scenarios = page.locator('ul.scenarios > li');
    await expect(scenarios).toHaveCount(3);
    await expect(scenarios.nth(0)).toContainText('Win');
    await expect(scenarios.nth(0)).toContainText('15 PTS');
    await expect(scenarios.nth(1)).toContainText('Draw');
    await expect(scenarios.nth(1)).toContainText('13 PTS');
    await expect(scenarios.nth(2)).toContainText('Loss');
    await expect(scenarios.nth(2)).toContainText('12 PTS');

    const opp = page.locator('.opp');
    await expect(opp).toContainText('Player 018');
    await expect(opp).toContainText('PREDICTED');

    const details = page.locator('details.disclosure');
    await expect(details).not.toHaveAttribute('open', '');
    await details.getByText('Assumptions', { exact: true }).click();
    await expect(details).toHaveAttribute('open', '');
    expect(await details.locator('li').count()).toBeGreaterThan(0);
  });

  test('what-if: a smaller cut changes Player 003\'s verdict', async ({ page }) => {
    await openPlayer(page, T.live, 'Player 003');
    await expect(page.getByTestId('verdict').locator('.chip')).toContainText('ID SAFE');

    await page.getByRole('radio', { name: 'Top 4' }).check();
    await expect(page.getByTestId('verdict').locator('.chip')).not.toContainText('ID SAFE');
    await expect(page.getByTestId('verdict')).toContainText('top 4');
    await expect(page.locator('table.standings tr.cut-row').first()).toContainText('CUT · TOP 4');

    await page.getByRole('button', { name: 'Reset to event structure' }).click();
    await expect(page.getByTestId('verdict').locator('.chip')).toContainText('ID SAFE');
  });
});

test('finished event loads with final standings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/t/${T.finished}`);
  await expect(page.locator('.event-meta').first()).toContainText('52 PLAYERS · SWISS 6 · TOP 8');
  await expect(page.locator('table.standings tbody tr:not(.cut-row)')).toHaveCount(52);
  await expect(page.locator('.event-meta').first()).toContainText('6 ROUNDS DONE');
  // Player 003 finished 7th, inside the top 8.
  const focus = page.locator('table.standings tbody tr', { hasText: 'Player 003' });
  await expect(focus.locator('td.rank')).toHaveText('7');

  await focus.getByRole('link', { name: 'Player 003', exact: true }).click();
  await expect(page.getByTestId('verdict')).toBeVisible();
  await expect(page.getByTestId('verdict')).toContainText('top 8');
  expect(errors).toEqual([]);
});

test.describe('error states', () => {
  test('Melee 403 shows the blocked message with a manual-entry link', async ({ page }) => {
    await page.goto(`/t/${T.blocked}`);
    await expect(page.getByRole('heading', { name: 'Melee blocked the request' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Enter standings by hand' })).toHaveAttribute('href', '/manual');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a 302 to an HTML error page is reported as an upstream error', async ({ page }) => {
    await page.goto(`/t/${T.redirect}`);
    await expect(page.getByRole('heading', { name: 'Melee blocked the request' })).toBeVisible();
  });

  test('unknown tournament id shows "Tournament not found"', async ({ page }) => {
    await page.goto(`/t/${T.unknown}`);
    await expect(page.getByRole('heading', { name: 'Tournament not found' })).toBeVisible();
  });

  test('a slow upstream shows a loading state, then the data', async ({ page }) => {
    await page.goto(`/t/${T.slow}`);
    await expect(page.getByRole('status').or(page.getByText(/Fetching standings/)).first()).toBeVisible();
    await expect(page.locator('table.standings')).toBeVisible({ timeout: 30_000 });
  });
});

test('the worker caches: a second visitor causes no new upstream requests', async ({ page, browser, request }) => {
  // A unique id inside the fake's "clone" range, so counts are ours alone.
  const id = String(910000 + Math.floor(Math.random() * 9000));
  await page.goto(`/t/${id}`);
  await expect(page.locator('table.standings')).toBeVisible();

  const first = await upstreamStats(request);
  expect(first[`GET /Tournament/View/${id}`]).toBe(1);
  expect(first[`GET /Standing/GetStandingsConfig/${id}`]).toBe(1);

  // A fresh browser context has no HTTP cache, so only the worker's edge cache can answer.
  const other = await browser.newContext({ extraHTTPHeaders: { 'cf-connecting-ip': '10.9.9.9' } });
  const page2 = await other.newPage();
  await page2.goto(`/t/${id}`);
  await expect(page2.locator('table.standings')).toBeVisible();
  await other.close();

  const second = await upstreamStats(request);
  expect(second).toEqual(first);
  // Every endpoint was hit exactly once.
  for (const [key, count] of Object.entries(second)) {
    if (key.includes(id) || key.includes('GetRound')) expect(count, key).toBe(1);
  }
  expect(Object.keys(second).some((k) => k.startsWith('GET /Match/') || k.startsWith('POST /Match/'))).toBe(true);
});
