import {BaseError, ContractFunctionRevertedError, type Address} from "viem";
import {
  ERROR_NAME_TO_REASON,
  REJECTION_EXPLANATION,
  type RejectionReasonName,
} from "./types.ts";
import {fromBaseUnits, USDC_ERC20_DECIMALS} from "./usdc.ts";

/**
 * Turn a contract rejection into something a person can act on.
 *
 * A refused payment reverts, so there is no event to read — the reason lives in
 * the revert's 4-byte selector and its arguments. This module decodes that into
 * a `RejectionReason` plus a sentence naming the actual numbers, because
 * "EXCEEDS_MAX_PER_TX" tells an operator nothing they can act on, whereas
 * "requested 0.50 USDC but the maximum allowed per transaction is 0.05 USDC"
 * tells them exactly what to change.
 *
 * The same text goes back to the model as a tool result, which is why it names
 * the constraint rather than merely reporting failure: a model that knows the
 * ceiling can adapt, while one told only "rejected" will retry blindly.
 */

export interface DecodedRejection {
  reason: RejectionReasonName;
  /** Human-readable, with concrete amounts substituted. */
  message: string;
  /** Machine-readable specifics, for the UI and the activity log. */
  detail: Record<string, string>;
}

function usdc(value: unknown, decimals: number): string {
  return typeof value === "bigint" ? fromBaseUnits(value, decimals) : String(value);
}

function addr(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function isoFromUnix(value: unknown): string {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) ? new Date(n * 1000).toISOString() : String(value);
}

/**
 * Format one decoded custom error.
 *
 * Exported separately from `decodeRejection` so it can be unit-tested without
 * fabricating a viem error chain.
 */
export function formatRejection(
  errorName: string,
  args: readonly unknown[],
  decimals: number = USDC_ERC20_DECIMALS,
): DecodedRejection {
  const reason = ERROR_NAME_TO_REASON[errorName];

  switch (errorName) {
    case "ExceedsMaxPerTx": {
      const requested = usdc(args[0], decimals);
      const max = usdc(args[1], decimals);
      return {
        reason: "EXCEEDS_MAX_PER_TX",
        message:
          `Payment blocked: requested ${requested} USDC but the maximum allowed ` +
          `per transaction is ${max} USDC.`,
        detail: {requested, maxPerTx: max},
      };
    }

    case "DailyLimitExceeded": {
      const requested = usdc(args[0], decimals);
      const remaining = usdc(args[1], decimals);
      return {
        reason: "DAILY_LIMIT_EXCEEDED",
        message:
          `Payment blocked: requested ${requested} USDC but only ${remaining} USDC ` +
          `remains in today's spending limit. The limit resets at the next UTC day.`,
        detail: {requested, remainingToday: remaining},
      };
    }

    case "InsufficientBalance": {
      const requested = usdc(args[0], decimals);
      const held = usdc(args[1], decimals);
      return {
        reason: "INSUFFICIENT_BALANCE",
        message:
          `Payment blocked: requested ${requested} USDC but the vault holds only ` +
          `${held} USDC. The operator needs to fund it.`,
        detail: {requested, vaultBalance: held},
      };
    }

    case "RecipientNotAllowed": {
      const attempted = addr(args[0]);
      return {
        reason: "RECIPIENT_NOT_ALLOWED",
        message:
          `Payment blocked: ${attempted} is not on the operator's approved recipient ` +
          `list for this session. Only the operator can add recipients.`,
        detail: {attemptedRecipient: attempted},
      };
    }

    case "InvalidToken": {
      const attempted = addr(args[0]);
      const expected = addr(args[1]);
      return {
        reason: "INVALID_TOKEN",
        message:
          `Payment blocked: this vault only pays in the USDC at ${expected}, ` +
          `not ${attempted}.`,
        detail: {attemptedToken: attempted, expectedToken: expected},
      };
    }

    case "UnauthorizedAgent": {
      const caller = addr(args[0]);
      return {
        reason: "UNAUTHORIZED_AGENT",
        message:
          `Payment blocked: ${caller} is not an authorized session key on this vault ` +
          `and has no spending authority at all.`,
        detail: {caller},
      };
    }

    case "SessionExpired": {
      const expiredAt = isoFromUnix(args[0]);
      return {
        reason: "SESSION_EXPIRED",
        message:
          `Payment blocked: this agent session expired at ${expiredAt}. Sessions fail ` +
          `closed — the operator must issue a new one.`,
        detail: {expiredAt},
      };
    }

    case "SessionIsRevoked":
      return {
        reason: "SESSION_REVOKED",
        message:
          "Payment blocked: the operator revoked this agent session. Revocation is " +
          "permanent — a new session key is required.",
        detail: {},
      };

    case "VaultPaused":
      return {
        reason: "VAULT_PAUSED",
        message:
          "Payment blocked: the operator has frozen this vault. All agent spending is " +
          "halted until they unfreeze it.",
        detail: {},
      };

    case "ZeroAmount":
      return {
        reason: "ZERO_AMOUNT",
        message: "Payment blocked: the amount must be greater than zero.",
        detail: {},
      };

    default: {
      // An unrecognised selector is still a refusal. Report it as one rather
      // than letting it read as a transport failure the caller might retry.
      return {
        reason: reason ?? "UNAUTHORIZED_AGENT",
        message:
          `Payment blocked by the vault contract (${errorName || "unknown error"}). ` +
          (reason ? REJECTION_EXPLANATION[reason] : "The payment was not permitted."),
        detail: {errorName},
      };
    }
  }
}

/**
 * Walk a viem error chain for a contract revert and decode it.
 *
 * Returns `null` when the failure was not a contract rejection — an RPC
 * timeout, a nonce problem, an unfunded session key. Those are operational
 * faults, not policy decisions, and conflating the two would tell an operator
 * their policy blocked something when the network simply hiccupped.
 */
export function decodeRejection(
  err: unknown,
  decimals: number = USDC_ERC20_DECIMALS,
): DecodedRejection | null {
  if (!(err instanceof BaseError)) return null;

  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return null;

  const errorName = revert.data?.errorName ?? revert.reason ?? "";
  const args = (revert.data?.args ?? []) as readonly unknown[];

  return formatRejection(errorName, args, decimals);
}

/** Convenience for the common "either a policy rejection or an operational fault". */
export function describeFailure(err: unknown, decimals: number = USDC_ERC20_DECIMALS): {
  kind: "rejected" | "failed";
  message: string;
  reason?: RejectionReasonName;
  detail: Record<string, string>;
} {
  const decoded = decodeRejection(err, decimals);
  if (decoded) {
    return {
      kind: "rejected",
      message: decoded.message,
      reason: decoded.reason,
      detail: decoded.detail,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    kind: "failed",
    message: `Payment could not be submitted: ${message}`,
    detail: {},
  };
}

/** Narrow a value to an address-ish string for logging. */
export function shortAddress(value: Address | string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
