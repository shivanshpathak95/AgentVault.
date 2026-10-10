import type {ServiceQuote} from "@agentvault/shared";

/**
 * Invoices this agent actually obtained from a service.
 *
 * The model's arguments to `request_payment` are untrusted. Without this
 * ledger a manipulated model could invent invoice ids and pay an allowlisted
 * service over and over — every payment within policy, none of them buying
 * anything — draining the daily budget for nothing. With it, a payment must
 * name an invoice that a real `request_service_quote` call returned, and it is
 * paid on the QUOTED terms rather than whatever amount the model restates.
 *
 * Process-local and in-memory, like the idempotency store.
 */
export class QuoteLedger {
  readonly #quotes = new Map<string, ServiceQuote>();

  remember(quote: ServiceQuote): void {
    this.#quotes.set(quote.invoiceId, quote);
  }

  /** The quote, if this agent obtained it and it has not expired. */
  get(invoiceId: string, nowSeconds = Math.floor(Date.now() / 1000)): ServiceQuote | undefined {
    const q = this.#quotes.get(invoiceId);
    if (!q) return undefined;
    if (q.expiresAt < nowSeconds) {
      this.#quotes.delete(invoiceId);
      return undefined;
    }
    return q;
  }
}
