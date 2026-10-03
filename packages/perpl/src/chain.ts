// Onchain reads from Perpl's Exchange contract. ABI fragments copied from
// PerplFoundation/dex-sdk crates/sdk/abi/dex/Exchange.json (MIT).

import { createPublicClient, http, isAddress } from 'viem';
import { monad, monadTestnet } from 'viem/chains';

const u256 = <N extends string>(name: N) => ({ type: 'uint256', name }) as const;

const accountInfo = {
  type: 'tuple',
  name: 'accountInfo',
  components: [
    u256('accountId'),
    u256('balanceCNS'),
    u256('lockedBalanceCNS'),
    { type: 'uint8', name: 'frozen' },
    { type: 'address', name: 'accountAddr' },
    {
      type: 'tuple',
      name: 'positions',
      components: [u256('bank1'), u256('bank2'), u256('bank3'), u256('bank4')],
    },
  ],
} as const;

const positionLiquidated = {
  type: 'event',
  name: 'PositionLiquidated',
  inputs: [
    u256('perpId'),
    u256('posAccountId'),
    { type: 'uint8', name: 'positionType' },
    u256('markPricePNS'),
    u256('liqPricePNS'),
    u256('liqLotLNS'),
    u256('posLotLNS'),
    { type: 'int256', name: 'deltaPnlCNS' },
    { type: 'int256', name: 'fundingCNS' },
    { type: 'int256', name: 'posAmountCNS' },
    u256('posDepositCNS'),
    { type: 'int256', name: 'accAmountCNS' },
    u256('accBalanceCNS'),
    { type: 'bool', name: 'onOrderBook' },
  ],
} as const;

export const exchangeAbi = [
  {
    type: 'function',
    name: 'getAccountByAddr',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'accountAddress' }],
    outputs: [accountInfo],
  },
  {
    type: 'function',
    name: 'getAccountById',
    stateMutability: 'view',
    inputs: [u256('accountId')],
    outputs: [accountInfo],
  },
  {
    type: 'function',
    name: 'getPositionV2',
    stateMutability: 'view',
    inputs: [u256('perpId'), u256('accountId')],
    outputs: [
      {
        type: 'tuple',
        name: 'positionInfo',
        components: [
          u256('accountId'),
          u256('nextNodeId'),
          u256('prevNodeId'),
          { type: 'uint8', name: 'positionType' },
          u256('depositCNS'),
          u256('pricePNS'),
          u256('lotLNS'),
          u256('entryBlock'),
          { type: 'int256', name: 'pnlCNS' },
          { type: 'int256', name: 'deltaPnlCNS' },
          { type: 'int256', name: 'premiumPnlCNS' },
          u256('priceResiduePNSQ16'),
        ],
      },
      u256('markPricePNS'),
      { type: 'bool', name: 'markPriceValid' },
    ],
  },
  {
    type: 'function',
    name: 'getFundingSumAtBlock',
    stateMutability: 'view',
    inputs: [u256('perpId'), u256('blockNumber')],
    outputs: [{ type: 'int48', name: 'fundingSumPNS' }, u256('fundingEventBlock')],
  },
  {
    type: 'function',
    name: 'getLiquidationInfo',
    stateMutability: 'view',
    inputs: [u256('perpId')],
    outputs: [
      {
        type: 'tuple',
        name: 'liquidationInfo',
        components: [
          u256('liqInsAmtPer100K'),
          u256('liqUserAmtPer100K'),
          u256('liqProtocolAmtPer100K'),
          u256('btlPriceThreshPer100K'),
          u256('btlInsAmtPer100K'),
          u256('btlUserAmtPer100K'),
          u256('btlBuyerAmtPer100K'),
          u256('btlProtocolAmtPer100K'),
          { type: 'bool', name: 'btlRestrictBuyers' },
        ],
      },
    ],
  },
  positionLiquidated,
] as const;

export interface ChainAccount {
  id: number;
  balanceCns: bigint;
  lockedCns: bigint;
  frozen: boolean;
}

export interface ChainPosition {
  /**
   * Null when there are no lots. The contract's PositionEnum is 0 = long, 1 = short, unlike the
   * trading WS (1 = long, 2 = short); this is the only place that reads the onchain encoding.
   */
  side: 'long' | 'short' | null;
  depositCns: bigint;
  pricePns: bigint;
  residueQ16: bigint;
  lots: bigint;
  /** The block the position was opened or last resized at, where its funding sum starts. */
  entryBlock: bigint;
  /** Perpl's own unrealized PnL at the mark. */
  deltaPnlCns: bigint;
  premiumPnlCns: bigint;
  markPns: bigint;
}

