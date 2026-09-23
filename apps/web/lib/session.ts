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
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.token || !s.wallet || s.expiresAt <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: the session lasts this page only.
  }
  memory = s;
  for (const fn of listeners) fn();
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  memory = null;
  for (const fn of listeners) fn();
}

let memory: Session | null = null;

/** The current session: undefined while reading storage on first render. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setSession(loadSession() ?? memory);
    read();
    listeners.add(read);
    window.addEventListener('storage', read);
    return () => {
      listeners.delete(read);
      window.removeEventListener('storage', read);
    };
  }, []);
  return session;
}

export function currentToken(): string | undefined {
  return (loadSession() ?? memory)?.token;
}
