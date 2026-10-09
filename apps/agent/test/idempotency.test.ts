import assert from "node:assert/strict";
import {test} from "node:test";
import {PaymentIdempotencyStore} from "../src/idempotency.ts";
import type {PaymentResult} from "../src/payments.ts";

const executed = (txHash: string): PaymentResult =>
  ({
    status: "executed",
    txHash: txHash as `0x${string}`,
    explorerUrl: "",
    serviceId: "weather",
    recipient: "0x0000000000000000000000000000000000000001",
    token: "0x0000000000000000000000000000000000000002",
    amount: "0.01",
    reference: "inv_1",
    intentHash: "0x00",
    dailyRemaining: "0.09",
    activity: {} as PaymentResult extends {activity: infer A} ? A : never,
  }) as PaymentResult;

const rejected = (): PaymentResult =>
  ({
    status: "rejected",
    message: "Payment blocked.",
    detail: {},
    serviceId: "weather",
    recipient: "0x0000000000000000000000000000000000000001",
    amount: "0.01",
    reference: "inv_1",
    activity: {} as never,
  }) as PaymentResult;

test("a settled payment is replayed, never re-executed", async () => {
  const store = new PaymentIdempotencyStore();
  let calls = 0;

  const first = await store.run("inv_1", async () => {
    calls++;
    return executed("0xaaa");
  });
  const second = await store.run("inv_1", async () => {
    calls++;
    return executed("0xbbb");
  });

  assert.equal(calls, 1, "the second call never reached the chain");
  assert.equal(first, second);
  assert.equal(store.hasSettled("inv_1"), true);
});

test("concurrent calls for one invoice share a single execution", async () => {
  const store = new PaymentIdempotencyStore();
  let calls = 0;

  const work = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return executed("0xccc");
  };

  const [a, b, c] = await Promise.all([
    store.run("inv_2", work),
    store.run("inv_2", work),
    store.run("inv_2", work),
  ]);

  assert.equal(calls, 1, "only one transaction was submitted");
  assert.equal(a, b);
  assert.equal(b, c);
});

// A refusal moved no funds, so a later retry — after the operator raises a
// limit, say — is legitimate and must reach the chain.
test("a rejected payment is not cached and stays retryable", async () => {
  const store = new PaymentIdempotencyStore();
  let calls = 0;

  const first = await store.run("inv_3", async () => {
    calls++;
    return rejected();
  });
  assert.equal(first.status, "rejected");
  assert.equal(store.hasSettled("inv_3"), false);

  const second = await store.run("inv_3", async () => {
    calls++;
    return executed("0xddd");
  });

  assert.equal(calls, 2, "the retry was allowed through");
  assert.equal(second.status, "executed");
});

test("different invoices are independent", async () => {
  const store = new PaymentIdempotencyStore();
  await store.run("inv_a", async () => executed("0x1"));
  await store.run("inv_b", async () => executed("0x2"));
  assert.equal(store.settledCount, 2);
});

test("a thrown error does not poison the reference", async () => {
  const store = new PaymentIdempotencyStore();
  await assert.rejects(() =>
    store.run("inv_4", async () => {
      throw new Error("rpc exploded");
    }),
  );
  // The in-flight entry must be cleared, or the invoice would be stuck forever.
  const after = await store.run("inv_4", async () => executed("0xeee"));
  assert.equal(after.status, "executed");
});
