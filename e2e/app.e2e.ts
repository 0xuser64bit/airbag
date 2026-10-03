import { checkA11y, checkNoOverflow, ENGINE_URL, expect, test } from './fixtures.ts';

test('landing page: the crash test plays and the page is accessible', async ({ page }) => {
  await page.goto('/');
  // The splash (one loader cycle docking into the masthead) clears itself off the page.
  await expect(page.locator('[data-splash]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Get trimmed');
  await expect(page.getByText('Crash test · BTC long · 10x')).toBeVisible();
  // The replay reaches the trim within a few seconds of frames.
  await expect(
    page.getByText(/Trimmed 0\.489 BTC, fee \$0\. Liquidation now \$87,300/),
  ).toBeVisible({
    timeout: 15_000,
  });
  await checkA11y(page, 'landing');
  // A shared link to the site unfurls into the crash test, not a bare URL.
  const og = await page.request.get('/opengraph-image');
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toBe('image/png');
});

test('onboarding to a deploy and a save, as a trader would', async ({ page, wallet }, testInfo) => {
  // 1. Connect: the wallet is found, the Perpl account is looked up.
  await page.goto('/connect');
  await page.getByRole('button', { name: 'Connect Test Wallet' }).click();
  await expect(
    page.getByText(`${wallet.slice(0, 6)}…${wallet.slice(-4)}`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/Found your Perpl account/)).toBeVisible();

  // 2. Sign in with Ethereum on the way to linking a key.
  await page.getByRole('button', { name: 'Link a Perpl key' }).click();
  await expect(page).toHaveURL(/\/link-key$/);
  await expect(page.getByRole('heading', { name: 'Link a key that can’t withdraw' })).toBeVisible();
  await checkA11y(page, 'link-key');
  await page.getByRole('button', { name: 'Use a test key' }).click();
  await page.getByRole('button', { name: 'Verify key' }).click();
  await expect(page.getByText(/Key verified/)).toBeVisible();

  // 2b. Reset puts this wallet's paper account and prices back to the start. Prices are per
  // wallet, so nothing another journey played can move them; this exercises the reset.
  // A signed-in wallet counts as connected, so connect shows the baseline right away.
  await page.evaluate(async (engineUrl) => {
    const s = JSON.parse(localStorage.getItem('airbag.session') ?? '{}') as { token?: string };
    const res = await fetch(`${engineUrl}/v1/sim/reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${s.token ?? ''}` },
    });
    if (!res.ok) throw new Error(`sim reset failed: ${res.status}`);
  }, ENGINE_URL);
  await page.goto('/connect');
  await expect(page.getByText('5.45%', { exact: false }).first()).toBeVisible();
  // The key button is disabled until the engine config loads; axe would grade its
  // deliberately unlit disabled face, so check the settled, enabled page instead.
  await expect(page.getByRole('button', { name: 'Link a Perpl key' })).toBeEnabled();
  // The enabled flip animates the button's colors for 120 ms; wait it out so axe
  // grades the settled yellow, not a mid-transition blend.
  await page.waitForTimeout(250);
  await checkA11y(page, 'connect');

  // 3. Settings: the preview runs the risk math on the account's BTC long.
  // (The key is already linked above; the setup page is the next step.)
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/setup$/);
  const preview = page.locator('aside[aria-live]');
  await expect(preview).toContainText('Preview on your BTC long');
  await expect(preview).toContainText('0.489 BTC (48.9%)');
  await expect(preview).toContainText('$87,300 (10.00% away)');
  await page.getByRole('button', { name: /^Late/ }).click();
  await expect(preview).toContainText('Capped at 50%');
  await page.getByRole('button', { name: /^Balanced/ }).click();
  await checkA11y(page, 'setup');
  await page.getByRole('button', { name: 'Arm Airbag' }).click();

  // 4. Dashboard, armed.
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('status').filter({ hasText: 'Armed' }).first()).toBeVisible();
  await expect(page.getByText('If BTC reaches $97,000, Airbag trims 0.489 BTC')).toBeVisible();
  await checkA11y(page, 'dashboard');
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true });

  // 5. The crash-test wick through the engine: trim, re-add, re-arm, then a save.
  await page.getByRole('button', { name: 'Play a wick on BTC' }).click();
  await expect(page.getByRole('heading', { name: 'Trimmed 0.489 BTC at $97,000' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Re-armed at $92,150 on 0.511 BTC.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await checkA11y(page, 'dashboard after a deploy');
  // The wick ends back at $100,000 (entry and mark), where the design measures the save.
  const btc = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: /BTC long/ }) });
  await expect(btc).toContainText('MARK $100,000', { timeout: 20_000 });
  await expect(btc).toContainText('ENTRY $100,000');

  // 6. The deploy's page and its public save report.
  await page
    .getByRole('link', { name: /BTC long/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Trimmed 0.489 BTC at $97,000' })).toBeVisible();
  await checkA11y(page, 'deploy detail');
  await page.getByRole('link', { name: 'See the save report' }).click();
  // A heading, not text: Next's route announcer can repeat the h1 while streamed metadata lands.
  await expect(page.getByRole('heading', { name: 'kept versus a liquidation' })).toBeVisible();
  await expect(page.getByText('$5,333', { exact: true })).toBeVisible();
  await checkA11y(page, 'save report');
  const og = await page.request.get(`${page.url()}/opengraph-image`);
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toBe('image/png');

  // Sharing works without a share sheet: the card itself, a link to copy, a PNG to keep.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Share save card' }).click();
  const share = page.getByRole('dialog', { name: 'Share your save card' });
  await expect(share.getByRole('img')).toBeVisible();
  await share.getByRole('button', { name: 'Copy link' }).click();
  await expect(share.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  await expect(share.getByRole('link', { name: 'Download PNG' })).toHaveAttribute(
    'download',
    /\.png$/,
  );
  await expect(share.getByRole('link', { name: /Post on X/ })).toHaveAttribute(
    'href',
    /^https:\/\/x\.com\/intent\/tweet\?text=Simulated/,
  );
  await checkA11y(page, 'share dialog');
  await page.keyboard.press('Escape');
  await expect(share).toBeHidden();
});

test('a phone gets the tab bar and no sideways scrolling', async ({ page, wallet }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/', '/connect']) {
    await page.goto(path);
    await checkNoOverflow(page);
  }
  await page.getByRole('button', { name: 'Connect Test Wallet' }).click();
  await page.getByRole('button', { name: 'Link a Perpl key' }).click();
  await page.getByRole('button', { name: 'Use a test key' }).click();
  await page.getByRole('button', { name: 'Verify key' }).click();
  await page.getByRole('link', { name: 'Set your airbag' }).click();
  await page.getByRole('button', { name: 'Arm Airbag' }).click();
  await expect(page).toHaveURL(/\/app$/);
  const tabs = page.getByRole('navigation', { name: 'App' }).last();
  await expect(tabs.getByRole('link', { name: 'Deploys' })).toBeVisible();
  await checkNoOverflow(page);
  await checkA11y(page, 'phone dashboard');
  await page.screenshot({ path: testInfo.outputPath('dashboard-phone.png'), fullPage: true });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Paused' }).first()).toBeVisible();
  await tabs.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'More distance' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await checkNoOverflow(page);
  await checkA11y(page, 'phone settings');
  // Deliver one real dashboard frame and then interrupt the stream. Keep the last state
  // visible, explain its age, and recover when the real stream becomes available again.
  const state = await page.evaluate(async (engineUrl) => {
    const { token } = JSON.parse(localStorage.getItem('airbag.session') ?? '{}');
    return (
      await fetch(`${engineUrl}/v1/state`, { headers: { authorization: `Bearer ${token}` } })
    ).json();
  }, ENGINE_URL);
  let delivered = false;
  await page.route('**/v1/stream', async (route) => {
    if (delivered) return route.abort();
    delivered = true;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify(state)}\n\n`,
    });
  });
  await page.reload();
  await expect(page.getByText('Unknown', { exact: true })).toBeVisible();
  await expect(page.getByText(/What you see is the last block/)).toBeVisible();
  await page.unroute('**/v1/stream');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  const other = await page.context().newPage();
  await other.goto('/app/settings');
  await other.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/connect$/);
  await other.close();
  expect(wallet).toMatch(/^0x/);
});

test('without a wallet extension, simulation offers a test wallet that signs in', async ({
  page,
}) => {
  // No injected wallet here: the list only shows once discovery gives up on finding one.
  await page.goto('/connect');
  await page.getByRole('button', { name: 'Connect a test wallet' }).click();
  await expect(page.getByText(/Found your Perpl account/)).toBeVisible();
  await page.getByRole('button', { name: 'Link a Perpl key' }).click();
  await expect(page).toHaveURL(/\/link-key$/);
});

test('private pages send a signed-out visitor to connect; unknown saves 404', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/connect$/);
  const res = await page.goto('/s/doesnotexist');
  expect(res?.status()).toBe(404);
});

test('an unavailable engine is explained and the config can be retried', async ({ page }) => {
  await page.route('**/v1/config', (route) => route.abort());
  await page.goto('/connect');
  await expect(page.locator('.notice[role="alert"]')).toContainText("Can't reach Airbag");
  await page.unroute('**/v1/config');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect a test wallet' })).toBeVisible();
});

test('the backtest: every liquidation replayed, each with its own page', async ({ page }) => {
  await page.goto('/backtest');
  await expect(page.locator('[data-splash]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Every Perpl liquidation, replayed through Airbag',
  );
  await expect(page.getByText('were still open when Perpl liquidated')).toBeVisible();
  await checkA11y(page, 'backtest');
  const og = await page.request.get('/backtest/opengraph-image');
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toBe('image/png');
  await checkNoOverflow(page);
  // The folded rows open in place; every row links to its liquidation.
  await page.getByText(/^Show the other \d+$/).click();
  await page
    .getByRole('link', { name: /long|short/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/backtest\/\d+-\d+$/);
  await expect(page.getByRole('heading', { name: 'Block log' })).toBeVisible();
  await expect(page.getByText(/Perpl liquidated the original at a mark of/)).toBeVisible();
  await expect(page.getByRole('link', { name: /The liquidation on MonadVision/ })).toHaveAttribute(
    'href',
    /^https:\/\/monadvision\.com\/tx\/0x[0-9a-f]{64}$/,
  );
  await checkA11y(page, 'backtest liquidation');
  await page.setViewportSize({ width: 375, height: 812 });
  await checkNoOverflow(page);
  expect((await page.goto('/backtest/0-0'))?.status()).toBe(404);
});

test('paused, a wick liquidates the paper position and the dashboard says so', async ({
  page,
  wallet,
}) => {
  await page.goto('/connect');
  await page.getByRole('button', { name: 'Connect Test Wallet' }).click();
  await page.getByRole('button', { name: 'Link a Perpl key' }).click();
  await page.getByRole('button', { name: 'Use a test key' }).click();
  await page.getByRole('button', { name: 'Verify key' }).click();
  await expect(page.getByText(/Key verified/)).toBeVisible();
  // Linked but never armed: Airbag watches and does nothing.
  await page.goto('/app');
  await page.getByRole('button', { name: 'Play a wick on BTC' }).click();
  const notice = page.getByRole('status').filter({ hasText: 'was liquidated at' });
  await expect(notice).toContainText('Your BTC long was liquidated at $94,000', {
    timeout: 20_000,
  });
  await expect(notice).toContainText('$3,200, 80% of what was left');
  await checkA11y(page, 'dashboard after a liquidation');
  await notice.getByRole('button', { name: 'Reset account' }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /BTC long/ }).first()).toBeVisible();
  expect(wallet).toMatch(/^0x/);
});