/** One Perpl liquidation, as its PositionLiquidated event reports it. */
export interface ChainLiquidation {
  block: bigint;
  /** The transaction that liquidated it, and the event's place in that block. */
  tx: `0x${string}`;
  logIndex: number;
  perpId: number;
  accountId: number;
  side: 'long' | 'short';
  markPns: bigint;
  /** The price the liquidation executed at. */
  pricePns: bigint;
  lots: bigint;
  /** Lots still open afterwards: 0 for a full liquidation. */
  remainingLots: bigint;
  /** PnL realized at the execution price. */
  deltaPnlCns: bigint;
  fundingCns: bigint;
  /** The deposit the liquidation took out of the position (the event's -posAmountCNS). */
  depositCns: bigint;
  /** What went back to the trader's account. */
  toAccountCns: bigint;
}

export type PerplChain = ReturnType<typeof perplChain>;

export function perplChain(
  rpcUrl: string,
  exchange: string,
  chainId: number,
  fetchFn?: typeof fetch,
) {
  if (!isAddress(exchange)) throw new Error(`exchange address is not an address: ${exchange}`);
  const chain = [monad, monadTestnet].find((c) => c.id === chainId);
  if (!chain) throw new Error(`no Monad chain with id ${chainId}`);
  // Monad's public RPCs allow 15 requests a second. Reads awaited together, like a lookup's
  // position in every market, go out as one Multicall3 eth_call instead of one call each.
  const client = createPublicClient({
    chain,
    batch: { multicall: true },
    transport: http(rpcUrl, { timeout: 10_000, retryCount: 2, ...(fetchFn ? { fetchFn } : {}) }),
  });
  const read = { address: exchange, abi: exchangeAbi } as const;
  return {
    /** The Perpl exchange account for a wallet, or null if it has none. */
    async account(wallet: `0x${string}`): Promise<ChainAccount | null> {
      try {
        const a = await client.readContract({
          ...read,
          functionName: 'getAccountByAddr',
          args: [wallet],
        });
        if (a.accountId === 0n) return null;
        return {
          id: Number(a.accountId),
          balanceCns: a.balanceCNS,
          lockedCns: a.lockedBalanceCNS,
          frozen: a.frozen !== 0,
        };
      } catch (err) {
        // The contract reverts for wallets without an account.
        if (err instanceof Error && /revert/i.test(err.message)) return null;
        throw err;
      }
    },
    /** An exchange account by id, and whether it holds any position; null if there is none. */
    async accountById(id: number): Promise<{ id: number; hasPositions: boolean } | null> {
      try {
        const a = await client.readContract({
          ...read,
          functionName: 'getAccountById',
          args: [BigInt(id)],
        });
        const { bank1, bank2, bank3, bank4 } = a.positions;
        return { id: Number(a.accountId), hasPositions: (bank1 | bank2 | bank3 | bank4) !== 0n };
      } catch (err) {
        if (err instanceof Error && /revert/i.test(err.message)) return null;
        throw err;
      }
    },
    async position(perpId: number, accountId: number): Promise<ChainPosition> {
      const [p, mark] = await client.readContract({
        ...read,
        functionName: 'getPositionV2',
        args: [BigInt(perpId), BigInt(accountId)],
      });
      return {
        side: p.lotLNS === 0n ? null : p.positionType === 0 ? 'long' : 'short',
        depositCns: p.depositCNS,
        pricePns: p.pricePNS,
        residueQ16: p.priceResiduePNSQ16,
        lots: p.lotLNS,
        entryBlock: p.entryBlock,
        deltaPnlCns: p.deltaPnlCNS,
        premiumPnlCns: p.premiumPnlCNS,
        markPns: mark,
      };
    },
    head: (): Promise<bigint> => client.getBlockNumber(),
    /** Liquidations between two blocks, inclusive. Public RPCs may cap the range per call. */
    async liquidations(fromBlock: bigint, toBlock: bigint): Promise<ChainLiquidation[]> {
      const logs = await client.getLogs({
        address: exchange,
        event: positionLiquidated,
        fromBlock,
        toBlock,
        strict: true,
      });
      return logs.map(({ blockNumber, transactionHash, logIndex, args: a }) => ({
        block: blockNumber,
        tx: transactionHash,
        logIndex,
        perpId: Number(a.perpId),
        accountId: Number(a.posAccountId),
        side: a.positionType === 0 ? 'long' : 'short',
        markPns: a.markPricePNS,
        pricePns: a.liqPricePNS,
        lots: a.liqLotLNS,
        remainingLots: a.posLotLNS,
        deltaPnlCns: a.deltaPnlCNS,
        fundingCns: a.fundingCNS,
        depositCns: -a.posAmountCNS,
        toAccountCns: a.accAmountCNS,
      }));
    },
    async fundingSumAt(perpId: number, block: number): Promise<number> {
      const [sum] = await client.readContract({
        ...read,
        functionName: 'getFundingSumAtBlock',
        args: [BigInt(perpId), BigInt(block)],
      });
      return Number(sum);
    },
    /** The trader's share of what's left at liquidation (0.8 on every market today). */
    async liquidationUserShare(perpId: number): Promise<number> {
      const info = await client.readContract({
        ...read,
        functionName: 'getLiquidationInfo',
        args: [BigInt(perpId)],
      });
      return Number(info.liqUserAmtPer100K) / 100_000;
    },
  };
}
