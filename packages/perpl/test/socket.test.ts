import { afterEach, expect, it, vi } from 'vitest';
import { openSocket, type WebSocketCtor } from '../src/socket.ts';
import { FakeSocket } from './fake-ws.ts';

afterEach(() => vi.useRealTimers());

it('bounds and aborts a connection that never opens', async () => {
  vi.useFakeTimers();
  const sockets: FakeSocket[] = [];
  const WS = class extends FakeSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  } as unknown as WebSocketCtor;
  const timeout = expect(openSocket('wss://test', undefined, WS)).rejects.toThrow(/10 seconds/);
  await vi.advanceTimersByTimeAsync(10_000);
  await timeout;
  expect(sockets[0]?.readyState).toBe(3);
  const ctl = new AbortController();
  const opening = openSocket('wss://test', undefined, WS, ctl.signal);
  ctl.abort();
  await expect(opening).rejects.toThrow(/aborted/);
  expect(sockets[1]?.readyState).toBe(3);
});
