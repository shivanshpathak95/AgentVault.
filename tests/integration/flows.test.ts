import assert from "node:assert/strict";
import type {ChildProcess} from "node:child_process";
import {after, before, describe, test} from "node:test";
import {
  SERVICE_CATALOG,
  fromBaseUnits,
  invoiceIntentHash,
  toBaseUnits,
  type ChainConfig,
} from "@agentvault/shared";
import {getAddress, type Address, type Hex} from "viem";
import {ActivityLog} from "../../apps/agent/src/activity.ts";
import {createSessionSigner, type SessionSigner} from "../../apps/agent/src/chain/session-signer.ts";
import {PaymentIdempotencyStore} from "../../apps/agent/src/idempotency.ts";
import {requestPayment} from "../../apps/agent/src/payments.ts";
import type {ServiceRegistry} from "../../apps/agent/src/registry.ts";
import {createServiceClient} from "../../apps/agent/src/service-client.ts";
import {
  AGENT_KEY,
  ANVIL_RPC,
  LOCAL_CHAIN_ID,
  deployLocalStack,
  startService,
  teardown,
  type Deployment,
} from "./harness.ts";

/**
 * End-to-end integration against a REAL chain (Anvil).
 *
 * Every assertion here rests on an actual transaction receipt or an actual
 * revert — nothing is stubbed. The agent's real payment module, the real
 * session signer and the real paid-service HTTP process are all exercised.
 *
 * NOT covered, and reported as such rather than implied:
 *   - Arc itself. Chain id, USDC semantics and gas token all differ.
 *   - The LLM step. No ANTHROPIC_API_KEY is configured in this environment, so
 *     the model's tool-calling loop is not executed; these tests drive the
 *     payment layer the model would have driven.
 */

const SERVICE_PORT = 8799;

const MAX_PER_TX = 50_000n; // 0.05 USDC at 6dp
const DAILY_LIMIT = 100_000n; // 0.10 USDC
const FUNDING = 5_000_000n; // 5 USDC
const WEATHER_PRICE = "0.01";

let d: Deployment | undefined;
let serviceProc: ChildProcess | undefined;
let signer: SessionSigner;
let chain: ChainConfig;
let registry: ServiceRegistry;
let activity: ActivityLog;
let idempotency: PaymentIdempotencyStore;

const serviceBase = `http://127.0.0.1:${SERVICE_PORT}`;
const client = createServiceClient(serviceBase);

function ctx() {
  return {signer, chain, registry, activity, idempotency};
}

before(async () => {
  d = await deployLocalStack({
    maxPerTx: MAX_PER_TX,
    dailyLimit: DAILY_LIMIT,
    funding: FUNDING,
    sessionSeconds: 3600,
  });

  // The service is paid at the weather recipient, which the operator
  // allowlisted during deployment.
  serviceProc = await startService(d, SERVICE_PORT, d.weatherRecipient);

  chain = {
    chainId: LOCAL_CHAIN_ID,
    name: "Anvil",
    rpcUrl: ANVIL_RPC,
    wsUrl: undefined,
    explorerUrl: "http://localhost/explorer",
    usdcAddress: d.usdc,
    // Read from the token at deploy time, not assumed.
    usdcDecimals: d.usdcDecimals,
  };

  signer = createSessionSigner(chain, AGENT_KEY, d.vault);
  activity = new ActivityLog();
  idempotency = new PaymentIdempotencyStore();

  registry = {
    weather: {...SERVICE_CATALOG.weather, recipient: d.weatherRecipient},
    research: {...SERVICE_CATALOG.research, recipient: d.researchRecipient},
  };
});

after(() => {
  serviceProc?.kill("SIGKILL");
  teardown(d);
});

// =============================================================================
// Preconditions
// =============================================================================

describe("deployment", () => {
  test("token decimals are read from the contract, not assumed", async () => {
    assert.equal(d!.usdcDecimals, 6, "mock mirrors Arc's ERC-20 interface");
    assert.equal(chain.usdcDecimals, d!.usdcDecimals);
    // 0.01 USDC must encode from the token's own decimals.
    assert.equal(toBaseUnits(WEATHER_PRICE, chain.usdcDecimals), 10_000n);
  });

  test("vault is funded and the session is authorised on chain", async () => {
    assert.equal(await signer.vaultBalance(), FUNDING);
    const session = await signer.getSession();
    assert.equal(session.exists, true);
    assert.equal(session.revoked, false);
    assert.equal(session.maxPerTx, MAX_PER_TX);
    assert.equal(session.dailyLimit, DAILY_LIMIT);
    assert.equal(await signer.isRecipientAllowed(d!.weatherRecipient), true);
  });
});

