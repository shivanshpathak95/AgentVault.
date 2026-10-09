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
  type RejectionReasonName,
} from "@agentvault/shared";
import type {Address, Hex} from "viem";
import type {ActivityLog} from "./activity.ts";
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
      status: "rejected" | "failed";
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
}

export async function requestPayment(
  ctx: PaymentContext,
  input: RequestPaymentInput,
): Promise<PaymentResult> {
  const {signer, chain, registry, activity} = ctx;
  const reference = input.reference ?? `ref_${Date.now()}`;
  const service = lookupService(registry, input.serviceId);

  const reject = (
    message: string,
    detail: Record<string, string>,
    reason?: string,
    status: "rejected" | "failed" = "rejected",
  ): PaymentResult => {
    const base: Omit<ActivityEntry, "id" | "timestamp"> = {
      status,
      amount: input.amount,
      token: input.token,
      recipient: input.recipient,
      reference,
      message,
      detail,
    };
    if (service) {
      base.serviceId = service.id;
      base.serviceName = service.name;
    }
    if (reason) base.reason = reason as RejectionReasonName;

    const entry = activity.record(base);

    return {
      status,
      message,
      detail,
      serviceId: input.serviceId,
      recipient: input.recipient,
      amount: input.amount,
      reference,
      activity: entry,
      ...(reason ? {reason} : {}),
    };
  };

  // --- 1. Registry validation -------------------------------------------
  if (!service) {
    return reject(
      `Unknown service "${input.serviceId}". Call list_services to see what is available.`,
      {serviceId: input.serviceId},
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
    );
  } catch (err) {
    if (err instanceof QuoteMismatchError) {
      return reject(`Payment blocked before submission: ${err.message}`, {
        expectedRecipient: service.recipient,
        attemptedRecipient: input.recipient,
        expectedPrice: service.priceUsdc,
        attemptedAmount: input.amount,
      });
    }
    throw err;
  }

  // --- 2. Amount parsing -------------------------------------------------
  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = toBaseUnits(input.amount, chain.usdcDecimals);
  } catch (err) {
    if (err instanceof UsdcAmountError) {
      return reject(`Payment blocked: ${err.message}`, {attemptedAmount: input.amount});
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
        reason,
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

  // --- 4. Simulate, then 5. send and confirm ------------------------------
  try {
    const txHash = await signer.pay(input.token, input.recipient, amountBaseUnits, intentHash);
    const receipt = await signer.confirm(txHash);

    if (receipt.status !== "success") {
      return reject(
        "Payment transaction reverted on chain. No funds moved.",
        {txHash},
        undefined,
        "failed",
      );
    }

    const settled = signer.parsePaymentEvent(receipt);
    const remaining = await signer.remainingDailyAllowance().catch(() => 0n);
    const explorerUrl = txUrl(chain, txHash);

    const entry = activity.record({
      status: "executed",
      serviceId: service.id,
      serviceName: service.name,
      amount: settled ? fromBaseUnits(settled.amount, chain.usdcDecimals) : input.amount,
      token: input.token,
      recipient: input.recipient,
      reference,
      txHash,
      explorerUrl,
      message: `Paid ${input.amount} USDC to ${service.name}.`,
    });

    return {
      status: "executed",
      txHash,
      explorerUrl,
      serviceId: service.id,
      recipient: input.recipient,
      token: input.token,
      amount: settled ? fromBaseUnits(settled.amount, chain.usdcDecimals) : input.amount,
      reference,
      intentHash,
      dailyRemaining: fromBaseUnits(remaining, chain.usdcDecimals),
      activity: entry,
    };
  } catch (err) {
    // Distinguish a policy refusal from a network fault. Reporting an RPC
    // timeout as "your policy blocked this" would send an operator looking at
    // the wrong thing entirely.
    const failure = describeFailure(err, chain.usdcDecimals);
    return reject(
      failure.message,
      failure.detail,
      failure.reason,
      failure.kind === "rejected" ? "rejected" : "failed",
    );
  }
}
