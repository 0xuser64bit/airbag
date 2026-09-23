// Envelope encryption for Perpl API keys (ADR 0006). Each secret gets its own random data key
// (AES-256-GCM, 96-bit nonce); the data key is wrapped with the master key from the host's
// secret store. Associated data binds a ciphertext to its row, so rows can't be swapped.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Sealed {
  /** Format version. */
  v: 1;
  /** Master key version that wrapped the data key. */
  kv: number;
  iv: string;
  tag: string;
  ct: string;
  wiv: string;
  wtag: string;
  wk: string;
}

export interface MasterKeys {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

function gcm(key: Buffer, plain: Buffer, aad: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv, ct, tag: c.getAuthTag() };
}

function ungcm(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer, aad: Buffer) {
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export function seal(plaintext: string, aad: string, master: MasterKeys): Sealed {
  const mk = master.keys.get(master.current);
  if (!mk) throw new Error(`master key version ${master.current} is not loaded`);
  const dek = randomBytes(32);
  const a = Buffer.from(aad);
  const data = gcm(dek, Buffer.from(plaintext, 'utf8'), a);
  const wrapped = gcm(mk, dek, a);
  dek.fill(0);
  return {
    v: 1,
    kv: master.current,
    iv: b64(data.iv),
    tag: b64(data.tag),
    ct: b64(data.ct),
    wiv: b64(wrapped.iv),
    wtag: b64(wrapped.tag),
    wk: b64(wrapped.ct),
  };
}

export function open(sealed: Sealed, aad: string, master: MasterKeys): string {
  const mk = master.keys.get(sealed.kv);
  if (!mk) throw new Error(`master key version ${sealed.kv} is not loaded`);
  const a = Buffer.from(aad);
  const dek = ungcm(mk, unb64(sealed.wiv), unb64(sealed.wk), unb64(sealed.wtag), a);
  try {
    return ungcm(dek, unb64(sealed.iv), unb64(sealed.ct), unb64(sealed.tag), a).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** Re-wraps the data key under the current master key without touching the ciphertext. */
export function rewrap(sealed: Sealed, aad: string, master: MasterKeys): Sealed {
  const old = master.keys.get(sealed.kv);
  const mk = master.keys.get(master.current);
  if (!old || !mk) throw new Error('both master key versions must be loaded to rewrap');
  const a = Buffer.from(aad);
  const dek = ungcm(old, unb64(sealed.wiv), unb64(sealed.wk), unb64(sealed.wtag), a);
  const wrapped = gcm(mk, dek, a);
  dek.fill(0);
  return {
    ...sealed,
    kv: master.current,
    wiv: b64(wrapped.iv),
    wtag: b64(wrapped.tag),
    wk: b64(wrapped.ct),
  };
}

/**
 * Master keys from the environment: MASTER_KEY (current, version MASTER_KEY_VERSION, default 1)
 * plus MASTER_KEY_<n> for older versions still referenced during a rotation. Base64, 32 bytes.
 */
export function masterKeysFromEnv(env: NodeJS.ProcessEnv): MasterKeys | undefined {
  const current = Number(env.MASTER_KEY_VERSION ?? 1);
  if (!Number.isInteger(current) || current < 1) {
    throw new Error('MASTER_KEY_VERSION must be a whole number from 1');
  }
  const keys = new Map<number, Buffer>();
  const parse = (name: string, raw: string) => {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error(`${name} must be 32 bytes of base64`);
    return key;
  };
  for (const [name, raw] of Object.entries(env)) {
    const m = /^MASTER_KEY_(\d+)$/.exec(name);
    if (m?.[1] && raw) keys.set(Number(m[1]), parse(name, raw));
  }
  if (env.MASTER_KEY) keys.set(current, parse('MASTER_KEY', env.MASTER_KEY));
  if (!keys.has(current)) return undefined;
  return { current, keys };
}