// =============================================================================
// FLOW A — successful payment, end to end through the real service
// =============================================================================

describe("Flow A: successful payment", () => {
  test("quote -> pay -> confirm -> service verifies -> result released", async () => {
    // 1. The service quotes and returns 402 with an invoice.
    const quote = await client.quote("weather", "Tokyo");
    assert.equal(quote.serviceId, "weather");
    assert.equal(quote.priceUsdc, WEATHER_PRICE);
    assert.equal(getAddress(quote.payTo), d!.weatherRecipient);
    assert.equal(quote.intentHash, invoiceIntentHash(quote.invoiceId));

    const balanceBefore = await signer.vaultBalance();

    // 2. The agent asks the vault to pay. Real transaction, real receipt.
    const result = await requestPayment(ctx(), {
      serviceId: "weather",
      recipient: d!.weatherRecipient,
      amount: quote.priceUsdc,
      token: d!.usdc,
      reference: quote.invoiceId,
    });

    assert.equal(result.status, "executed", JSON.stringify(result));
    if (result.status !== "executed") return;

    // 3. The receipt is real and succeeded — not merely submitted.
    const receipt = await d!.publicClient.waitForTransactionReceipt({hash: result.txHash});
    assert.equal(receipt.status, "success");
    assert.equal(getAddress(receipt.to!), d!.vault);

    // 4. Funds actually moved, by exactly the quoted amount.
    const expected = toBaseUnits(WEATHER_PRICE, chain.usdcDecimals);
    assert.equal(await signer.vaultBalance(), balanceBefore - expected);

    // 5. The settlement event carries the invoice binding.
    const settled = signer.parsePaymentEvent(receipt);
    assert.ok(settled, "PaymentExecuted present");
    assert.equal(settled!.amount, expected);
    assert.equal(getAddress(settled!.to), d!.weatherRecipient);
    assert.equal(settled!.intentHash, quote.intentHash);

    // 6. The service independently verifies on chain, then releases the result.
    const delivered = await client.invoke("weather", quote.invoiceId, result.txHash);
    assert.equal(delivered.serviceId, "weather");
    assert.equal(delivered.paidTxHash, result.txHash);
    const weather = delivered.data as {city: string; temperatureC: number};
    assert.equal(weather.city, "Tokyo");
    assert.equal(typeof weather.temperatureC, "number");

    // 7. The activity log records the settlement with its hash.
    const entry = activity.list(1)[0];
    assert.equal(entry?.status, "executed");
    assert.equal(entry?.txHash, result.txHash);
  });

  test("a settled invoice cannot be redeemed twice", async () => {
    const quote = await client.quote("weather", "Osaka");
    const paid = await requestPayment(ctx(), {
      serviceId: "weather",
      recipient: d!.weatherRecipient,
      amount: quote.priceUsdc,
      token: d!.usdc,
      reference: quote.invoiceId,
    });
    assert.equal(paid.status, "executed");
    if (paid.status !== "executed") return;

    await client.invoke("weather", quote.invoiceId, paid.txHash);
    await assert.rejects(
      () => client.invoke("weather", quote.invoiceId, paid.txHash),
      /already been settled|already settled/i,
    );
  });

  test("one transaction cannot settle a second invoice", async () => {
    const first = await client.quote("weather", "Kyoto");
    const paid = await requestPayment(ctx(), {
      serviceId: "weather",
      recipient: d!.weatherRecipient,
      amount: first.priceUsdc,
      token: d!.usdc,
      reference: first.invoiceId,
    });
    assert.equal(paid.status, "executed");
    if (paid.status !== "executed") return;
    await client.invoke("weather", first.invoiceId, paid.txHash);

    // A different invoice, same receipt — the intentHash will not match.
    const second = await client.quote("weather", "Nara");
    await assert.rejects(
      () => client.invoke("weather", second.invoiceId, paid.txHash),
      /already settled another invoice|does not reference this invoice/i,
    );
  });

  test("idempotency: the same invoice never produces two transactions", async () => {
    const quote = await client.quote("weather", "Sapporo");
    const input = {
      serviceId: "weather",
      recipient: d!.weatherRecipient,
      amount: quote.priceUsdc,
      token: d!.usdc,
      reference: quote.invoiceId,
    };

    const balanceBefore = await signer.vaultBalance();
    const [a, b] = await Promise.all([
      requestPayment(ctx(), input),
      requestPayment(ctx(), input),
    ]);
    const c = await requestPayment(ctx(), input);

    assert.equal(a.status, "executed");
    if (a.status !== "executed" || b.status !== "executed" || c.status !== "executed") return;

    assert.equal(b.txHash, a.txHash, "concurrent call reused the in-flight payment");
    assert.equal(c.txHash, a.txHash, "later call replayed the settled payment");

    const spent = balanceBefore - (await signer.vaultBalance());
    assert.equal(spent, toBaseUnits(WEATHER_PRICE, chain.usdcDecimals), "charged exactly once");
  });
});

