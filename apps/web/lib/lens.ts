// AirbagLog's liquidationPrice, read onchain (ADR 0016): the contract computes a Perpl position's
// liquidation price from Perpl's own state, so a page can show it beside the risk package's and
// let anyone see they agree. Off unless AIRBAG_LENS_ADDRESS names the contract on Monad mainnet.

import { createPublicClient, http, isAddress, parseAbi } from 'viem';
import { monad } from 'viem/chains';

const abi = parseAbi([
  'function liquidationPrice(uint256 perpId, uint256 accountId) view returns (uint256 liqPNS, bool short, uint256 lots, uint256 markPNS, bool markValid)',
]);

export const LENS_ADDRESS = process.env.AIRBAG_LENS_ADDRESS;

/**
 * The contract's liquidation price for each position, in the market's price units, or null where
 * the read failed. Read together, they go out as one Multicall3 call. Null when the lens is off.
 */
export async function lensLiquidations(
  rpcUrl: string,
  positions: { perpId: number; accountId: number }[],
): Promise<(bigint | null)[] | null> {
  const address = LENS_ADDRESS;
  if (!address || !isAddress(address)) return null;
  const client = createPublicClient({
    chain: monad,
    batch: { multicall: true },
    transport: http(rpcUrl, { timeout: 10_000 }),
  });
  return Promise.all(
    positions.map(({ perpId, accountId }) =>
      client
        .readContract({
          address,
          abi,
          functionName: 'liquidationPrice',
          args: [BigInt(perpId), BigInt(accountId)],
        })
        .then(([liq]) => liq)
        .catch(() => null),
    ),
  );
}
