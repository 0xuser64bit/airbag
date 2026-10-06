// Telegram alerts: the same messages as Web Push, to the chats traders linked. A trader opens the
// bot from Settings with a one-time code (/start <code>) and sends /stop to end it. The engine
// long-polls the Bot API, so it needs no public webhook. Off without TELEGRAM_BOT_TOKEN.

import { randomBytes } from 'node:crypto';
import { fmt } from '@airbag/risk';
import type { Store } from './db.ts';
import type { Logger } from './log.ts';
import type { PushMessage } from './notify.ts';

export interface TelegramConfig {
  token: string;
  /** The bot's @username, for t.me links. */
  username: string;
}

interface Update {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

const CODE_MS = 10 * 60_000;

export class Telegram {
  readonly username: string;
  private readonly token: string;
  private readonly store: Store;
  private readonly log: Logger;
  /** Where links in messages point: the app's origin. */
  private readonly siteUrl: string;
  private readonly simulated: boolean;
  private readonly fetchFn: typeof fetch;
  private readonly codes = new Map<string, { wallet: string; expires: number }>();
  private offset = 0;
  private polling: AbortController | undefined;

  constructor(opts: {
    cfg: TelegramConfig;
    store: Store;
    log: Logger;
    siteUrl: string;
    simulated: boolean;
    fetchFn?: typeof fetch;
  }) {
    this.username = opts.cfg.username;
    this.token = opts.cfg.token;
    this.store = opts.store;
    this.log = opts.log;
    this.siteUrl = opts.siteUrl;
    this.simulated = opts.simulated;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /** A t.me link that ties the chat that presses Start to this wallet; one use, ten minutes. */
  linkUrl(wallet: string, now = Date.now()): string {
    for (const [code, v] of this.codes) if (v.expires < now) this.codes.delete(code);
    // Bound the pending codes: evict the oldest instead of growing without limit.
    while (this.codes.size >= 10_000) {
      const oldest = this.codes.keys().next().value;
      if (oldest === undefined) break;
      this.codes.delete(oldest);
    }
    const code = randomBytes(12).toString('base64url');
    this.codes.set(code, { wallet, expires: now + CODE_MS });
    return `https://t.me/${this.username}?start=${code}`;
  }

  private async call<T>(method: string, body: object, signal?: AbortSignal): Promise<T> {
    // The token is in the URL: errors below never include it.
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; error_code?: number };
    if (!json.ok)
      throw Object.assign(new Error(`Telegram ${method} failed`), { status: json.error_code });
    return json.result as T;
  }

  private reply(chatId: number | string, text: string) {
    return this.call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  }

  /** One update from the bot's chat: /start <code> links a wallet, /stop unlinks this chat. */
  async handle(update: Update, now = Date.now()): Promise<void> {
    const chat = update.message?.chat.id;
    const text = update.message?.text?.trim() ?? '';
    if (chat === undefined) return;
    const start = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text);
    if (start) {
      const link = this.codes.get(start[1] ?? '');
      this.codes.delete(start[1] ?? '');
      if (!link || link.expires < now) {
        await this.reply(
          chat,
          'That link has expired. Open Settings in Airbag and connect Telegram again.',
        );
        return;
      }
      this.store.putTelegramChat(link.wallet, String(chat), now);
      this.log.info('telegram.linked', { wallet: link.wallet });
      await this.reply(
        chat,
        `${this.simulated ? 'Simulated · ' : ''}Linked to ${fmt.short(link.wallet)}. Airbag will message you here when it trims, adds margin or saves a position, and when it needs you. Send /stop to turn this off.`,
      );
      return;
    }
    if (/^\/stop(?:@\w+)?$/.test(text)) {
      this.store.deleteTelegramChat({ chatId: String(chat) });
      await this.reply(chat, 'Stopped. Airbag won’t message you here.');
    }
  }

  /** Long-polls for updates until stopped; a failed poll waits five seconds. */
  start(): void {
    if (this.polling) return;
    const controller = new AbortController();
    this.polling = controller;
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const updates = await this.call<Update[]>(
            'getUpdates',
            { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
            AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]),
          );
          for (const u of updates) {
            this.offset = u.update_id + 1;
            await this.handle(u).catch((err: unknown) => this.log.warn('telegram.update', { err }));
          }
          // Telegram holds an empty poll for 25 s; one answered at once must not spin the loop.
          if (updates.length === 0) await new Promise((r) => setTimeout(r, 1_000));
        } catch (err) {
          if (controller.signal.aborted) break;
          this.log.warn('telegram.poll', { status: (err as { status?: number }).status });
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
    })();
  }

  stop(): void {
    this.polling?.abort();
    this.polling = undefined;
  }

  /** Sends an alert to the wallet's chat, if it linked one. A blocked bot unlinks the chat. */
  async send(wallet: string, msg: PushMessage): Promise<void> {
    const chat = this.store.telegramChat(wallet);
    if (!chat) return;
    const title = this.simulated ? `Simulated · ${msg.title}` : msg.title;
    try {
      await this.reply(chat, `${title}\n${msg.body}\n${this.siteUrl}${msg.url}`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403) this.store.deleteTelegramChat({ chatId: chat });
      else throw err;
    }
  }
}
