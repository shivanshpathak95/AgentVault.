import assert from "node:assert/strict";
import {test} from "node:test";
import {SERVICE_CATALOG, redactSecrets, redactUrl, type ServiceQuote} from "@agentvault/shared";
import {executeTool, type ToolContext} from "../src/agent/tools.ts";
import {ActivityLog} from "../src/activity.ts";
import {PaymentIdempotencyStore} from "../src/idempotency.ts";
import type {PaymentResult} from "../src/payments.ts";
import {QuoteLedger} from "../src/quotes.ts";
import {QuoteMismatchError, assertQuoteMatchesRegistry} from "../src/registry.ts";

const USDC = "0x3600000000000000000000000000000000000000" as const;
const PAY_TO = "0x1111111111111111111111111111111111111111" as const;

const quote = (over: Partial<ServiceQuote> = {}): ServiceQuote => ({
  invoiceId: "inv_real",
  serviceId: "weather",
  priceUsdc: "0.01",
  token: USDC,
  payTo: PAY_TO,
  intentHash: "0x00",
  expiresAt: Math.floor(Date.now() / 1000) + 600,
  ...over,
});

/** A context whose chain-touching parts explode if used. */
function guardedCtx(quotes: QuoteLedger): ToolContext {
  const boom = new Proxy({}, {get: () => () => assert.fail("signer must not be touched")});
  return {
    config: {chain: {usdcAddress: USDC, usdcDecimals: 6, rpcUrl: ""}} as never,
    signer: boom as never,
    registry: {
      weather: {...SERVICE_CATALOG.weather, recipient: PAY_TO},
      research: {...SERVICE_CATALOG.research, recipient: PAY_TO},
    },
    activity: new ActivityLog(),
    serviceClient: boom as never,
    idempotency: new PaymentIdempotencyStore(),
    quotes,
  };
}

test("request_payment refuses an invoice id the agent never obtained", async () => {
  const out = (await executeTool(guardedCtx(new QuoteLedger()), "request_payment", {
    serviceId: "weather",
    invoiceId: "inv_invented",
    recipient: PAY_TO,
    amount: "0.01",
  })) as {status: string; stage: string};
  assert.equal(out.status, "rejected");
  assert.equal(out.stage, "backend_validation");
});

test("request_payment refuses terms that differ from the quote", async () => {
  const ledger = new QuoteLedger();
  ledger.remember(quote());
  const out = (await executeTool(guardedCtx(ledger), "request_payment", {
    serviceId: "weather",
    invoiceId: "inv_real",
    recipient: PAY_TO,
    amount: "0.02",
  })) as {status: string; message: string};
  assert.equal(out.status, "rejected");
  assert.match(out.message, /do not match quote/);
});

test("an expired quote is forgotten", () => {
  const ledger = new QuoteLedger();
  ledger.remember(quote({expiresAt: 100}));
  assert.equal(ledger.get("inv_real", 200), undefined);
});

test("prices are compared in base units, not as strings", () => {
  const service = {...SERVICE_CATALOG.weather, recipient: PAY_TO};
  const base = {payTo: PAY_TO, token: USDC, serviceId: "weather"};
  assert.doesNotThrow(() => assertQuoteMatchesRegistry(service, {...base, priceUsdc: "0.010"}, USDC));
  assert.throws(
    () => assertQuoteMatchesRegistry(service, {...base, priceUsdc: "0.011"}, USDC),
    QuoteMismatchError,
  );
  assert.throws(
    () => assertQuoteMatchesRegistry(service, {...base, priceUsdc: "1e-2"}, USDC),
    QuoteMismatchError,
  );
});

test("an unconfirmed payment is pinned — never resubmitted", async () => {
  const store = new PaymentIdempotencyStore();
  let calls = 0;
  const unconfirmed = {status: "unconfirmed", stage: "awaiting_receipt"} as unknown as PaymentResult;
  await store.run("inv_u", async () => (calls++, unconfirmed));
  await store.run("inv_u", async () => (calls++, unconfirmed));
  assert.equal(calls, 1, "a retry could pay twice; it must not reach the chain");
});

test("service failure is recorded against the settled payment, not replacing it", () => {
  const log = new ActivityLog();
  log.record({
    status: "executed",
    amount: "0.01",
    token: USDC,
    recipient: PAY_TO,
    reference: "inv_s",
  });
  const entry = log.annotateService("inv_s", {serviceStatus: "failed", serviceMessage: "boom"});
  assert.equal(entry?.status, "executed", "payment status unchanged");
  assert.equal(entry?.serviceStatus, "failed");
});

test("RPC URLs are redacted before reaching logs or clients", () => {
  const url = "https://arc-mainnet.example.com/v2/SECRET_KEY_123?token=abc";
  assert.equal(redactUrl(url), "https://arc-mainnet.example.com/…");
  assert.doesNotMatch(redactSecrets(`request to ${url} failed`, url), /SECRET_KEY_123/);
  assert.equal(redactUrl("https://user:pass@host.example/x"), "https://host.example/…");
});
