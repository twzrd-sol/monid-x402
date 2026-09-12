import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendLedger,
  hasRefusePacket,
  packetSettled,
  rebuildLedgerIndex,
  requireRefuseOnDisk
} from "./ledger.js";

test("packetSettled requires paid 200 plus PAYMENT-RESPONSE", () => {
  assert.equal(
    packetSettled({
      decision: "paid",
      http_status: 200,
      signer_invocation_count: 1,
      usdc_spent: 0.01,
      payment_response: "eyJ9"
    }),
    true
  );
  assert.equal(
    packetSettled({
      decision: "paid",
      http_status: 402,
      signer_invocation_count: 1,
      usdc_spent: 0.01,
      payment_response: null
    }),
    false
  );
});

test("INDEX sums only settled paid packets and keeps the mislabeled row", () => {
  const dir = mkdtempSync(join(tmpdir(), "monid-ledger-"));
  writeFileSync(
    join(dir, "a-refuse.json"),
    JSON.stringify({
      decision: "refuse",
      schema: "twzrd.gate_eval_refuse.v1",
      provider: "context.dev",
      endpoint: "/web/scrape/markdown",
      signer_invocation_count: 0,
      usdc_spent: 0
    })
  );
  writeFileSync(
    join(dir, "b-paid.json"),
    JSON.stringify({
      decision: "paid",
      schema: "twzrd.gate_eval_paid.v1",
      http_status: 402,
      signer_invocation_count: 1,
      usdc_spent: 0.01,
      payment_response: null
    })
  );
  writeFileSync(
    join(dir, "c-paid.json"),
    JSON.stringify({
      decision: "paid",
      schema: "twzrd.gate_eval_paid.v1",
      http_status: 200,
      signer_invocation_count: 1,
      usdc_spent: 0.01,
      payment_response: "eyJ9"
    })
  );
  const index = rebuildLedgerIndex(dir);
  assert.equal(index.totals.paid, 2);
  assert.equal(index.totals.paid_settled, 1);
  assert.equal(index.totals.mislabeled_paid, 1);
  assert.equal(index.totals.usdc_spent_sum, 0.01);
  assert.equal(index.totals.refuse, 1);
});

test("missing ledger dir is no refuse, not a crash", () => {
  const missing = join(tmpdir(), `monid-ledger-missing-${Date.now()}`);
  assert.equal(hasRefusePacket(missing, { provider: "x", endpoint: "/y" }), false);
  assert.throws(
    () => requireRefuseOnDisk(missing, { provider: "x", endpoint: "/y" }),
    /no refuse packet/
  );
});

test("appendLedger rebuilds INDEX and refuse-on-disk is fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "monid-ledger-"));
  const target = { provider: "context.dev", endpoint: "/web/scrape/markdown" };
  assert.equal(hasRefusePacket(dir, target), false);
  assert.throws(() => requireRefuseOnDisk(dir, target), /no refuse packet/);
  appendLedger(dir, {
    decision: "refuse",
    provider: target.provider,
    endpoint: target.endpoint
  });
  requireRefuseOnDisk(dir, target);
  assert.equal(hasRefusePacket(dir, { provider: "other", endpoint: "/nope" }), false);
});