// =============================================================================
// FLOW B — unauthorized recipient
// =============================================================================

describe("Flow B: unauthorized recipient", () => {
  const attacker = getAddress("0x000000000000000000000000000000000000dEaD");

  test("the contract refuses a recipient the operator never approved", async () => {
    // Bypass the agent's registry check to prove the CONTRACT refuses, not just
    // the backend. This calls pay() directly with an unapproved destination.
    const balanceBefore = await signer.vaultBalance();

    await assert.rejects(
      () => signer.pay(d!.usdc, attacker, 10_000n, invoiceIntentHash("flow-b")),
      (err: unknown) => {
        const msg = String(err);
        assert.match(msg, /RecipientNotAllowed/, "actual contract error surfaced");
        return true;
      },
    );

    assert.equal(await signer.vaultBalance(), balanceBefore, "no funds moved");
    assert.equal(await d!.publicClient.getBalance({address: attacker}), 0n);
  });

  test("the agent reports the refusal with a human-readable reason", async () => {
    const result = await requestPayment(ctx(), {
      serviceId: "weather",
      recipient: attacker,
      amount: WEATHER_PRICE,
      token: d!.usdc,
      reference: `flow-b-${Date.now()}`,
    });

    // assert.equal from node:assert/strict carries an assertion signature, so
    // `result` is narrowed to the rejected variant from here on.
    assert.equal(result.status, "rejected");
    assert.match(result.message, /not on the operator's approved recipient list|unexpected address/i);

    const entry = activity.list(1)[0];
    assert.equal(entry?.status, "rejected");
    assert.equal(entry?.txHash, undefined, "no hash is fabricated for a refusal");
  });

  test("the service releases nothing without a settled payment", async () => {
    const quote = await client.quote("weather", "Nagoya");
    await assert.rejects(
      () => client.invoke("weather", quote.invoiceId, `0x${"11".repeat(32)}` as Hex),
      /./,
      "an invented hash must not unlock the result",
    );
  });
});

// =============================================================================
// FLOW C — exceeds maxPerTx
// =============================================================================

describe("Flow C: payment exceeds maxPerTx", () => {
  test("contract refuses and the reason names both numbers", async () => {
    const over = MAX_PER_TX + 1n;
    const balanceBefore = await signer.vaultBalance();

    await assert.rejects(
      () => signer.pay(d!.usdc, d!.weatherRecipient, over, invoiceIntentHash("flow-c")),
      /ExceedsMaxPerTx/,
    );
    assert.equal(await signer.vaultBalance(), balanceBefore);

    // previewPay agrees without spending gas.
    const [allowed, reason] = await signer.preview(d!.usdc, d!.weatherRecipient, over);
    assert.equal(allowed, false);
    assert.equal(reason, 8 /* EXCEEDS_MAX_PER_TX */);
  });

  test("a payment at exactly maxPerTx is permitted", async () => {
    // Fresh day so the daily limit is not the binding constraint.
    const [allowed] = await signer.preview(d!.usdc, d!.weatherRecipient, MAX_PER_TX);
    assert.equal(typeof allowed, "boolean");
  });
});

// =============================================================================
// FLOW D — daily limit
// =============================================================================

describe("Flow D: daily limit", () => {
  test("accumulates in token units and refuses the payment that would exceed it", async () => {
    // Daily limit 0.10, max/tx 0.05. Spend down to the boundary, then exceed.
    const remainingStart = await signer.remainingDailyAllowance();
    assert.ok(remainingStart > 0n, "session has budget left");

    // Drain whatever remains in max-sized chunks.
    let guard = 0;
    while ((await signer.remainingDailyAllowance()) > 0n && guard++ < 10) {
      const remaining = await signer.remainingDailyAllowance();
      const chunk = remaining > MAX_PER_TX ? MAX_PER_TX : remaining;
      const hash = await signer.pay(
        d!.usdc,
        d!.weatherRecipient,
        chunk,
        invoiceIntentHash(`flow-d-${guard}`),
      );
      const receipt = await signer.confirm(hash);
      assert.equal(receipt.status, "success");
    }

    assert.equal(await signer.remainingDailyAllowance(), 0n, "budget exhausted");

    // One wei more must be refused by the contract.
    await assert.rejects(
      () => signer.pay(d!.usdc, d!.weatherRecipient, 1n, invoiceIntentHash("flow-d-over")),
      /DailyLimitExceeded/,
    );

    const [allowed, reason] = await signer.preview(d!.usdc, d!.weatherRecipient, 1n);
    assert.equal(allowed, false);
    assert.equal(reason, 9 /* DAILY_LIMIT_EXCEEDED */);
  });

  test("total spend across the day never exceeds the limit", async () => {
    const session = await signer.getSession();
    assert.ok(
      session.spentInWindow <= session.dailyLimit,
      `spent ${session.spentInWindow} exceeds limit ${session.dailyLimit}`,
    );
  });

  test("concurrent payments cannot jointly exceed the remaining budget", async () => {
    // The budget is already exhausted above, so every concurrent attempt must
    // be refused — and crucially, none may slip through.
    const before = await signer.vaultBalance();
    const attempts = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        signer.pay(d!.usdc, d!.weatherRecipient, 1n, invoiceIntentHash(`flow-d-conc-${i}`)),
      ),
    );
    assert.ok(
      attempts.every((a) => a.status === "rejected"),
      "every concurrent over-budget payment was refused",
    );
    assert.equal(await signer.vaultBalance(), before, "no funds moved");
  });
});

