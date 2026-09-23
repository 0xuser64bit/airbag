// Writes deploys and saves to the AirbagLog contract (ADR 0009) from the engine's hot wallet.
// Writes are queued one at a time so nonces stay in order, and a failure is logged, never
// thrown: the onchain log must not delay or break protection.

import type { Market } from '@airbag/perpl';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  isHex,
  parseEventLogs,
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
      { name: 'sizeAfter', type: 'uint256' },
      { name: 'liqBefore', type: 'uint256' },
      { name: 'liqAfter', type: 'uint256' },
      { name: 'reason', type: 'uint8' },
    ],
    outputs: [{ name: 'deployId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'recordSave',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'deployId', type: 'uint256' },
      { name: 'oldLiqHitBlock', type: 'uint256' },
    ],
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

/** recordDeploy's arguments in Perpl's own units: lots and price-scaled integers. */
export function deployArgs(d: Deploy, m: Market) {
  const pd = m.config.price_decimals;
  const sd = m.config.size_decimals;
  const price = (p: number | null | undefined) =>
    BigInt(Math.max(0, Math.round((p ?? 0) * 10 ** pd)));
  const tx = d.data.close?.tx;
  return [
    BigInt(d.accountId),
    BigInt(m.perpetual_id),
    tx && isHex(tx) && tx.length === 66 ? tx : ZERO32,
    BigInt(d.data.before.lots),
    BigInt(Math.round((d.data.after?.size ?? 0) * 10 ** sd)),
    price(d.data.before.liquidation),
    price(d.data.after?.liquidation),
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
        const m = markets.get(d.marketId);
        if (!m) return;
        const hash = await wallet.writeContract({
          address: cfg.address,
          abi: airbagLogAbi,
          functionName: 'recordDeploy',
          args: deployArgs(d, m),
        });
        const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 60_000 });
        const [event] = parseEventLogs({
          abi: airbagLogAbi,
          logs: receipt.logs,
          eventName: 'DeployRecorded',
        });
        d.data.onchain = { deployId: Number(event?.args.deployId ?? 0), tx: hash };
        store.updateDeploy(d);
        log.info('onchain.deploy', { id: d.id, deployId: d.data.onchain.deployId, tx: hash });
      }),
    recordSave: (d) =>
      enqueue(async () => {
        const onchain = d.data.onchain;
        if (!onchain?.deployId || !d.data.save) return;
        const hash = await wallet.writeContract({
          address: cfg.address,
          abi: airbagLogAbi,
          functionName: 'recordSave',
          args: [BigInt(onchain.deployId), BigInt(d.data.save.block)],
        });
        await reader.waitForTransactionReceipt({ hash, timeout: 60_000 });
        d.data.onchain = { ...onchain, saveTx: hash };
        store.updateDeploy(d);
        log.info('onchain.save', { id: d.id, deployId: onchain.deployId, tx: hash });
      }),
  };
}
