import { decodeFunctionData, encodeFunctionResult, type Hex, multicall3Abi } from 'viem';
import { expect, it } from 'vitest';
import { exchangeAbi, perplChain } from '../src/chain.ts';

const EXCHANGE = '0x1964C32f0bE608E7D29302AFF5E61268E72080cc';

/** A JSON-RPC node that answers Multicall3 batches of getPositionV2, and counts requests. */
function fakeRpc() {
  const requests: { method: string }[] = [];
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: [{ data: Hex }];
    };
    requests.push(body);
    const { args } = decodeFunctionData({ abi: multicall3Abi, data: body.params[0].data });
    const calls = args[0] as readonly { callData: Hex }[];
    const result = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: 'aggregate3',
      result: calls.map((c) => {
        const [perpId] = decodeFunctionData({ abi: exchangeAbi, data: c.callData }).args as [
          bigint,
        ];
        const position = {
          accountId: 7n,
          nextNodeId: 0n,
          prevNodeId: 0n,
          positionType: 1,
          depositCNS: 1_000_000n,
          pricePNS: 1_000_000n,
          lotLNS: perpId,
          entryBlock: 1n,
          pnlCNS: 0n,
          deltaPnlCNS: 0n,
          premiumPnlCNS: 0n,
          priceResiduePNSQ16: 0n,
        };
        return {
          success: true,
          returnData: encodeFunctionResult({
            abi: exchangeAbi,
            functionName: 'getPositionV2',
            result: [position, 994_200n, true],
          }),
        };
      }),
    });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  }) as typeof fetch;
  return { requests, fetchFn };
}

it('reads a position in every market with one RPC request (public RPCs allow 15 a second)', async () => {
  const rpc = fakeRpc();
  const chain = perplChain('http://rpc.test', EXCHANGE, 10143, rpc.fetchFn);
  const perpIds = [16, 32, 48, 64, 256, 272, 320];
  const positions = await Promise.all(perpIds.map((id) => chain.position(id, 7)));
  expect(rpc.requests.map((r) => r.method)).toEqual(['eth_call']);
  expect(positions.map((p) => p.lots)).toEqual(perpIds.map(BigInt));
  expect(positions[0]).toMatchObject({ side: 'short', depositCns: 1_000_000n, markPns: 994_200n });
});

it('refuses a chain it has no Multicall3 address for', () => {
  expect(() => perplChain('http://rpc.test', EXCHANGE, 1)).toThrow(/no Monad chain/);
});
