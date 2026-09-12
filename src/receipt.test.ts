import assert from "node:assert/strict";
import { test } from "node:test";
import { PaidReceiptError, paidReceipt, payFailedReceipt, refuseReceipt, spendGatedReceipt } from "./receipt.js";

const target = { provider: "context.dev", endpoint: "/web/scrape/markdown" };
const selected = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "10000",
  payTo: "0x9D3d9410Be95fa1d230734B961997427fc61D837",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
};

test("refuse packet never increments signer or spend", () => {
  const receipt = refuseReceipt(
    target,
    {
      decision: "refuse",
      selected,
      reason: "cap",
      code: "over_cap"
    },
    "https://x402.monid.ai/v1/run"
  );
  assert.equal(receipt.signer_invocation_count, 0);
  assert.equal(receipt.usdc_spent, 0);
});

test("paid packet records $0.01 and one signer invocation", () => {
  const receipt = paidReceipt(
    target,
    selected,
    "https://x402.monid.ai/v1/run",
    200,
    "eyJzdWNjZXNzIjp0cnVlfQ=="
  );
  assert.equal(receipt.schema, "twzrd.gate_eval_paid.v1");
  assert.equal(receipt.signer_invocation_count, 1);
  assert.equal(receipt.usdc_spent, 0.01);
  assert.equal(receipt.decision, "paid");
});

test("paidReceipt rejects 402 and a missing PAYMENT-RESPONSE", () => {
  assert.throws(
    () => paidReceipt(target, selected, "https://x402.monid.ai/v1/run", 402, "eyJ9"),
    PaidReceiptError
  );
  assert.throws(
    () => paidReceipt(target, selected, "https://x402.monid.ai/v1/run", 200, null),
    PaidReceiptError
  );
});

test("spend_gated uses its own schema, not refuse", () => {
  const receipt = spendGatedReceipt(target, "https://x402.monid.ai/v1/run", "no confirm");
  assert.equal(receipt.schema, "twzrd.gate_eval_spend_gated.v1");
  assert.equal(receipt.decision, "spend_gated");
  assert.equal(receipt.signer_invocation_count, 0);
});

test("HTTP 402 after construct is not a paid packet", () => {
  const receipt = payFailedReceipt(
    target,
    selected,
    "https://x402.monid.ai/v1/run",
    "upstream HTTP 402 after signer construct; no settlement proof",
    "still_402"
  );
  assert.equal(receipt.decision, "pay_failed");
  assert.equal(receipt.code, "still_402");
  assert.equal(receipt.usdc_spent, 0);
  assert.equal(receipt.signer_invocation_count, 1);
});

test("pay_failed packet records a signer ask and zero spend", () => {
  const receipt = payFailedReceipt(
    target,
    selected,
    "https://x402.monid.ai/v1/run",
    "insufficient funds",
    "insufficient_funds"
  );
  assert.equal(receipt.signer_invocation_count, 1);
  assert.equal(receipt.usdc_spent, 0);
  assert.equal(receipt.decision, "pay_failed");
});
