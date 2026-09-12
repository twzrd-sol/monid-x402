import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendLedger, ledgerKindFromBody } from "./ledger.js";

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
