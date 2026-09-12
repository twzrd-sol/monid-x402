import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { decidePayPath } from "./decision.js";
import { parsePaymentRequired } from "./payment-required.js";
import { defaultPolicy, evaluatePaymentRequired } from "./policy.js";

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

test("week 0 pay-path decision cannot pay without confirm, key, and a proxy wallet", () => {
  const decision = decidePayPath({
    inspectKeyPresent: false,
    confirmSpend: false,
    privateKeyPresent: false,
    proxyHasWallet: false,
    defaultCap: evaluatePaymentRequired(required, defaultPolicy({ maxAmountMicro: 1n })),
    floor: evaluatePaymentRequired(required, defaultPolicy({ maxAmountMicro: 10_000n }))
  });
  assert.equal(decision.schema, "monid-x402.pay-path.v1");
  assert.equal(decision.canPay, false);
  assert.equal(decision.inspect, "skipped_no_key");
  assert.equal(decision.defaultCap.code, "over_cap");
  assert.equal(decision.floor.decision, "allow");
  assert.equal(decision.nextGate, "confirm_spend");
  assert.match(decision.blocker, /confirm|--confirm-spend|X-TWZRD-Confirm-Spend/i);
  assert.equal(decision.signer_invocation_count, 0);
  assert.equal(decision.usdc_spent, 0);
});

test("floor allow + confirm still cannot pay when week 0 has no wallet", () => {
  const decision = decidePayPath({
    inspectKeyPresent: false,
    confirmSpend: true,
    privateKeyPresent: true,
    proxyHasWallet: false,
    defaultCap: evaluatePaymentRequired(required, defaultPolicy({ maxAmountMicro: 1n })),
    floor: evaluatePaymentRequired(required, defaultPolicy({ maxAmountMicro: 10_000n }))
  });
  assert.equal(decision.canPay, false);
  assert.equal(decision.nextGate, "proxy_wallet");
  assert.match(decision.blocker, /wallet/i);
});
