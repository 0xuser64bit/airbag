import { checkA11y, checkNoOverflow, expect, test } from './fixtures.ts';

test('landing page: the crash test plays and the page is accessible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Get trimmed');
  await expect(page.getByText('Crash test · BTC long · 10x')).toBeVisible();
  // The replay reaches the trim within a few seconds of frames.
  await expect(
    page.getByText(/Trimmed 0\.489 BTC, fee \$0\. Liquidation now \$87,300/),
  ).toBeVisible({
    timeout: 15_000,
  });
  await checkA11y(page, 'landing');
});

test('onboarding to a deploy and a save, as a trader would', async ({ page, wallet }) => {
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

  // 2b. Reset the shared simulation to its baseline. A wick from an earlier run (or a
  // retry of this journey) leaves BTC at $100,000; only a fresh engine sits at $99,420.
  // A signed-in wallet counts as connected, so connect shows the baseline right away.
  await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('airbag.session') ?? '{}') as { token?: string };
    const res = await fetch('http://localhost:8787/v1/sim/reset', {
      method: 'POST',
      headers: { authorization: `Bearer ${s.token ?? ''}` },
    });
    if (!res.ok) throw new Error(`sim reset failed: ${res.status}`);
  });
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
});

test('a phone gets the tab bar and no sideways scrolling', async ({ page, wallet }) => {
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
