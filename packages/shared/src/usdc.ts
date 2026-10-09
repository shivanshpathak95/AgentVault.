import {formatUnits, parseUnits} from "viem";

/**
 * USDC decimal handling for Arc.
 *
 * Arc exposes USDC in two representations of the same asset:
 *
 *   native      18 decimals — the gas token
 *   ERC-20      6 decimals  — the transferable token interface
 *
 * Confusing them is a 10^12x error. AgentVault accounts exclusively in the
 * ERC-20 representation; the native balance is read only to show gas. Every
 * conversion in this project goes through this module so there is exactly one
 * place to audit. (Threat T-12 in docs/ARCHITECTURE.md.)
 */

/** Decimals of the USDC ERC-20 interface. All vault amounts use this. */
export const USDC_ERC20_DECIMALS = 6;

/** Decimals of native USDC on Arc. GAS ONLY — never vault accounting. */
export const NATIVE_USDC_DECIMALS = 18;

export class UsdcAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsdcAmountError";
  }
}

/**
 * Parse a decimal USDC string into 6dp base units.
 *
 * Strict on purpose. `parseUnits` silently truncates excess precision, which
 * would let an agent's "0.0000001" become a free payment and an operator's
 * mistyped limit become a different limit than the one they read back. Here,
 * excess precision is an error the caller must resolve.
 */
export function toBaseUnits(
  amount: string,
  decimals: number = USDC_ERC20_DECIMALS,
): bigint {
  const trimmed = amount.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new UsdcAmountError(
      `Invalid USDC amount ${JSON.stringify(amount)}: expected a plain decimal like "12.50" ` +
        `(no sign, no exponent, no separators).`,
    );
  }

  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    throw new UsdcAmountError(
      `USDC amount ${JSON.stringify(amount)} has ${fraction.length} decimal places but USDC ` +
        `supports ${decimals}. Round before submitting rather than letting it truncate silently.`,
    );
  }

  return parseUnits(trimmed, decimals);
}

/** Format 6dp base units as a plain decimal string, e.g. 12500000n -> "12.5". */
export function fromBaseUnits(
  amount: bigint,
  decimals: number = USDC_ERC20_DECIMALS,
): string {
  return formatUnits(amount, decimals);
}

/** Format for display with a fixed 2dp and a symbol, e.g. "12.50 USDC". */
export function formatUsdc(
  amount: bigint,
  decimals: number = USDC_ERC20_DECIMALS,
): string {
  const n = Number(formatUnits(amount, decimals));
  return `${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDC`;
}

/**
 * Format a NATIVE (18dp) balance — gas only.
 *
 * Named so that a call site mixing it with vault accounting reads as obviously
 * wrong in review.
 */
export function formatNativeGasUsdc(wei: bigint): string {
  const n = Number(formatUnits(wei, NATIVE_USDC_DECIMALS));
  return `${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} USDC (gas)`;
}
