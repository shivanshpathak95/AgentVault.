import {
  ConfigError,
  parseChainConfig,
  requiredAddress,
  type ChainConfig,
} from "@agentvault/shared";
import type {Address, Hex} from "viem";

export interface AgentConfig {
  port: number;
  chain: ChainConfig;
  vaultAddress: Address;
  sessionPrivateKey: Hex;
  anthropicApiKey: string;
  anthropicModel: string;
  serviceBaseUrl: string;
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new ConfigError(`Missing required environment variable ${name}. See .env.example.`);
  return v;
}

export function loadConfig(): AgentConfig {
  const sessionKey = required("AGENT_SESSION_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(sessionKey)) {
    throw new ConfigError(
      "AGENT_SESSION_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key. Generate one with " +
        "`cast wallet new`. This must NOT be the operator's key — see docs/ARCHITECTURE.md.",
    );
  }

  const port = Number(process.env.AGENT_PORT ?? 8787);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError(`AGENT_PORT must be a positive integer, got "${process.env.AGENT_PORT}".`);
  }

  return {
    port,
    chain: parseChainConfig({
      chainId: process.env.ARC_CHAIN_ID,
      name: process.env.ARC_NETWORK_NAME ?? "Arc",
      rpcUrl: process.env.ARC_RPC_URL,
      wsUrl: process.env.ARC_WS_URL,
      explorerUrl: process.env.ARC_EXPLORER_URL,
      usdcAddress: process.env.USDC_ADDRESS,
      usdcDecimals: process.env.USDC_DECIMALS ?? "6",
    }),
    vaultAddress: requiredAddress(process.env.VAULT_ADDRESS, "VAULT_ADDRESS"),
    sessionPrivateKey: sessionKey as Hex,
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    serviceBaseUrl: required("SERVICE_BASE_URL"),
  };
}
