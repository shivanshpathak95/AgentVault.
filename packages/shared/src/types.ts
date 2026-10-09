import type {Address, Hex} from "viem";

/**
 * Why a payment was, or would be, refused.
 *
 * MUST stay byte-identical in order to `IAgentVault.RejectionReason` in
 * contracts/src/interfaces/IAgentVault.sol — the numeric values are what
 * `previewPay` returns over the wire. Append only; never reorder.
 */
export const RejectionReason = {
  NONE: 0,
  VAULT_PAUSED: 1,
  UNAUTHORIZED_AGENT: 2,
  SESSION_REVOKED: 3,
  SESSION_EXPIRED: 4,
  INVALID_TOKEN: 5,
  RECIPIENT_NOT_ALLOWED: 6,
  ZERO_AMOUNT: 7,
  EXCEEDS_MAX_PER_TX: 8,
  DAILY_LIMIT_EXCEEDED: 9,
  INSUFFICIENT_BALANCE: 10,
} as const;

export type RejectionReasonCode =
  (typeof RejectionReason)[keyof typeof RejectionReason];

export type RejectionReasonName = keyof typeof RejectionReason;

const REASON_NAMES = Object.keys(RejectionReason) as RejectionReasonName[];

export function rejectionReasonName(code: number): RejectionReasonName {
  // An out-of-range code means the ABI drifted from this file. Fail toward the
  // most restrictive reading rather than reporting a payment as permitted.
  return REASON_NAMES[code] ?? "UNAUTHORIZED_AGENT";
}

/**
 * Solidity custom error name -> rejection reason.
 *
 * A refused payment reverts, so there is no event to read: the backend decodes
 * the revert's 4-byte selector to a name and maps it here. Kept beside the enum
 * so the two representations of "why" cannot drift apart.
 */
export const ERROR_NAME_TO_REASON: Record<string, RejectionReasonName> = {
  VaultPaused: "VAULT_PAUSED",
  UnauthorizedAgent: "UNAUTHORIZED_AGENT",
  SessionIsRevoked: "SESSION_REVOKED",
  SessionExpired: "SESSION_EXPIRED",
  InvalidToken: "INVALID_TOKEN",
  RecipientNotAllowed: "RECIPIENT_NOT_ALLOWED",
  ZeroAmount: "ZERO_AMOUNT",
  ExceedsMaxPerTx: "EXCEEDS_MAX_PER_TX",
  DailyLimitExceeded: "DAILY_LIMIT_EXCEEDED",
  InsufficientBalance: "INSUFFICIENT_BALANCE",
};

/**
 * Human-readable explanations. These are shown to the operator AND returned to
 * the model in tool results, so they are written to be acted on: each says what
 * the rule was, not merely that a rule existed.
 */
export const REJECTION_EXPLANATION: Record<RejectionReasonName, string> = {
  NONE: "Permitted by the vault policy.",
  VAULT_PAUSED:
    "The operator has frozen this vault. All agent spending is halted until they unfreeze it.",
  UNAUTHORIZED_AGENT:
    "This key is not a registered session on the vault. It has no spending authority at all.",
  SESSION_REVOKED:
    "The operator revoked this session. Revocation is permanent — a new session key is required.",
  SESSION_EXPIRED:
    "This session passed its expiry time. Sessions fail closed; the operator must issue a new one.",
  INVALID_TOKEN:
    "This vault only pays in its configured USDC token. No other token can be moved.",
  RECIPIENT_NOT_ALLOWED:
    "The recipient is not on this session's on-chain allowlist. Only the operator can add recipients.",
  ZERO_AMOUNT: "A payment must be greater than zero.",
  EXCEEDS_MAX_PER_TX:
    "The amount is above the per-transaction ceiling the operator set for this session.",
  DAILY_LIMIT_EXCEEDED:
    "This payment would push the session past its daily spending limit. The limit resets at the next UTC day.",
  INSUFFICIENT_BALANCE:
    "The vault does not hold enough USDC. The operator needs to fund it.",
};

/** Mirrors `IAgentVault.Session`. All amounts are 6dp USDC base units. */
export interface Session {
  maxPerTx: bigint;
  dailyLimit: bigint;
  expiresAt: bigint;
  windowDay: bigint;
  spentInWindow: bigint;
  revoked: boolean;
  exists: boolean;
}

/** A policy as authored in the UI, before conversion to base units. */
export interface PolicyDraft {
  sessionKey: Address;
  /** Decimal USDC, e.g. "25.00". Never base units. */
  maxPerTx: string;
  /** Decimal USDC, e.g. "40.00". */
  dailyLimit: string;
  /** Unix seconds. */
  expiresAt: number;
  allowedRecipients: Address[];
}

/** What the agent asks for. Amounts are decimal strings by design — see note. */
export interface PaymentRequest {
  /** Must be the vault's configured USDC, or the contract rejects INVALID_TOKEN. */
  token: Address;
  to: Address;
  /**
   * Decimal USDC, e.g. "12.50".
   *
   * Tools deliberately speak decimals rather than base units: a model reasons
   * correctly about "12.50" and poorly about "12500000", and keeping the
   * conversion in one audited place (usdc.ts) is the mitigation for the
   * 6-vs-18 decimal hazard that Arc's dual USDC representation creates.
   */
  amount: string;
  /** Opaque off-chain reference (an invoice id) bound into the on-chain event. */
  reference: string;
}

export type PaymentOutcome =
  | {
      status: "executed";
      txHash: Hex;
      token: Address;
      to: Address;
      amount: string;
      reference: string;
      intentHash: Hex;
      /** Decimal USDC left for this session today, after the payment. */
      dailyRemaining: string;
    }
  | {
      status: "rejected";
      reason: RejectionReasonName;
      explanation: string;
      attempted: {token: Address; to: Address; amount: string};
      /** Populated where the contract reported it (e.g. the limit that bound). */
      detail?: Record<string, string>;
    };

/** Vault state as the agent sees it. Decimal strings, ready for a tool result. */
export interface VaultStatus {
  vault: Address;
  sessionKey: Address;
  /** The only token this vault can pay in. */
  token: Address;
  paused: boolean;
  balance: string;
  maxPerTx: string;
  dailyLimit: string;
  dailyRemaining: string;
  expiresAt: number;
  expiresInSeconds: number;
  revoked: boolean;
  allowedRecipients: Address[];
}

/** A ledger row for /activity. Rejections are first-class, not error logs. */
export interface ActivityEntry {
  kind: "executed" | "rejected";
  at: number;
  to: Address;
  amount: string;
  reference: string;
  txHash?: Hex;
  reason?: RejectionReasonName;
}

/** Tool names exposed to the model. There is deliberately no policy-write tool. */
export const AGENT_TOOLS = {
  GET_VAULT_STATUS: "get_vault_status",
  CHECK_POLICY: "check_policy",
  REQUEST_PAYMENT: "request_payment",
} as const;

export type AgentToolName = (typeof AGENT_TOOLS)[keyof typeof AGENT_TOOLS];
