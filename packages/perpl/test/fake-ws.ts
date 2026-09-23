// An in-memory WebSocket for driving clients in tests. The test plays the server.
import type { WebSocketCtor } from '../src/socket.ts';

export class FakeSocket extends EventTarget {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
  }
  /** Server side: deliver a frame to the client. */
  push(msg: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(msg) }));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
}

export function fakeServer() {
  const sockets: FakeSocket[] = [];
  const WebSocket = class extends FakeSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
      queueMicrotask(() => this.open());
    }
  } as unknown as WebSocketCtor;
  return {
    WebSocket,
    sockets,
    get last(): FakeSocket {
      const s = sockets.at(-1);
      if (!s) throw new Error('no socket opened yet');
      return s;
    },
  };
}

/** Lets queued microtasks and immediate callbacks run. */
export const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
};
