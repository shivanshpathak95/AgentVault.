import {randomUUID} from "node:crypto";
import {invoiceIntentHash, type ServiceId} from "@agentvault/shared";
import type {Hex} from "viem";

/**
 * Invoice issuance and redemption.
 *
 * In-memory, which is right for a demo but is the thing to replace first if
 * this ever runs for real — a restart forgets which invoices were settled.
 *
 * Two properties matter regardless of storage:
 *
 *   1. An invoice can be redeemed once. Otherwise an agent pays 0.01 USDC and
 *      calls the service repeatedly with the same receipt.
 *   2. A transaction can settle one invoice. The `intentHash` recorded on chain
 *      binds a payment to a single invoice, and this store refuses a txHash it
 *      has already accepted — belt and braces, since a replayed hash is the
 *      cheapest possible attack.
 */

export interface Invoice {
  invoiceId: string;
  serviceId: ServiceId;
  /** The single parameter the caller asked for, captured at quote time. */
  param: string;
  priceBaseUnits: bigint;
  priceUsdc: string;
  intentHash: Hex;
  createdAt: number;
  expiresAt: number;
  redeemedTxHash?: Hex;
}

/** How long a quote stays valid. Long enough to pay, short enough to bound state. */
const QUOTE_TTL_SECONDS = 15 * 60;

export class InvoiceStore {
  readonly #invoices = new Map<string, Invoice>();
  readonly #usedTxHashes = new Set<string>();

  issue(serviceId: ServiceId, param: string, priceUsdc: string, priceBaseUnits: bigint): Invoice {
    const invoiceId = `inv_${randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);

    const invoice: Invoice = {
      invoiceId,
      serviceId,
      param,
      priceBaseUnits,
      priceUsdc,
      intentHash: invoiceIntentHash(invoiceId),
      createdAt: now,
      expiresAt: now + QUOTE_TTL_SECONDS,
    };

    this.#invoices.set(invoiceId, invoice);
    return invoice;
  }

  get(invoiceId: string): Invoice | undefined {
    return this.#invoices.get(invoiceId);
  }

  isTxUsed(txHash: Hex): boolean {
    return this.#usedTxHashes.has(txHash.toLowerCase());
  }

  /** Mark settled. Returns false if the invoice or the tx was already used. */
  redeem(invoiceId: string, txHash: Hex): boolean {
    const invoice = this.#invoices.get(invoiceId);
    if (!invoice || invoice.redeemedTxHash) return false;
    if (this.isTxUsed(txHash)) return false;

    invoice.redeemedTxHash = txHash;
    this.#usedTxHashes.add(txHash.toLowerCase());
    return true;
  }

  /** Drop expired, unredeemed invoices so the map does not grow without bound. */
  prune(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, invoice] of this.#invoices) {
      if (!invoice.redeemedTxHash && invoice.expiresAt < now) this.#invoices.delete(id);
    }
  }

  get size(): number {
    return this.#invoices.size;
  }
}
