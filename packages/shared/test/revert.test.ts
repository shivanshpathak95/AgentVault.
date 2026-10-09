import assert from "node:assert/strict";
import {test} from "node:test";
import {formatRejection} from "../src/revert.ts";

/**
 * These assert the exact sentence an operator reads. The spec's own example is
 * the first test: a reason code is useless, a sentence naming both numbers is
 * actionable.
 */

test("ExceedsMaxPerTx names both the request and the ceiling", () => {
  const out = formatRejection("ExceedsMaxPerTx", [500_000n, 50_000n]);
  assert.equal(out.reason, "EXCEEDS_MAX_PER_TX");
  assert.equal(
    out.message,
    "Payment blocked: requested 0.5 USDC but the maximum allowed per transaction is 0.05 USDC.",
  );
  assert.deepEqual(out.detail, {requested: "0.5", maxPerTx: "0.05"});
});

test("DailyLimitExceeded names what is left today", () => {
  const out = formatRejection("DailyLimitExceeded", [10_000_000n, 5_000_000n]);
  assert.equal(out.reason, "DAILY_LIMIT_EXCEEDED");
  assert.match(out.message, /requested 10 USDC but only 5 USDC remains/);
  assert.match(out.message, /resets at the next UTC day/);
});

test("InsufficientBalance distinguishes the vault from the policy", () => {
  const out = formatRejection("InsufficientBalance", [5_000_000n, 1_000_000n]);
  assert.equal(out.reason, "INSUFFICIENT_BALANCE");
  assert.match(out.message, /vault holds only 1 USDC/);
});

test("RecipientNotAllowed names the attempted address", () => {
  const addr = "0x000000000000000000000000000000000000dEaD";
  const out = formatRejection("RecipientNotAllowed", [addr]);
  assert.equal(out.reason, "RECIPIENT_NOT_ALLOWED");
  assert.match(out.message, new RegExp(addr));
  assert.match(out.message, /Only the operator can add recipients/);
});

test("InvalidToken names both tokens", () => {
  const out = formatRejection("InvalidToken", ["0xaaa", "0xbbb"]);
  assert.equal(out.reason, "INVALID_TOKEN");
  assert.match(out.message, /0xbbb/);
  assert.match(out.message, /0xaaa/);
});

test("SessionExpired renders the expiry as a readable time", () => {
  const out = formatRejection("SessionExpired", [1_760_000_000n, 1_760_000_001n]);
  assert.equal(out.reason, "SESSION_EXPIRED");
  assert.match(out.message, /2025-10-09T/);
});

test("argument-free errors still explain themselves", () => {
  assert.equal(formatRejection("SessionIsRevoked", []).reason, "SESSION_REVOKED");
  assert.match(formatRejection("SessionIsRevoked", []).message, /permanent/);
  assert.equal(formatRejection("VaultPaused", []).reason, "VAULT_PAUSED");
  assert.match(formatRejection("VaultPaused", []).message, /frozen/);
});

// An unrecognised selector must still read as a refusal, not as a transport
// fault the caller might decide to retry.
test("an unknown error is reported as a refusal", () => {
  const out = formatRejection("SomethingNew", []);
  assert.match(out.message, /Payment blocked/);
});
