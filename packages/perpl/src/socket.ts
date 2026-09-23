// Thin wrapper over Node's global WebSocket: parse every frame once, fan out to listeners,
// and let callers await the next matching message. Listeners must stay cheap (ADR 0003).
// Long-lived clients (trading.ts, market.ts) reconnect by opening a new socket in a loop.

import type { Message } from './types.ts';

export interface Socket {
  send(data: string): void;
  /** Resolves with the next message that matches, or rejects after timeoutMs or on close. */
  next<T extends Message = Message>(match: (m: Message) => boolean, timeoutMs?: number): Promise<T>;
  /** Calls fn for every message with its local receive time. Returns an unsubscribe function. */
  listen(fn: (m: Message, receivedAt: number) => void): () => void;
  close(code?: number, reason?: string): void;
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly isOpen: boolean;
}

/** Anything shaped like the WHATWG WebSocket constructor; tests pass a fake. */
export type WebSocketCtor = new (url: string) => WebSocket;

export function openSocket(
  url: string,
  firstFrame?: () => string,
  WS: WebSocketCtor = WebSocket,
): Promise<Socket> {
  const ws = new WS(url);
  const listeners = new Set<(m: Message, at: number) => void>();
  const waiters = new Set<(err: Error) => void>();

  ws.addEventListener('message', (ev) => {
    const at = performance.now();
    let msg: Message;
    try {
      msg = JSON.parse(String(ev.data)) as Message;
    } catch {
      return; // A frame we can't parse can't be acted on. Drop it rather than crash.
    }
    for (const fn of listeners) fn(msg, at);
  });

  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener('close', (ev) => {
      for (const reject of waiters) reject(new Error(`socket closed (${ev.code} ${ev.reason})`));
      waiters.clear();
      resolve({ code: ev.code, reason: ev.reason });
    }),
  );

  const socket: Socket = {
    send: (data) => ws.send(data),
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    next(match, timeoutMs = 15_000) {
      return new Promise((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          stop();
          waiters.delete(fail);
        };
        const fail = (err: Error) => {
          done();
          reject(err);
        };
        const timer = setTimeout(
          () => fail(new Error(`timed out after ${timeoutMs} ms waiting for a message on ${url}`)),
          timeoutMs,
        );
        const stop = socket.listen((m) => {
          if (!match(m)) return;
          done();
          resolve(m as never);
        });
        waiters.add(fail);
      });
    },
    close: (code, reason) => ws.close(code, reason),
    closed,
    get isOpen() {
      return ws.readyState === 1;
    },
  };

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      // Perpl closes sockets that stay silent past the idle timeout, sign-in included.
      if (firstFrame) ws.send(firstFrame());
      resolve(socket);
    });
    ws.addEventListener('error', () => reject(new Error(`could not open ${url}`)));
  });
}

/** Waits for the socket to close, closing it first if `signal` aborts. */
export async function untilClosed(
  socket: Socket,
  signal: AbortSignal,
): Promise<{ code: number; reason: string }> {
  const onAbort = () => socket.close(1000, 'stopping');
  if (signal.aborted) onAbort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await socket.closed;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/** Reconnect delays from Perpl's docs, then 60 s. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000];
export const backoff = (attempt: number): number =>
  BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 60_000;
