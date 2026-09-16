import assert from "node:assert/strict";
import { test } from "node:test";
import type { LedgerPacket } from "./ledger.js";
import { gradeLedgerPackets, gradeSiwxRetrieve } from "./verify.js";

test("gradeLedgerPackets fails closed on prepaid resource and missing refuse", () => {
  const checks = gradeLedgerPackets([
    {
      name: "prepaid.json",
      rec: {
        decision: "paid",
        resource: "https://api.monid.ai/v1/run",
        http_status: 200,
        signer_invocation_count: 1,
        usdc_spent: 0.01,
        payment_response: "eyJ9"
      }
    }
  ]);
  const byId = Object.fromEntries(checks.map((row) => [row.id, row]));
  assert.equal(byId.refuse_zero_sign_zero_spend?.pass, false);
  assert.equal(byId.no_prepaid_api_monid_resource?.pass, false);
  assert.equal(byId.paid_one_sign_positive_spend_200?.pass, true);
});

test("gradeLedgerPackets accepts refuse plus settled paid", () => {
  const checks = gradeLedgerPackets([
    {
      name: "r.json",
      rec: {
        decision: "refuse",
        resource: "https://x402.monid.ai/v1/run",
        signer_invocation_count: 0,
        usdc_spent: 0
      }
    },
    {
      name: "p.json",
      rec: {
        decision: "paid",
        resource: "https://x402.monid.ai/v1/run",
        http_status: 200,
        signer_invocation_count: 1,
        usdc_spent: 0.01,
        payment_response: "eyJ9"
      }
    }
  ]);
  assert.ok(checks.every((row) => row.pass));
});

test("gradeSiwxRetrieve fails closed if accepts are payable or a signer moved", () => {
  const fail = gradeSiwxRetrieve({
    status: 200,
    accepts: 2,
    siwx: false,
    paymentHeaderSent: true,
    refuseCode: "paid",
    signer: 1,
    usdc: 0.01
  });
  assert.ok(fail.every((row) => row.pass === false));
  const pass = gradeSiwxRetrieve({
    status: 402,
    accepts: 0,
    siwx: true,
    paymentHeaderSent: false,
    refuseCode: "siwx_no_pay_offer",
    signer: 0,
    usdc: 0
  });
  assert.ok(pass.every((row) => row.pass));
});

test("no_unsettled_packet_claims_spend fails when a 402 packet claims spend", () => {
  // Regression: 2026-09-12T034013954Z-paid.json was written by a pre-fix build
  // that labeled a 402 as paid and still recorded usdc_spent 0.01. The grader
  // excluded it from the settled count but nothing failed, so a naive sum over
  // *-paid.json reported $0.06 across 6 payments instead of $0.05 across 5.
  const unsettled402 = {
    name: "402-labeled-paid.json",
    rec: {
      decision: "paid",
      http_status: 402,
      signer_invocation_count: 1,
      usdc_spent: 0.01
    } as unknown as LedgerPacket
  };
  const checks = gradeLedgerPackets([unsettled402]);
  const check = checks.find((c) => c.id === "no_unsettled_packet_claims_spend");
  assert.ok(check, "check must be present");
  assert.equal(check!.pass, false);
  assert.match(check!.detail, /1 of those claim usdc_spent > 0/);

  // usdc_spent 0 on an unsettled packet is the correct shape and passes.
  const honestFailure = {
    name: "402-labeled-failed.json",
    rec: {
      decision: "pay_failed",
      http_status: 402,
      signer_invocation_count: 1,
      usdc_spent: 0
    } as unknown as LedgerPacket
  };
  const clean = gradeLedgerPackets([honestFailure]);
  assert.equal(clean.find((c) => c.id === "no_unsettled_packet_claims_spend")!.pass, true);
});
