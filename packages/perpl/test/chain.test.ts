import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  type Hex,
  multicall3Abi,
} from 'viem';
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

it("decodes Perpl's liquidations with the contract's side encoding (0 long, 1 short)", async () => {
  const event = exchangeAbi.find((x) => x.type === 'event' && x.name === 'PositionLiquidated');
  if (event?.type !== 'event') throw new Error('missing event');
  // The real BTC short liquidated in mainnet block 109,330,197.
  const values = [1n, 1633n, 1, 855_613n, 856_028n, 1_520n, 0n, -35_021_016n, 299_440n];
  const rest = [-84_514_992n, 0n, 39_834_732n, 1_040_302_593n, true] as const;
  const data = encodeAbiParameters(event.inputs, [...values, ...rest] as never);
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    const log = {
      address: EXCHANGE.toLowerCase(),
      topics: encodeEventTopics({ abi: [event], eventName: 'PositionLiquidated' }),
      data,
      blockNumber: '0x6843f15',
      blockHash: `0x${'1'.repeat(64)}`,
      transactionHash: `0x${'2'.repeat(64)}`,
      transactionIndex: '0x0',
      logIndex: '0x0',
      removed: false,
    };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: [log] }));
  }) as typeof fetch;
  const chain = perplChain('http://rpc.test', EXCHANGE, 143, fetchFn);
  const [l] = await chain.liquidations(109_330_000n, 109_330_197n);
  expect(l).toMatchObject({
    block: 109_330_197n,
    tx: `0x${'2'.repeat(64)}`,
    logIndex: 0,
    perpId: 1,
    accountId: 1633,
    side: 'short',
    pricePns: 856_028n,
    remainingLots: 0n,
    depositCns: 84_514_992n,
    toAccountCns: 39_834_732n,
  });
});
