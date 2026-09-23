// A test wallet: an EIP-6963 provider injected into the page whose personal_sign is done in
// Node by a throwaway viem account, so Sign-In with Ethereum runs for real.

import { AxeBuilder } from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export const test = base.extend<{ wallet: `0x${string}` }>({
  wallet: async ({ page }, use) => {
    const account = privateKeyToAccount(generatePrivateKey());
    await page.exposeFunction('__airbagTestSign', (hex: `0x${string}`) =>
      account.signMessage({ message: { raw: hex } }),
    );
    await page.addInitScript((address: string) => {
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
          if (method === 'eth_chainId') return '0x279f';
          if (method === 'personal_sign') {
            const sign = (window as unknown as { __airbagTestSign: (h: string) => Promise<string> })
              .__airbagTestSign;
            return sign(String(params?.[0]));
          }
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
        },
        on() {},
        removeListener() {},
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: Object.freeze({
              info: { uuid: 'test-wallet', name: 'Test Wallet', icon: '', rdns: 'xyz.airbag.test' },
              provider,
            }),
          }),
        );
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    }, account.address);
    await use(account.address);
  },
});

export { expect };

/** Fails on serious or critical WCAG 2.1 A/AA violations. */
export async function checkA11y(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')}`,
    ),
    `accessibility on ${name}`,
  ).toEqual([]);
}

/** No horizontal scrolling at the current viewport. */
export async function checkNoOverflow(page: Page) {
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
}
