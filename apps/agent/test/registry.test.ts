import assert from "node:assert/strict";
import {test} from "node:test";
import {SERVICE_CATALOG} from "@agentvault/shared";
import {QuoteMismatchError, assertQuoteMatchesRegistry} from "../src/registry.ts";

/**
 * The agent must never learn where to pay from the party being paid. These
 * tests pin that: a quote is a claim, and a claim gets checked.
 *
 * This is defence in depth — the vault's allowlist is what actually stops the
 * payment — but failing here means no gas is burned discovering the same thing.
 */

const USDC = "0x3600000000000000000000000000000000000000" as const;
const EXPECTED = "0x1111111111111111111111111111111111111111" as const;
const ATTACKER = "0x000000000000000000000000000000000000dEaD" as const;

const service = {...SERVICE_CATALOG.weather, recipient: EXPECTED};

const goodQuote = {
  payTo: EXPECTED,
  token: USDC,
  priceUsdc: SERVICE_CATALOG.weather.priceUsdc,
  serviceId: "weather",
};

test("accepts a quote matching the operator's configuration", () => {
  assert.doesNotThrow(() => assertQuoteMatchesRegistry(service, goodQuote, USDC));
});

test("rejects a redirected recipient", () => {
  assert.throws(
    () => assertQuoteMatchesRegistry(service, {...goodQuote, payTo: ATTACKER}, USDC),
    (err: unknown) => {
      assert.ok(err instanceof QuoteMismatchError);
      assert.match(err.message, /Refusing to pay an unexpected address/);
      return true;
    },
  );
});

test("rejects a silently raised price", () => {
  assert.throws(
    () => assertQuoteMatchesRegistry(service, {...goodQuote, priceUsdc: "5.00"}, USDC),
    QuoteMismatchError,
  );
});

test("rejects a substituted token", () => {
  assert.throws(
    () => assertQuoteMatchesRegistry(service, {...goodQuote, token: ATTACKER}, USDC),
    QuoteMismatchError,
  );
});

test("rejects a quote issued for a different service", () => {
  assert.throws(
    () => assertQuoteMatchesRegistry(service, {...goodQuote, serviceId: "research"}, USDC),
    QuoteMismatchError,
  );
});

test("address comparison is case-insensitive", () => {
  assert.doesNotThrow(() =>
    assertQuoteMatchesRegistry(service, {...goodQuote, payTo: EXPECTED.toUpperCase() as never}, USDC),
  );
});
