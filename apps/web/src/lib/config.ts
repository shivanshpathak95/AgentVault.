import {isMainnet, optionalAddress, parseChainConfig, type ChainConfig} from "@agentvault/shared";

/**
 * Browser-visible configuration.
 *
 * Each `process.env.NEXT_PUBLIC_*` is referenced as a literal so Next.js can
 * inline it at build time — a dynamic lookup would come back undefined in the
 * client bundle.
 */
export const chainConfig: ChainConfig = parseChainConfig({
  chainId: process.env.NEXT_PUBLIC_ARC_CHAIN_ID,
  name: process.env.NEXT_PUBLIC_ARC_NETWORK_NAME,
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC_URL,
  wsUrl: process.env.NEXT_PUBLIC_ARC_WS_URL,
  explorerUrl: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL,
  usdcAddress: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  usdcDecimals: process.env.NEXT_PUBLIC_USDC_DECIMALS,
});

export const factoryAddress = optionalAddress(
  process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS,
  "NEXT_PUBLIC_VAULT_FACTORY_ADDRESS",
);

/**
 * The vault this console is pointed at.
 *
 * Optional: the UI renders an explicit "not configured" state rather than
 * failing to build, so the app is usable before a deploy has happened.
 */
export const vaultAddress = optionalAddress(
  process.env.NEXT_PUBLIC_VAULT_ADDRESS,
  "NEXT_PUBLIC_VAULT_ADDRESS",
);

/**
 * Only non-secret values appear here. The session private key and the Anthropic
 * key live in the agent runtime's environment and are never read by this app —
 * no NEXT_PUBLIC_ variable in this project carries a secret.
 */

/** True when this console is pointed at real money. Surfaced prominently. */
export const isMainnetChain = isMainnet(chainConfig);
