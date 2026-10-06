// JSON-lines logger. Never logs secrets: any field whose name looks sensitive is redacted,
// however deep it sits (ADR 0003).

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE =
  /secret|api_?key|apikey|signature|private|password|token|authorization|master|cookie/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  level: Level = 'info',
  base: Record<string, unknown> = {},
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const min = ORDER[level];
  const emit =
    (lvl: Level) =>
    (event: string, fields: Record<string, unknown> = {}) => {
      if (ORDER[lvl] < min) return;
      const record = redact({ ...base, ...fields }) as Record<string, unknown>;
      write(JSON.stringify({ t: new Date().toISOString(), level: lvl, event, ...record }));
    };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (fields) => createLogger(level, { ...base, ...fields }, write),
  };
}

export const isLevel = (v: string | undefined): v is Level => !!v && v in ORDER;