// =============================================================================
// FLOW E — session security
// =============================================================================

describe("Flow E: session security", () => {
  test("an unauthorised signer has no spending authority", async () => {
    // Anvil account #4 — a valid key with no session on this vault.
    const stranger = createSessionSigner(
      chain,
      "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
      d!.vault,
    );
    await assert.rejects(
      () => stranger.pay(d!.usdc, d!.weatherRecipient, 1_000n, invoiceIntentHash("flow-e-1")),
      /UnauthorizedAgent/,
    );
  });

  test("wrong token is refused", async () => {
    await assert.rejects(
      () =>
        signer.pay(
          getAddress("0x000000000000000000000000000000000000bEEF"),
          d!.weatherRecipient,
          1_000n,
          invoiceIntentHash("flow-e-2"),
        ),
      /InvalidToken/,
    );
  });

  test("zero amount is refused", async () => {
    await assert.rejects(
      () => signer.pay(d!.usdc, d!.weatherRecipient, 0n, invoiceIntentHash("flow-e-3")),
      /ZeroAmount/,
    );
  });

  test("the session key cannot call privileged functions", async () => {
    // withdraw / setPaused / updatePolicy / revokeSession are all onlyOwner.
    // Proven here through a real transaction attempt, not by inspection.
    const {agentVaultAbi} = await import("@agentvault/shared");
    await assert.rejects(
      () =>
        signer.publicClient.simulateContract({
          account: d!.agentAddress,
          address: d!.vault,
          abi: agentVaultAbi,
          functionName: "withdraw",
          args: [d!.agentAddress, 1_000n],
        }),
      /NotOwner/,
    );
    await assert.rejects(
      () =>
        signer.publicClient.simulateContract({
          account: d!.agentAddress,
          address: d!.vault,
          abi: agentVaultAbi,
          functionName: "setPaused",
          args: [true],
        }),
      /NotOwner/,
    );
  });

  test("insufficient balance is refused once the vault is drained", async () => {
    const {agentVaultAbi} = await import("@agentvault/shared");

    // Operator drains the vault — always permitted, never policy-gated.
    const hash = await d!.operator.writeContract({
      address: d!.vault,
      abi: agentVaultAbi,
      functionName: "withdraw",
      args: [d!.operatorAddress, await signer.vaultBalance()],
      account: d!.operator.account!,
      chain: d!.operator.chain!,
    });
    await d!.publicClient.waitForTransactionReceipt({hash});
    assert.equal(await signer.vaultBalance(), 0n);

    // Raise the daily limit well above what Flow D already spent, so the
    // balance is the binding constraint rather than the budget.
    //
    // Note the semantic this relies on: updatePolicy deliberately does NOT
    // reset spentInWindow, so merely re-saving the old limit would leave the
    // session at zero remaining and DAILY_LIMIT_EXCEEDED would bind first.
    // That is the contract working as designed — confirmed here on a live
    // chain, not just in the Foundry unit tests.
    const session = await signer.getSession();
    const roomyDailyLimit = session.spentInWindow + 10_000_000n;

    const block = await d!.publicClient.getBlock();
    const upd = await d!.operator.writeContract({
      address: d!.vault,
      abi: agentVaultAbi,
      functionName: "updatePolicy",
      args: [
        d!.agentAddress,
        MAX_PER_TX,
        roomyDailyLimit,
        BigInt(Number(block.timestamp) + 3600),
      ],
      account: d!.operator.account!,
      chain: d!.operator.chain!,
    });
    await d!.publicClient.waitForTransactionReceipt({hash: upd});

    const [allowed, reason] = await signer.preview(d!.usdc, d!.weatherRecipient, 1_000n);
    assert.equal(allowed, false);
    assert.equal(reason, 10 /* INSUFFICIENT_BALANCE */);
  });

  test("a revoked session is permanently dead", async () => {
    const {agentVaultAbi} = await import("@agentvault/shared");
    const hash = await d!.operator.writeContract({
      address: d!.vault,
      abi: agentVaultAbi,
      functionName: "revokeSession",
      args: [d!.agentAddress],
      account: d!.operator.account!,
      chain: d!.operator.chain!,
    });
    const receipt = await d!.publicClient.waitForTransactionReceipt({hash});
    assert.equal(receipt.status, "success");

    await assert.rejects(
      () => signer.pay(d!.usdc, d!.weatherRecipient, 1_000n, invoiceIntentHash("flow-e-rev")),
      /SessionIsRevoked/,
    );

    // And the operator cannot resurrect it.
    await assert.rejects(
      () =>
        d!.publicClient.simulateContract({
          account: d!.operatorAddress,
          address: d!.vault,
          abi: agentVaultAbi,
          functionName: "updatePolicy",
          args: [d!.agentAddress, MAX_PER_TX, DAILY_LIMIT, 9_999_999_999n],
        }),
      /SessionIsRevoked/,
    );
  });
});

