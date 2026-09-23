// Public configuration, inlined at build time.

/** The engine API, called from the browser with a bearer token. */
export const ENGINE_URL = (process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:8787').replace(
  /\/$/,
  '',
);

/** The same engine, as the web server reaches it (save reports, OG images). */
export const ENGINE_URL_SERVER = (process.env.ENGINE_URL ?? ENGINE_URL).replace(/\/$/, '');

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL ?? 'https://github.com/0xuser64bit/airbag';
