import {
  REJECTION_EXPLANATION,
  UsdcAmountError,
  describeFailure,
  fromBaseUnits,
  invoiceIntentHash,
  rejectionReasonName,
  toBaseUnits,
  txUrl,
  type ActivityEntry,
  type ChainConfig,
  type PaymentStage,
  type RejectionReasonName,
  redactSecrets,
} from "@agentvault/shared";
import type {Address, Hex} from "viem";
import type {ActivityLog} from "./activity.ts";
import type {PaymentIdempotencyStore} from "./idempotency.ts";
import type {SessionSigner} from "./chain/session-signer.ts";
import {
  QuoteMismatchError,
  assertQuoteMatchesRegistry,
  lookupService,
  type ServiceRegistry,
} from "./registry.ts";

/**
 * The payment path. Every USDC movement in this system goes through here, and
 * every call here goes through the AgentVault contract.
 *
 * There is deliberately no code path that transfers USDC directly: this module
 * holds a session key whose only on-chain capability is `vault.pay`, so even a
 * bug here cannot bypass the policy. The contract re-checks everything.
 *
 * Order of operations, and why each step exists:
 *
 *   1. Registry validation  — is this a service the operator configured, at the
 *                             address and price they configured? Catches a
 *                             redirected or repriced quote before any gas.
 *   2. Amount parsing       — strict decimal -> 6dp base units, one audited
 *                             place, rejecting excess precision rather than
 *                             silently truncating it.
 *   3. previewPay           — the contract's own opinion, as a free view call.
 *                             This is the "backend policy check for better UX":
 *                             a rejection here costs nothing and still carries
 *                             the contract's real reason.
 *   4. simulate             — catches anything step 3 missed and decodes the
 *                             custom error. Closes the race where another
 *                             payment consumes the daily budget between the
 *                             preview and the send.
 *   5. send + confirm       — submit, wait for finality, parse the receipt.
 *
 * Steps 3 and 4 are both "will this work?" and that overlap is intentional:
 * step 3 gives a clean reason code cheaply, step 4 is the authoritative dry run
 * immediately before sending. Neither authorises anything — step 5's `pay` runs
 * the full check sequence again on chain, which is the only check that counts.
 */

export interface RequestPaymentInput {
  serviceId: string;
  recipient: Address;
  /** Decimal USDC, e.g. "0.01". Never base units. */
  amount: string;
  token: Address;
  /**
   * The invoice this payment settles. Recorded on chain as `intentHash` so the
   * service can prove which obligation was discharged. Defaults to a fresh id
   * when a caller just wants to move funds.
   */
  reference?: string;
}

export type PaymentResult =
  | {
      status: "executed";
      txHash: Hex;
      explorerUrl: string;
      serviceId: string;
      recipient: Address;
      token: Address;
      amount: string;
      reference: string;
      intentHash: Hex;
      /** Decimal USDC still spendable today, after this payment. */
      dailyRemaining: string;
      activity: ActivityEntry;
    }
  | {
      status: "rejected" | "failed" | "unconfirmed";
      stage: PaymentStage;
      /** Present when a transaction exists (on-chain revert, or unconfirmed). */
      txHash?: Hex;
      reason?: string;
      message: string;
      detail: Record<string, string>;
      serviceId: string;
      recipient: Address;
      amount: string;
      reference: string;
      activity: ActivityEntry;
    };

export interface PaymentContext {
  signer: SessionSigner;
  chain: ChainConfig;
  registry: ServiceRegistry;
  activity: ActivityLog;
  idempotency: PaymentIdempotencyStore;
}

/**
 * Entry point for every payment. Wraps the real work in a per-invoice
 * idempotency guard so one invoice can never produce two transactions.
 */
export async function requestPayment(
  ctx: PaymentContext,
  input: RequestPaymentInput,
): Promise<PaymentResult> {
  const reference = input.reference ?? `ref_${Date.now()}`;
  return ctx.idempotency.run(reference, () => executePayment(ctx, {...input, reference}));
}

