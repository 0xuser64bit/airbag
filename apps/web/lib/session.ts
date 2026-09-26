'use client';

// The engine session: a bearer token from Sign-In with Ethereum (ADR 0011). It lives in this
// browser's localStorage and can only change settings; it can never read the API secret.

import { useEffect, useState } from 'react';

export interface Session {
  token: string;
  wallet: string;
  expiresAt: number;
}

const KEY = 'airbag.session';
const listeners = new Set<() => void>();

export function loadSession(): Session | null {
  if (memoryOnly) return valid(memory) ? memory : null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return valid(memory) ? memory : null;
  }
  try {
    const s = raw ? (JSON.parse(raw) as Session) : null;
    memory = valid(s) ? s : null;
    return memory;
  } catch {
    memory = null;
    return null;
  }
}

export function saveSession(s: Session): void {
  memoryOnly = false;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: the session lasts this page only.
    memoryOnly = true;
  }
  memory = s;
  for (const fn of listeners) fn();
}

export function clearSession(): void {
  memoryOnly = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  memory = null;
  for (const fn of listeners) fn();
}

let memory: Session | null = null;
let memoryOnly = false;
const valid = (s: Session | null): s is Session =>
  !!s &&
  typeof s.token === 'string' &&
  /^[A-Za-z0-9_-]{43}$/.test(s.token) &&
  typeof s.wallet === 'string' &&
  /^0x[0-9a-fA-F]{40}$/.test(s.wallet) &&
  Number.isFinite(s.expiresAt) &&
  s.expiresAt > Date.now();

/** The current session: undefined while reading storage on first render. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setSession(loadSession());
    const sync = () => {
      memoryOnly = false;
      read();
    };
    read();
    listeners.add(read);
    window.addEventListener('storage', sync);
    return () => {
      listeners.delete(read);
      window.removeEventListener('storage', sync);
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => {
        clearSession();
      },
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  return session;
}

export function currentToken(): string | undefined {
  return loadSession()?.token;
}
