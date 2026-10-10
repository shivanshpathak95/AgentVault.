import type {PaymentResult} from "./payments.ts";

/**
 * Duplicate-payment protection.
 *
 * Without this, two `request_payment` calls carrying the same invoice id submit
 * two on-chain payments. Both settle — the contract has no reason to refuse the
 * second, since it is within policy — but the service redeems only one, so the
 * operator pays twice for one result. A retrying model, a double-clicked UI or
 * a replayed HTTP request is enough to trigger it.
 *
 * Semantics, chosen deliberately:
 *
 *   in flight  -> return the SAME promise, so concurrent callers never produce
 *                 two transactions for one invoice.
 *   executed   -> cached permanently and replayed. Money moved once; saying so
 *                 again is correct and costs nothing.
 *   rejected   -> NOT cached. The contract refused and no funds moved, so a
 *                 later retry (after the operator raises a limit, say) is
 *                 legitimate and must be allowed to reach the chain.
 *   failed     -> NOT cached. Nothing settled (never sent, or mined and
 *                 reverted); retrying is the correct response.
 *   unconfirmed-> cached. A transaction was sent and may still settle;
 *                 resubmitting could pay twice.
 *
 * This is process-local. A restart forgets in-flight work, and a second agent
 * process would not share it — both are acceptable for a single-process MVP and
 * are recorded as limitations rather than hidden.
 */
export class PaymentIdempotencyStore {
  readonly #inFlight = new Map<string, Promise<PaymentResult>>();
  readonly #settled = new Map<string, PaymentResult>();

  /** Run `fn` at most once per reference, replaying a settled result. */
  async run(reference: string, fn: () => Promise<PaymentResult>): Promise<PaymentResult> {
    const settled = this.#settled.get(reference);
    if (settled) return settled;

    const existing = this.#inFlight.get(reference);
    if (existing) return existing;

    const promise = (async () => {
      const result = await fn();
      // Refusals and failures stay retryable. An unconfirmed payment may still settle — resubmitting would risk
      // paying twice — so it is pinned exactly like a settled one.
      if (result.status === "executed" || result.status === "unconfirmed") {
        this.#settled.set(reference, result);
      }
      return result;
    })();

    this.#inFlight.set(reference, promise);
    try {
      return await promise;
    } finally {
      this.#inFlight.delete(reference);
    }
  }

  /** True when this reference already produced a settled payment. */
  hasSettled(reference: string): boolean {
    return this.#settled.has(reference);
  }

  get settledCount(): number {
    return this.#settled.size;
  }
}