async function executePayment(
  ctx: PaymentContext,
  input: RequestPaymentInput,
): Promise<PaymentResult> {
  const {signer, chain, registry, activity} = ctx;
  const reference = input.reference ?? `ref_${Date.now()}`;
  const service = lookupService(registry, input.serviceId);

  const reject = (
    message: string,
    detail: Record<string, string>,
    stage: PaymentStage,
    opts: {
      reason?: string | undefined;
      status?: "rejected" | "failed" | "unconfirmed";
      txHash?: Hex | undefined;
    } = {},
  ): PaymentResult => {
    const status = opts.status ?? "rejected";
    // RPC URLs often embed API keys; never let one reach the log, the model or
    // the browser via an error string.
    const safeMessage = redactSecrets(message, chain.rpcUrl);
    const base: Omit<ActivityEntry, "id" | "timestamp"> = {
      status,
      stage,
      amount: input.amount,
      token: input.token,
      recipient: input.recipient,
      reference,
      message: safeMessage,
      detail,
    };
    if (service) {
      base.serviceId = service.id;
      base.serviceName = service.name;
    }
    if (opts.reason) base.reason = opts.reason as RejectionReasonName;
    // A hash is recorded ONLY when a transaction genuinely exists. Nothing is
    // fabricated for a refusal that never produced one.
    if (opts.txHash) {
      base.txHash = opts.txHash;
      base.explorerUrl = txUrl(chain, opts.txHash);
    }

    const entry = activity.record(base);

    return {
      status,
      stage,
      message: safeMessage,
      detail,
      serviceId: input.serviceId,
      recipient: input.recipient,
      amount: input.amount,
      reference,
      activity: entry,
      ...(opts.reason ? {reason: opts.reason} : {}),
      ...(opts.txHash ? {txHash: opts.txHash} : {}),
    };
  };

  // --- 1. Registry validation -------------------------------------------
  if (!service) {
    return reject(
      `Unknown service "${input.serviceId}". Call list_services to see what is available.`,
      {serviceId: input.serviceId},
      "backend_validation",
    );
  }

  try {
    assertQuoteMatchesRegistry(
      service,
      {
        payTo: input.recipient,
        token: input.token,
        priceUsdc: input.amount,
        serviceId: input.serviceId,
      },
      chain.usdcAddress,
      chain.usdcDecimals,
    );
  } catch (err) {
    if (err instanceof QuoteMismatchError) {
      return reject(
        `Payment blocked before submission: ${err.message}`,
        {
          expectedRecipient: service.recipient,
          attemptedRecipient: input.recipient,
          expectedPrice: service.priceUsdc,
          attemptedAmount: input.amount,
        },
        "backend_validation",
      );
    }
    throw err;
  }

  // --- 2. Amount parsing -------------------------------------------------
  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = toBaseUnits(input.amount, chain.usdcDecimals);
  } catch (err) {
    if (err instanceof UsdcAmountError) {
      return reject(
        `Payment blocked: ${err.message}`,
        {attemptedAmount: input.amount},
        "backend_validation",
      );
    }
    throw err;
  }

  const intentHash = invoiceIntentHash(reference);

  // --- 3. previewPay: the contract's own free opinion ---------------------
  try {
    const [allowed, reasonCode] = await signer.preview(
      input.token,
      input.recipient,
      amountBaseUnits,
    );
    if (!allowed) {
      const reason = rejectionReasonName(Number(reasonCode));
      // Fetch the bounding numbers so the message names them, matching what a
      // real revert would have said.
      const remaining = await signer.remainingDailyAllowance().catch(() => null);
      const detail: Record<string, string> = {
        requested: input.amount,
        ...(remaining !== null
          ? {remainingToday: fromBaseUnits(remaining, chain.usdcDecimals)}
          : {}),
      };
      return reject(
        `Payment blocked by the vault policy: ${REJECTION_EXPLANATION[reason]}`,
        detail,
        "contract_preview",
        {reason},
      );
    }
  } catch (err) {
    // A preview that cannot run is an operational fault, not a policy verdict.
    // Fall through to the simulation rather than reporting a false rejection.
    console.warn(
      JSON.stringify({
        event: "preview.unavailable",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // --- 4. Simulate + send ------------------------------------------------
  let txHash: Hex;
  try {
    txHash = await signer.pay(input.token, input.recipient, amountBaseUnits, intentHash);
  } catch (err) {
    // Nothing was broadcast. Either the simulation reverted — a contract
    // refusal, decoded — or the send itself failed (RPC, nonce, gas). Both
    // are safely retryable because no transaction exists.
    const failure = describeFailure(err, chain.usdcDecimals);
    return reject(
      failure.message,
      failure.detail,
      failure.kind === "rejected" ? "contract_simulation" : "submission_error",
      {reason: failure.reason, status: failure.kind === "rejected" ? "rejected" : "failed"},
    );
  }

  // --- 5. Confirm ---------------------------------------------------------
  //
  // From here a real transaction exists. A failure to OBSERVE its receipt is
  // not a failure of the payment: it may still settle. Reporting it as
  // "failed" would make it retryable and risk paying twice, so it is recorded
  // as unconfirmed and the idempotency guard refuses to resubmit it.
  let receipt;
  try {
    receipt = await signer.confirm(txHash);
  } catch {
    return reject(
      `Payment submitted as ${txHash}, but confirmation was not observed. It may still ` +
        `settle — do NOT retry. Check the transaction on the explorer.`,
      {txHash},
      "awaiting_receipt",
      {status: "unconfirmed", txHash},
    );
  }

  if (receipt.status !== "success") {
    // Mined and reverted: a real hash, gas spent, no funds moved, and — because
    // it reverted — no PaymentExecuted log survives on chain.
    return reject(
      "Payment transaction was mined but reverted on chain. No funds moved.",
      {txHash},
      "onchain_revert",
      {status: "failed", txHash},
    );
  }

  const settled = signer.parsePaymentEvent(receipt);
  if (!settled) {
    // A success receipt with no PaymentExecuted from the vault is not a
    // payment we can vouch for. Refuse to call it one.
    return reject(
      "Transaction succeeded but carried no PaymentExecuted event from the vault.",
      {txHash},
      "confirmed",
      {status: "failed", txHash},
    );
  }

  const remaining = await signer.remainingDailyAllowance().catch(() => 0n);
  const explorerUrl = txUrl(chain, txHash);
  const paidAmount = fromBaseUnits(settled.amount, chain.usdcDecimals);

  const entry = activity.record({
    status: "executed",
    stage: "confirmed",
    serviceId: service.id,
    serviceName: service.name,
    amount: paidAmount,
    token: input.token,
    recipient: input.recipient,
    reference,
    txHash,
    explorerUrl,
    message: `Paid ${paidAmount} USDC to ${service.name}.`,
  });

  return {
    status: "executed",
    txHash,
    explorerUrl,
    serviceId: service.id,
    recipient: input.recipient,
    token: input.token,
    amount: paidAmount,
    reference,
    intentHash,
    dailyRemaining: fromBaseUnits(remaining, chain.usdcDecimals),
    activity: entry,
  };
}
