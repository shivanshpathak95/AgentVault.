import assert from "node:assert/strict";
import {test} from "node:test";
import {invoiceIntentHash} from "@agentvault/shared";
import {InvoiceStore} from "../src/invoices.ts";

const TX_A = `0x${"a".repeat(64)}` as const;
const TX_B = `0x${"b".repeat(64)}` as const;

test("issues an invoice bound to a deterministic intent hash", () => {
  const store = new InvoiceStore();
  const inv = store.issue("weather", "Tokyo", "0.01", 10_000n);

  assert.equal(inv.serviceId, "weather");
  assert.equal(inv.param, "Tokyo");
  assert.equal(inv.priceBaseUnits, 10_000n);
  // Both sides derive the binding the same way, so they cannot disagree.
  assert.equal(inv.intentHash, invoiceIntentHash(inv.invoiceId));
});

test("invoice ids are unique", () => {
  const store = new InvoiceStore();
  const a = store.issue("weather", "Tokyo", "0.01", 10_000n);
  const b = store.issue("weather", "Tokyo", "0.01", 10_000n);
  assert.notEqual(a.invoiceId, b.invoiceId);
  assert.notEqual(a.intentHash, b.intentHash);
});

// Without this an agent pays 0.01 USDC once and calls the service forever.
test("an invoice can only be redeemed once", () => {
  const store = new InvoiceStore();
  const inv = store.issue("weather", "Tokyo", "0.01", 10_000n);

  assert.equal(store.redeem(inv.invoiceId, TX_A), true);
  assert.equal(store.redeem(inv.invoiceId, TX_B), false, "second redemption refused");
  assert.equal(store.get(inv.invoiceId)?.redeemedTxHash, TX_A);
});

// And without this, one payment settles every outstanding invoice.
test("a transaction cannot settle two invoices", () => {
  const store = new InvoiceStore();
  const first = store.issue("weather", "Tokyo", "0.01", 10_000n);
  const second = store.issue("research", "batteries", "0.02", 20_000n);

  assert.equal(store.redeem(first.invoiceId, TX_A), true);
  assert.equal(store.isTxUsed(TX_A), true);
  assert.equal(store.redeem(second.invoiceId, TX_A), false, "tx reuse refused");
});

test("tx reuse check is case-insensitive", () => {
  const store = new InvoiceStore();
  const inv = store.issue("weather", "Tokyo", "0.01", 10_000n);
  store.redeem(inv.invoiceId, TX_A);
  assert.equal(store.isTxUsed(TX_A.toUpperCase() as never), true);
});

test("redeeming an unknown invoice fails", () => {
  const store = new InvoiceStore();
  assert.equal(store.redeem("inv_nope", TX_A), false);
});

test("prune drops expired unredeemed invoices but keeps settled ones", () => {
  const store = new InvoiceStore();
  const stale = store.issue("weather", "Tokyo", "0.01", 10_000n);
  const settled = store.issue("research", "x", "0.02", 20_000n);
  store.redeem(settled.invoiceId, TX_B);

  // Force both past their TTL.
  const s = store.get(stale.invoiceId);
  const t = store.get(settled.invoiceId);
  if (s) s.expiresAt = 0;
  if (t) t.expiresAt = 0;

  store.prune();
  assert.equal(store.get(stale.invoiceId), undefined, "expired quote dropped");
  assert.ok(store.get(settled.invoiceId), "settled invoice retained");
});
