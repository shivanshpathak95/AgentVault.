import {
  ConfigError,
  parseChainConfig,
  requiredAddress,
  type ChainConfig,
} from "@agentvault/shared";
import type {Address, Hex} from "viem";

export interface AgentConfig {
  port: number;
  /** Interface to bind. Loopback by default — see loadConfig. */
  host: string;
  /** Bearer token required on spending endpoints. Mandatory off-loopback. */
  apiToken: string | undefined;
  /** Browser origins allowed to call the API (the operator console). */
  allowedOrigins: string[];
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

  // SECURITY: POST /api/run causes this process to sign and broadcast payments
  // with the session key. It is therefore a privileged endpoint, and binding it
  // to every interface without authentication would let anyone who can reach
  // the port drain the session's entire daily budget.
  //
  // Smallest safe correction: bind loopback by default, and make a bearer token
  // mandatory the moment the operator binds anywhere else. This is NOT a full
  // auth solution — a browser console cannot hold a secret, so a real
  // deployment needs operator authentication (e.g. SIWE). Documented as a
  // known limitation rather than papered over.
  const host = process.env.AGENT_HOST?.trim() || "127.0.0.1";
  const apiToken = process.env.AGENT_API_TOKEN?.trim() || undefined;
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";

  if (!loopback && !apiToken) {
    throw new ConfigError(
      `AGENT_HOST is "${host}", which exposes the payment endpoint beyond this machine. ` +
        `Set AGENT_API_TOKEN to a strong random value, or leave AGENT_HOST unset to bind ` +
        `loopback only.`,
    );
  }

  // Browser origins permitted to call this API. Loopback binding alone does
  // not stop a malicious web page in the operator's own browser from posting
  // to 127.0.0.1 — see the CSRF note in index.ts.
  const allowedOrigins = (process.env.AGENT_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return {
    port,
    host,
    apiToken,
    allowedOrigins,
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
