import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parsePaymentRequired } from "./payment-required.js";
import {
  createBeforePaymentCreationHook,
  defaultPolicy,
  evaluatePaymentRequired
} from "./policy.js";
import { refuseReceipt } from "./receipt.js";
import { defaultTarget } from "./probe.js";

const required = parsePaymentRequired(
  (
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-context-dev.json"),
        "utf8"
      )
    ) as { paymentRequired: unknown }
  ).paymentRequired
);

test("refuses when cap is below the $0.01 floor", () => {
  const verdict = evaluatePaymentRequired(required, defaultPolicy({ maxAmountMicro: 1n }));
  assert.equal(verdict.decision, "refuse");
  if (verdict.decision !== "refuse") throw new Error("expected refuse");
  assert.equal(verdict.code, "over_cap");
  assert.equal(verdict.selected?.amount, "10000");
  const receipt = refuseReceipt(defaultTarget(), verdict, required.resource.url);
  assert.equal(receipt.schema, "twzrd.gate_eval_refuse.v1");
  assert.equal(receipt.signer_invocation_count, 0);
  assert.equal(receipt.usdc_spent, 0);
});

test("allows at the $0.01 floor on Base or Monad", () => {
  const verdict = evaluatePaymentRequired(required, defaultPolicy({ maxAmountMicro: 10_000n }));
  assert.equal(verdict.decision, "allow");
  if (verdict.decision !== "allow") throw new Error("expected allow");
  assert.ok(["eip155:8453", "eip155:143"].includes(verdict.selected.network));
});

test("refuses a foreign payTo", () => {
  const verdict = evaluatePaymentRequired(required, defaultPolicy({
    maxAmountMicro: 10_000n,
    payTo: "0x0000000000000000000000000000000000000001"
  }));
  assert.equal(verdict.decision, "refuse");
  if (verdict.decision !== "refuse") throw new Error("expected refuse");
  assert.equal(verdict.code, "no_acceptable_offer");
});

test("empty accepts with SIWX is siwx_no_pay_offer, not allow", () => {
  const siwx = parsePaymentRequired(
    (
      JSON.parse(
        readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-retrieve-siwx.json"),
          "utf8"
        )
      ) as { paymentRequired: unknown }
    ).paymentRequired
  );
  const verdict = evaluatePaymentRequired(siwx, defaultPolicy());
  assert.equal(verdict.decision, "refuse");
  if (verdict.decision !== "refuse") throw new Error("expected refuse");
  assert.equal(verdict.code, "siwx_no_pay_offer");
});

test("onBeforePaymentCreation aborts over cap without a wallet", async () => {
  const hook = createBeforePaymentCreationHook(defaultPolicy({ maxAmountMicro: 1n }));
  const result = await hook({ paymentRequired: required });
  assert.deepEqual(result, {
    abort: true,
    reason: result && "reason" in result ? result.reason : ""
  });
  assert.ok(result && "abort" in result && result.abort);
  assert.match(result.reason, /over_cap/);
});

test("hook aborts the accept about to be signed when a sibling is under the cap", async () => {
  const live = required.accepts[0];
  if (!live) throw new Error("fixture missing accept");
  const expensive = { ...live, amount: "178200" };
  const hook = createBeforePaymentCreationHook(defaultPolicy());
  const result = await hook({
    paymentRequired: { ...required, accepts: [expensive, live] },
    selectedRequirements: expensive
  });
  assert.ok(result && "abort" in result && result.abort);
  assert.match(result.reason, /over_cap/);
});

test("hook aborts a foreign payTo even when a pinned sibling is cheap", async () => {
  const live = required.accepts[0];
  if (!live) throw new Error("fixture missing accept");
  const foreign = {
    ...live,
    amount: "1",
    payTo: "0x0000000000000000000000000000000000000001"
  };
  const hook = createBeforePaymentCreationHook(defaultPolicy());
  const result = await hook({
    paymentRequired: { ...required, accepts: [foreign, live] },
    selectedRequirements: foreign
  });
  assert.ok(result && "abort" in result && result.abort);
  assert.match(result.reason, /no_acceptable_offer/);
});
