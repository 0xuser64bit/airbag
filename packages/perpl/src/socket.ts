// Thin wrapper over Node's global WebSocket: parse every frame once, fan out to listeners,
// and let callers await the next matching message. Listeners must stay cheap (ADR 0003).

import type { Message } from './types.ts';

export interface Socket {
  send(data: string): void;
  /** Resolves with the next message that matches, or rejects after timeoutMs. */
  next<T extends Message = Message>(match: (m: Message) => boolean, timeoutMs?: number): Promise<T>;
  /** Calls fn for every message with its local receive time. Returns an unsubscribe function. */
  listen(fn: (m: Message, receivedAt: number) => void): () => void;
  close(): void;
  readonly closed: Promise<{ code: number; reason: string }>;
}

export function openSocket(url: string, firstFrame?: () => string): Promise<Socket> {
  const ws = new WebSocket(url);
  const listeners = new Set<(m: Message, at: number) => void>();

  ws.addEventListener('message', (ev) => {
    const at = performance.now();
    const msg = JSON.parse(String(ev.data)) as Message;
    for (const fn of listeners) fn(msg, at);
  });

  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener('close', (ev) => resolve({ code: ev.code, reason: ev.reason })),
  );

  const socket: Socket = {
    send: (data) => ws.send(data),
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    next(match, timeoutMs = 15_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          stop();
          reject(new Error(`timed out after ${timeoutMs} ms waiting for a message on ${url}`));
        }, timeoutMs);
        const stop = socket.listen((m) => {
          if (!match(m)) return;
          clearTimeout(timer);
          stop();
          resolve(m as never);
        });
        closed.then(({ code, reason }) => {
          clearTimeout(timer);
          stop();
          reject(new Error(`socket closed (${code} ${reason}) while waiting`));
        });
      });
    },
    close: () => ws.close(),
    closed,
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
