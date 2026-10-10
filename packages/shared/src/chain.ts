import {defineChain, type Address, type PublicClient} from "viem";
import {agentVaultAbi, erc20Abi} from "./abi/index.ts";
import {ConfigError, type ChainConfig} from "./env.ts";
import {NATIVE_USDC_DECIMALS} from "./usdc.ts";

/**
 * Build a viem `Chain` for Arc from validated config.
 *
 * Arc is not in viem's bundled chain list, and its native currency is USDC
 * rather than ether. The 18 decimals below are correct *for gas* and are not
 * the 6 decimals used for vault accounting — see usdc.ts.
 *
 * Nothing here is hardcoded: pass mainnet or testnet config and this returns the
 * matching chain, so switching networks is an env change and never a code edit.
 */
export function arcChain(config: ChainConfig) {
  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: {
      name: "USD Coin",
      symbol: "USDC",
      decimals: NATIVE_USDC_DECIMALS,
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl],
        ...(config.wsUrl ? {webSocket: [config.wsUrl]} : {}),
      },
    },
    blockExplorers: {
      default: {name: "Arc Explorer", url: config.explorerUrl},
    },
    contracts: {
      multicall3: {
        address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      },
    },
  });
}

/**
 * Arc finalises deterministically (BFT consensus, sub-second blocks), so one
 * confirmation is final. Exported as a named constant so the service's payment
 * verification documents *why* it does not wait for more.
 */
export const ARC_CONFIRMATIONS = 1;

/** Explorer deep links, for the UI and for tool results the model reports back. */
export function txUrl(config: ChainConfig, hash: string): string {
  return `${config.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

export function addressUrl(config: ChainConfig, address: string): string {
  return `${config.explorerUrl.replace(/\/$/, "")}/address/${address}`;
}

/**
 * Fail-fast network verification, run by each backend before it listens.
 *
 * Checks the things a wrong .env would otherwise turn into silent damage:
 *   - the RPC really serves the configured chain id (5042 vs 5042002),
 *   - the configured USDC answers decimals(), and with the configured value —
 *     the token is asked, not assumed (Arc's 6 vs 18 hazard, threat T-12),
 *   - the vault has code and is denominated in that same USDC.
 *
 * Throws ConfigError with a specific message; never falls back to a default.
 */
export async function verifyNetwork(
  client: PublicClient,
  config: ChainConfig,
  vault?: Address,
): Promise<{chainId: number; usdcDecimals: number}> {
  const chainId = await client.getChainId();
  if (chainId !== config.chainId) {
    throw new ConfigError(
      `RPC ${redactUrl(config.rpcUrl)} serves chain ${chainId}, but ARC_CHAIN_ID is ${config.chainId}.`,
    );
  }

  let decimals: number;
  try {
    decimals = Number(
      await client.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "decimals",
      }),
    );
  } catch {
    throw new ConfigError(
      `USDC_ADDRESS ${config.usdcAddress} did not answer decimals() on chain ${chainId}. ` +
        `Is it the right token for this network?`,
    );
  }
  if (decimals !== config.usdcDecimals) {
    throw new ConfigError(
      `USDC at ${config.usdcAddress} reports ${decimals} decimals, but USDC_DECIMALS is ` +
        `${config.usdcDecimals}. Refusing to start: every amount would be mispriced.`,
    );
  }

  if (vault) {
    const code = await client.getCode({address: vault});
    if (!code || code === "0x") {
      throw new ConfigError(`No contract deployed at vault address ${vault} on chain ${chainId}.`);
    }
    let vaultToken: Address;
    try {
      vaultToken = (await client.readContract({
        address: vault,
        abi: agentVaultAbi,
        functionName: "usdc",
      })) as Address;
    } catch {
      throw new ConfigError(`${vault} does not look like an AgentVault (usdc() failed).`);
    }
    if (vaultToken.toLowerCase() !== config.usdcAddress.toLowerCase()) {
      throw new ConfigError(
        `Vault ${vault} is denominated in ${vaultToken}, not the configured USDC ${config.usdcAddress}.`,
      );
    }
  }

  return {chainId, usdcDecimals: decimals};
}

/**
 * Strip credentials from an RPC URL before it reaches a log, an error message,
 * a model, or a browser. Hosted RPC URLs commonly embed an API key in the path
 * or query string.
 */
export function redactUrl(url: string): string {
  // Regex rather than `URL`: this package targets both browser and Node and
  // deliberately carries neither environment's type definitions.
  const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#@]*@)?([^/?#]+)/i.exec(url);
  return m ? `${m[1]}//${m[3]}/…` : "<rpc>";
}

/** Remove any occurrence of a secret-bearing URL from free text. */
export function redactSecrets(text: string, rpcUrl: string): string {
  return rpcUrl ? text.split(rpcUrl).join(redactUrl(rpcUrl)) : text;
}
