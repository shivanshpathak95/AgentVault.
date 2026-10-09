import {
  ConfigError,
  parseChainConfig,
  requiredAddress,
  type ChainConfig,
} from "@agentvault/shared";
import type {Address} from "viem";

export interface ServiceConfig {
  port: number;
  chain: ChainConfig;
  /** Where this service expects to be paid. */
  payoutAddress: Address;
  /** Only payments emitted by this vault are honoured. */
  expectedVault: Address;
}

export function loadConfig(): ServiceConfig {
  const chain = parseChainConfig({
    chainId: process.env.ARC_CHAIN_ID,
    name: process.env.ARC_NETWORK_NAME ?? "Arc",
    rpcUrl: process.env.ARC_RPC_URL,
    wsUrl: process.env.ARC_WS_URL,
    explorerUrl: process.env.ARC_EXPLORER_URL,
    usdcAddress: process.env.USDC_ADDRESS,
    usdcDecimals: process.env.USDC_DECIMALS ?? "6",
  });

  const port = Number(process.env.SERVICE_PORT ?? 8788);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError(`SERVICE_PORT must be a positive integer, got "${process.env.SERVICE_PORT}".`);
  }

  return {
    port,
    chain,
    payoutAddress: requiredAddress(process.env.SERVICE_PAYOUT_ADDRESS, "SERVICE_PAYOUT_ADDRESS"),
    expectedVault: requiredAddress(process.env.EXPECTED_VAULT_ADDRESS, "EXPECTED_VAULT_ADDRESS"),
  };
}
