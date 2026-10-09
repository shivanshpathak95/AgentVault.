import assert from "node:assert/strict";
import {test} from "node:test";
import {
  NATIVE_USDC_DECIMALS,
  USDC_ERC20_DECIMALS,
  UsdcAmountError,
  fromBaseUnits,
  toBaseUnits,
} from "../src/usdc.ts";

test("parses plain decimals into 6dp base units", () => {
  assert.equal(toBaseUnits("0.01"), 10_000n);
  assert.equal(toBaseUnits("12.50"), 12_500_000n);
  assert.equal(toBaseUnits("1"), 1_000_000n);
  assert.equal(toBaseUnits("0"), 0n);
});

test("round-trips through fromBaseUnits", () => {
  assert.equal(fromBaseUnits(12_500_000n), "12.5");
  assert.equal(fromBaseUnits(10_000n), "0.01");
});

// The whole point of the strict parser: viem's parseUnits would silently
// truncate "0.0000001" to 0, turning a malformed request into a free payment.
test("rejects excess precision instead of truncating it", () => {
  assert.throws(() => toBaseUnits("0.0000001"), UsdcAmountError);
  assert.throws(() => toBaseUnits("1.1234567"), UsdcAmountError);
});

test("rejects anything that is not a plain positive decimal", () => {
  for (const bad of ["-1", "1e6", "1,000", "abc", "", " ", "0x10", "Infinity", "1.2.3"]) {
    assert.throws(() => toBaseUnits(bad), UsdcAmountError, `should reject ${JSON.stringify(bad)}`);
  }
});

test("the two USDC representations stay distinct", () => {
  assert.equal(USDC_ERC20_DECIMALS, 6);
  assert.equal(NATIVE_USDC_DECIMALS, 18);
  // Confusing them is a 10^12 error — this is threat T-12 in one assertion.
  assert.equal(toBaseUnits("1", NATIVE_USDC_DECIMALS) / toBaseUnits("1"), 1_000_000_000_000n);
});
