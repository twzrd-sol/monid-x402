import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendLedger,
  hasRefusePacket,
  ledgerKindFromBody,
  packetSettled,
  rebuildLedgerIndex,
  requireRefuseOnDisk
} from "./ledger.js";

test("appendLedger writes a new json file and refuses overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "monid-ledger-"));
  const first = appendLedger(dir, {
    kind: "refuse",
    httpStatus: 402,
    receipt: { code: "over_cap", signer_invocation_count: 0, usdc_spent: 0 }
  });
  const second = appendLedger(dir, {
    kind: "spend_gated",
    httpStatus: 403,
    receipt: { code: "spend_gated", signer_invocation_count: 0, usdc_spent: 0 }
  });
  assert.notEqual(first, second);
  const a = JSON.parse(readFileSync(first, "utf8")) as { schema?: string; kind?: string };
  const b = JSON.parse(readFileSync(second, "utf8")) as { schema?: string; kind?: string };
  assert.equal(a.schema, "monid-x402.ledger.v1");
  assert.equal(a.kind, "refuse");
  assert.equal(b.kind, "spend_gated");

  const collision = join(dir, "fixed.json");
  writeFileSync(collision, "{}\n");
  assert.throws(() => {
    writeFileSync(collision, "overwrite\n", { flag: "wx" });
  }, /EEXIST/);
});

test("appendLedger creates the directory and never writes a paid packet in week 0 tests", () => {
  const parent = mkdtempSync(join(tmpdir(), "monid-ledger-parent-"));
  const dir = join(parent, "evidence", "ledger");
  mkdirSync(join(parent, "evidence"), { recursive: true });
  const path = appendLedger(dir, {
    kind: "refuse",
    httpStatus: 402,
    receipt: { decision: "refuse" }
  });
  const body = JSON.parse(readFileSync(path, "utf8")) as { kind?: string };
  assert.equal(body.kind, "refuse");
  assert.notEqual(body.kind, "paid");
});

test("legacy { decision } packets keep top-level decision for INDEX.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "monid-ledger-legacy-"));
  const path = appendLedger(dir, {
    decision: "refuse",
    schema: "twzrd.gate_eval_refuse.v1",
    signer_invocation_count: 0,
    usdc_spent: 0
  });
  const body = JSON.parse(readFileSync(path, "utf8")) as {
    decision?: string;
    schema?: string;
    kind?: string;
  };
  assert.equal(body.decision, "refuse");
  assert.equal(body.schema, "twzrd.gate_eval_refuse.v1");
  assert.equal(body.kind, undefined);
});

test("ledgerKindFromBody maps paid and pay_failed without collapsing to refuse", () => {
  assert.equal(ledgerKindFromBody({ decision: "paid" }), "paid");
  assert.equal(ledgerKindFromBody({ decision: "pay_failed", code: "insufficient_funds" }), "pay_failed");
  assert.equal(ledgerKindFromBody({ code: "spend_gated" }), "spend_gated");
  assert.equal(ledgerKindFromBody({ decision: "refuse", code: "over_cap" }), "refuse");
});

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
