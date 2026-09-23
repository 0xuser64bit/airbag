// Operator commands. Usage: node apps/engine/src/cli.ts <command>
//
//   rotate-master-key   Re-wrap every stored key's data key under MASTER_KEY (the new
//                       version, MASTER_KEY_VERSION), reading old ones from MASTER_KEY_<n>.
//                       See docs/SECURITY.md for the full procedure.
//   check-keys          Decrypts every stored key in memory and reports which master key
//                       version it uses, without printing any secret.

import { openStore, type Store } from './db.ts';
import { type MasterKeys, masterKeysFromEnv, open, rewrap } from './vault.ts';

const aad = (wallet: string, accountId: number) => `airbag:v1:${wallet}:${accountId}`;

/** Re-wraps every link's data key under the current master key. Returns how many moved. */
export function rotateLinks(store: Store, master: MasterKeys): number {
  let moved = 0;
  for (const link of store.links()) {
    if (link.sealed.kv === master.current) continue;
    const sealed = rewrap(link.sealed, aad(link.wallet, link.accountId), master);
    // Prove the new envelope opens before replacing the old one.
    open(sealed, aad(link.wallet, link.accountId), master);
    store.putLink({ ...link, sealed });
    moved += 1;
  }
  return moved;
}

export function keyVersions(store: Store, master: MasterKeys): Record<string, number> {
  const out: Record<string, number> = {};
  for (const link of store.links()) {
    open(link.sealed, aad(link.wallet, link.accountId), master);
    out[`v${link.sealed.kv}`] = (out[`v${link.sealed.kv}`] ?? 0) + 1;
  }
  return out;
}

if (import.meta.main) {
  const command = process.argv[2];
  const master = masterKeysFromEnv(process.env);
  if (!master) throw new Error('MASTER_KEY is not set');
  const store = openStore(process.env.DATABASE_PATH ?? './data/airbag.db');
  try {
    if (command === 'rotate-master-key') {
      const moved = rotateLinks(store, master);
      console.log(
        JSON.stringify({
          rotated: moved,
          current: master.current,
          versions: keyVersions(store, master),
        }),
      );
    } else if (command === 'check-keys') {
      console.log(
        JSON.stringify({ current: master.current, versions: keyVersions(store, master) }),
      );
    } else {
      console.error('usage: cli.ts rotate-master-key | check-keys');
      process.exitCode = 2;
    }
  } finally {
    store.close();
  }
}
