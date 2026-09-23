// Onchain reads used to cross-check the WS-derived numbers. ABI fragments from
// PerplFoundation/dex-sdk crates/sdk/abi/dex/Exchange.json (MIT).

import { createPublicClient, http, parseAbi } from 'viem';

export const exchangeAbi = parseAbi([
  'struct PositionInfoV2 { uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS; uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS; int256 premiumPnlCNS; uint256 priceResiduePNSQ16; }',
  'function getPositionV2(uint256 perpId, uint256 accountId) view returns (PositionInfoV2 positionInfo, uint256 markPricePNS, bool markPriceValid)',
  'function getFundingSumAtBlock(uint256 perpId, uint256 blockNumber) view returns (int48 fundingSumPNS, uint256 fundingEventBlock)',
]);

export function chain(rpcUrl: string, exchange: `0x${string}`) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    position: (perpId: number, accountId: number) =>
      client.readContract({
        address: exchange,
        abi: exchangeAbi,
        functionName: 'getPositionV2',
        args: [BigInt(perpId), BigInt(accountId)],
      }),
    fundingSumAt: async (perpId: number, block: number) => {
      const [sum] = await client.readContract({
        address: exchange,
        abi: exchangeAbi,
        functionName: 'getFundingSumAtBlock',
        args: [BigInt(perpId), BigInt(block)],
      });
      return Number(sum);
    },
  };
}
