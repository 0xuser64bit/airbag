// Defaults per network. Everything else (addresses, markets, decimals) comes from /pub/context.
// https://docs.perpl.xyz/resources/for-developers/networks-and-configuration

type Network = 'testnet' | 'mainnet';

export interface NetworkConfig {
  network: Network;
  chainId: number;
  apiUrl: string;
  wsUrl: string;
  rpcUrl: string;
  rpcWsUrl: string;
  explorerUrl: string;
}

const DEFAULTS: Record<Network, NetworkConfig> = {
  testnet: {
    network: 'testnet',
    chainId: 10143,
    apiUrl: 'https://testnet.perpl.xyz/api',
    wsUrl: 'wss://testnet.perpl.xyz',
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    rpcWsUrl: 'wss://testnet-rpc.monad.xyz',
    explorerUrl: 'https://testnet.monadvision.com',
  },
  mainnet: {
    network: 'mainnet',
    chainId: 143,
    apiUrl: 'https://app.perpl.xyz/api',
    wsUrl: 'wss://app.perpl.xyz',
    rpcUrl: 'https://rpc.monad.xyz',
    rpcWsUrl: 'wss://rpc.monad.xyz',
    explorerUrl: 'https://monadvision.com',
  },
};

/** Reads PERPL_NETWORK plus optional URL overrides from the environment. */
export function networkFromEnv(env: NodeJS.ProcessEnv = process.env): NetworkConfig {
  const network = env.PERPL_NETWORK ?? 'testnet';
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`PERPL_NETWORK must be testnet or mainnet, got ${network}`);
  }
  const d = DEFAULTS[network];
  return {
    ...d,
    apiUrl: env.PERPL_API_URL ?? d.apiUrl,
    wsUrl: env.PERPL_WS_URL ?? d.wsUrl,
    rpcUrl: env.MONAD_RPC_URL ?? d.rpcUrl,
    rpcWsUrl: env.MONAD_WS_URL ?? d.rpcWsUrl,
  };
}
