// Onchain reads from Perpl's Exchange contract. ABI fragments copied from
// PerplFoundation/dex-sdk crates/sdk/abi/dex/Exchange.json (MIT).

import { createPublicClient, http, isAddress } from 'viem';

const u256 = <N extends string>(name: N) => ({ type: 'uint256', name }) as const;

export const exchangeAbi = [
  {
    type: 'function',
    name: 'getAccountByAddr',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'accountAddress' }],
    outputs: [
      {
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
      },
    ],
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
] as const;

export interface ChainAccount {
  id: number;
  balanceCns: bigint;
  lockedCns: bigint;
  frozen: boolean;
}

export interface ChainPosition {
  /** 1 long, 2 short, 0 none. */
  type: number;
  depositCns: bigint;
  pricePns: bigint;
  residueQ16: bigint;
  lots: bigint;
  premiumPnlCns: bigint;
  markPns: bigint;
}

export type PerplChain = ReturnType<typeof perplChain>;

export function perplChain(rpcUrl: string, exchange: string) {
  if (!isAddress(exchange)) throw new Error(`exchange address is not an address: ${exchange}`);
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 10_000, retryCount: 2 }),
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
    async position(perpId: number, accountId: number): Promise<ChainPosition> {
      const [p, mark] = await client.readContract({
        ...read,
        functionName: 'getPositionV2',
        args: [BigInt(perpId), BigInt(accountId)],
      });
      return {
        type: p.positionType,
        depositCns: p.depositCNS,
        pricePns: p.pricePNS,
        residueQ16: p.priceResiduePNSQ16,
        lots: p.lotLNS,
        premiumPnlCns: p.premiumPnlCNS,
        markPns: mark,
      };
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