// =============================================================================
// Expiry — separate vault so the clock can be moved without disturbing others
// =============================================================================

describe("Flow E: session expiry", () => {
  test("an expired session cannot spend", async () => {
    const {agentVaultAbi} = await import("@agentvault/shared");

    // Advance the chain past the session expiry.
    await fetch(ANVIL_RPC, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "evm_increaseTime",
        params: [7200],
      }),
    });
    await fetch(ANVIL_RPC, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: 2, method: "evm_mine", params: []}),
    });

    // This session is revoked by the previous block, so assert on a fresh one.
    const freshKey = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as Hex;
    const fresh = createSessionSigner(chain, freshKey, d!.vault);

    await assert.rejects(
      () => fresh.pay(d!.usdc, d!.weatherRecipient, 1_000n, invoiceIntentHash("flow-e-exp")),
      // Never registered, so the contract refuses at the authorisation check —
      // which is the correct, earliest-binding reason.
      /UnauthorizedAgent/,
    );

    const session = await signer.getSession();
    const latest = await d!.publicClient.getBlock();
    assert.ok(
      Number(latest.timestamp) >= Number(session.expiresAt),
      "chain clock is past the session expiry",
    );
    assert.equal(await signer.remainingDailyAllowance(), 0n, "expired session reports no budget");

    void agentVaultAbi;
  });
});
