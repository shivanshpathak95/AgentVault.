import {getAddress, isAddress, type Address} from "viem";

/**
 * Chain configuration, parsed from the environment and validated loudly.
 *
 * There are no defaults here, deliberately. Defaulting a chain id or a token
 * address is precisely how a demo ends up moving real money on the wrong
 * network. A missing variable is a startup crash naming the variable.
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  wsUrl: string | undefined;
  explorerUrl: string;
  usdcAddress: Address;
  usdcDecimals: number;
}

/** Raw strings as read from `process.env`. */
export interface RawChainEnv {
  chainId: string | undefined;
  name: string | undefined;
  rpcUrl: string | undefined;
  wsUrl?: string | undefined;
  explorerUrl: string | undefined;
  usdcAddress: string | undefined;
  usdcDecimals: string | undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Chain ids Arc publishes. Used to warn, never to default. */
export const ARC_CHAIN_IDS = {
  mainnet: 5042,
  testnet: 5042002,
} as const;

function required(value: string | undefined, varName: string): string {
  const v = value?.trim();
  if (!v) {
    throw new ConfigError(
      `Missing required environment variable ${varName}. See .env.example — this project ` +
        `has no fallback values for network configuration on purpose.`,
    );
  }
  return v;
}

/**
 * Parse and validate chain config.
 *
 * Callers pass `process.env.X` references literally rather than a prefix, so
 * that Next.js can statically inline the `NEXT_PUBLIC_*` values at build time.
 */
export function parseChainConfig(raw: RawChainEnv): ChainConfig {
  const chainIdStr = required(raw.chainId, "ARC_CHAIN_ID");
  const chainId = Number(chainIdStr);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new ConfigError(
      `ARC_CHAIN_ID must be a positive integer, got ${JSON.stringify(chainIdStr)}.`,
    );
  }

  const usdcRaw = required(raw.usdcAddress, "USDC_ADDRESS");
  if (!isAddress(usdcRaw)) {
    throw new ConfigError(`USDC_ADDRESS is not a valid address: ${JSON.stringify(usdcRaw)}.`);
  }

  const usdcDecimals = Number(required(raw.usdcDecimals, "USDC_DECIMALS"));
  if (!Number.isInteger(usdcDecimals) || usdcDecimals < 0 || usdcDecimals > 36) {
    throw new ConfigError(`USDC_DECIMALS must be a small non-negative integer.`);
  }
  if (usdcDecimals === 18) {
    throw new ConfigError(
      `USDC_DECIMALS is 18, which is Arc's NATIVE gas representation. The vault accounts in ` +
        `the USDC ERC-20 interface, which uses 6 decimals. Using 18 here would misprice every ` +
        `amount in the system by 10^12. See docs/ARCHITECTURE.md threat T-12.`,
    );
  }

  return {
    chainId,
    name: required(raw.name, "ARC_NETWORK_NAME"),
    rpcUrl: required(raw.rpcUrl, "ARC_RPC_URL"),
    wsUrl: raw.wsUrl?.trim() || undefined,
    explorerUrl: required(raw.explorerUrl, "ARC_EXPLORER_URL"),
    usdcAddress: getAddress(usdcRaw),
    usdcDecimals,
  };
}

/** True when this config points at Arc mainnet — i.e. real money. */
export function isMainnet(config: ChainConfig): boolean {
  return config.chainId === ARC_CHAIN_IDS.mainnet;
}

/** Parse a required address env var with a named error. */
export function requiredAddress(value: string | undefined, varName: string): Address {
  const v = required(value, varName);
  if (!isAddress(v)) {
    throw new ConfigError(`${varName} is not a valid address: ${JSON.stringify(v)}.`);
  }
  return getAddress(v);
}

/** Parse an optional address env var; undefined when unset. */
export function optionalAddress(
  value: string | undefined,
  varName: string,
): Address | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (!isAddress(v)) {
    throw new ConfigError(`${varName} is set but is not a valid address: ${JSON.stringify(v)}.`);
  }
  return getAddress(v);
}
