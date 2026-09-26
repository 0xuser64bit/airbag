import { afterEach, expect, it, vi } from 'vitest';
import { clearSession, currentToken, loadSession, saveSession } from './session.ts';

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

it('does not resurrect an expired session or a session cleared by another tab', () => {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => items.set(k, v),
    removeItem: (k: string) => items.delete(k),
  });
  const session = {
    token: 'a'.repeat(43),
    wallet: `0x${'1'.repeat(40)}`,
    expiresAt: Date.now() + 1_000,
  };
  saveSession(session);
  expect(currentToken()).toBe(session.token);
  items.clear();
  expect(currentToken()).toBeUndefined();
  saveSession({ ...session, expiresAt: 1 });
  expect(loadSession()).toBeNull();
  items.set('airbag.session', '{broken');
  expect(loadSession()).toBeNull();
});

it('keeps a memory-only session if storage is blocked, but still respects expiry', () => {
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {},
  });
  saveSession({
    token: 'a'.repeat(43),
    wallet: `0x${'1'.repeat(40)}`,
    expiresAt: Date.now() + 1_000,
  });
  expect(currentToken()).toBe('a'.repeat(43));
  saveSession({ token: 'a'.repeat(43), wallet: `0x${'1'.repeat(40)}`, expiresAt: 1 });
  expect(currentToken()).toBeUndefined();
});

it('keeps the session if storage can be read but refuses writes', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem() {
      throw new Error('quota exceeded');
    },
    removeItem() {},
  });
  saveSession({
    token: 'a'.repeat(43),
    wallet: `0x${'1'.repeat(40)}`,
    expiresAt: Date.now() + 1_000,
  });
  expect(currentToken()).toBe('a'.repeat(43));
});
