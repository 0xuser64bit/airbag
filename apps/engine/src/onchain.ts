// Writes deploys and proves saves on the AirbagLog contract (ADR 0009, 0016) from the engine's
// hot wallet. The contract reads each deploy's after-state from Perpl itself and checks a save
// against Perpl's mark, so the engine sends only what it saw before the deploy. Writes are
// queued one at a time so nonces stay in order, and a failure is logged, never thrown: the
// onchain log must not delay or break protection.

import type { Market } from '@airbag/perpl';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  isHex,
  parseEventLogs,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Deploy, Store } from './db.ts';
import type { Logger } from './log.ts';
import type { OnchainLog } from './notify.ts';

export const airbagLogAbi = [
  {
    type: 'function',
    name: 'recordDeploy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'accountId', type: 'uint256' },
      { name: 'market', type: 'uint256' },
      { name: 'perplTxHash', type: 'bytes32' },
      { name: 'sizeBefore', type: 'uint256' },
      { name: 'liqBefore', type: 'uint256' },
      { name: 'reason', type: 'uint8' },
    ],
    outputs: [{ name: 'deployId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'proveSave',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'deployId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'DeployRecorded',
    inputs: [
      { name: 'deployId', type: 'uint256', indexed: true },
      { name: 'accountId', type: 'uint256', indexed: true },
      { name: 'market', type: 'uint256', indexed: true },
      { name: 'perplTxHash', type: 'bytes32', indexed: false },
      { name: 'sizeBefore', type: 'uint256', indexed: false },
      { name: 'sizeAfter', type: 'uint256', indexed: false },
      { name: 'liqBefore', type: 'uint256', indexed: false },
      { name: 'liqAfter', type: 'uint256', indexed: false },
      { name: 'reason', type: 'uint8', indexed: false },
    ],
  },
] as const;

const ZERO32 = `0x${'0'.repeat(64)}` as Hex;

/** Success must include our contract's event; another address cannot supply the deploy id. */
export function confirmedDeployId(
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>,
  address: string,
): number {
  if (receipt.status !== 'success') throw new Error('AirbagLog transaction reverted');
  const [event] = parseEventLogs({
    abi: airbagLogAbi,
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === address.toLowerCase()),
    eventName: 'DeployRecorded',
  });
  const id = Number(event?.args.deployId ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error('AirbagLog receipt is missing a valid DeployRecorded event');
  return id;
}

/**
 * recordDeploy's arguments in Perpl's own units, lots and price-scaled integers: what the engine
 * saw before the deploy. The contract reads the after-state from Perpl.
 */
export function deployArgs(d: Deploy, m: Market) {
  const tx = d.data.close?.tx;
  return [
    BigInt(d.accountId),
    BigInt(m.perpetual_id),
    tx && isHex(tx) && tx.length === 66 ? tx : ZERO32,
    BigInt(d.data.before.lots),
    BigInt(Math.max(0, Math.round(d.data.before.liquidation * 10 ** m.config.price_decimals))),
    d.kind === 'trim' ? 0 : 1,
  ] as const;
}

export interface AirbagLogConfig {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  rpcUrl: string;
  chainId: number;
}

export function airbagLog(
  cfg: AirbagLogConfig,
  markets: ReadonlyMap<number, Market>,
  store: Store,
  log: Logger,
): OnchainLog {
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.chainId === 143 ? 'Monad' : 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const account = privateKeyToAccount(cfg.privateKey);
  const wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const reader = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    recordDeploy: (d) =>
      enqueue(async () => {
        if (d.data.onchain?.deployId) return;
        const m = markets.get(d.marketId);
        if (!m) return;
        const hash = await wallet.writeContract({
          address: cfg.address,
          abi: airbagLogAbi,
          functionName: 'recordDeploy',
          args: deployArgs(d, m),
        });
        const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 60_000 });
        d.data.onchain = { deployId: confirmedDeployId(receipt, cfg.address), tx: hash };
        store.updateDeploy(d);
        log.info('onchain.deploy', { id: d.id, deployId: d.data.onchain.deployId, tx: hash });
      }),
    proveSave: (d) =>
      enqueue(async () => {
        const onchain = d.data.onchain;
        if (!onchain?.deployId || !d.data.save || onchain.saveTx) return;
        // The contract checks Perpl's mark in the block it runs; gas estimation simulates that
        // first, so a mark that already moved back fails here rather than onchain.
        const hash = await wallet.writeContract({
          address: cfg.address,
          abi: airbagLogAbi,
          functionName: 'proveSave',
          args: [BigInt(onchain.deployId)],
        });
        const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 60_000 });
        if (receipt.status !== 'success') throw new Error('AirbagLog save transaction reverted');
        d.data.onchain = { ...onchain, saveTx: hash };
        store.updateDeploy(d);
        log.info('onchain.save', { id: d.id, deployId: onchain.deployId, tx: hash });
      }),
  };
}
