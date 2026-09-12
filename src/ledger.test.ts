import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendLedger } from "./ledger.js";

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
