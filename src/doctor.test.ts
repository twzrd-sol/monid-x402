import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { doctor } from "./doctor.js";
import { PINNED_NETWORKS, PINNED_PAY_TO } from "./drift.js";

const matrixPath = join(dirname(fileURLToPath(import.meta.url)), "../evidence/catalog-matrix.json");

test("doctor fails closed when health is down and PRIVATE_KEY is set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monid-doctor-"));
  writeFileSync(
    join(dir, "a-refuse.json"),
    JSON.stringify({
      decision: "refuse",
      provider: "context.dev",
      endpoint: "/web/scrape/markdown",
      signer_invocation_count: 0,
      usdc_spent: 0
    })
  );
  const report = await doctor({
    healthUrl: "http://127.0.0.1:9/health",
    ledgerDir: dir,
    matrixPath,
    env: { PRIVATE_KEY: "0xab" },
    fetchImpl: async () => {
      throw new Error("down");
    }
  });
  assert.equal(report.ok, false);
  assert.equal(report.private_key, "set");
  assert.equal(report.checks.find((row) => row.id === "health_ok")?.pass, false);
  assert.equal(report.checks.find((row) => row.id === "private_key_unset")?.pass, false);
});

test("doctor passes a healthy listen with refuse on disk and no key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monid-doctor-"));
  writeFileSync(
    join(dir, "a-refuse.json"),
    JSON.stringify({
      decision: "refuse",
      provider: "context.dev",
      endpoint: "/web/scrape/markdown",
      signer_invocation_count: 0,
      usdc_spent: 0
    })
  );
  const report = await doctor({
    healthUrl: "http://127.0.0.1:8788/health",
    ledgerDir: dir,
    matrixPath,
    env: {},
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ ok: true, rail: "monid-x402", listen: "8788", prepaid_run: false }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  });
  assert.equal(report.ok, true);
  assert.equal(report.listen, "8788");
  assert.equal(report.private_key, "unset");
  assert.equal(report.drift?.drifted, 0);
  assert.ok(report.drift?.x402);
  assert.equal(PINNED_PAY_TO.startsWith("0x"), true);
  assert.equal(PINNED_NETWORKS.length, 2);
});
