import {defineChain} from "viem";
import type {ChainConfig} from "./env.ts";
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
