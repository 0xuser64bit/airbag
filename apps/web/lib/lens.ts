// AirbagLog's liquidationPrice, read onchain (docs/ARCHITECTURE.md): the contract computes a Perpl position's
// liquidation price from Perpl's own state, so a page can show it beside the risk package's and
// let anyone see they agree. Off unless AIRBAG_LENS_ADDRESS names the contract on Monad mainnet.

import { createPublicClient, http, isAddress, parseAbi } from 'viem';
import { monad, monadTestnet } from 'viem/chains';

/** AirbagLog on Monad testnet, against Perpl's testnet Exchange (2026-10-04). */
export const TESTNET_LOG = '0x52259e30d3687691F663033922472B43120276F7';

const abi = parseAbi([
  'function liquidationPrice(uint256 perpId, uint256 accountId) view returns (uint256 liqPNS, bool short, uint256 lots, uint256 markPNS, bool markValid)',
]);

const LENS_ADDRESS = process.env.AIRBAG_LENS_ADDRESS;

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

/** How many live deploys AirbagLog has recorded on Monad testnet, or null if the chain doesn't answer. */
export async function testnetDeploys(): Promise<number | null> {
  const client = createPublicClient({
    chain: monadTestnet,
    transport: http('https://testnet-rpc.monad.xyz', { timeout: 5_000 }),
  });
  return client
    .readContract({
      address: TESTNET_LOG,
      abi: parseAbi(['function deploys() view returns (uint256)']),
      functionName: 'deploys',
    })
    .then(Number)
    .catch(() => null);
}
