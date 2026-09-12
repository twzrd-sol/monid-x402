import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempDir } from "./helpers/tmpdir.js";
import { doctor } from "./doctor.js";
import { PINNED_NETWORKS, PINNED_PAY_TO } from "./drift.js";

const matrixPath = join(dirname(fileURLToPath(import.meta.url)), "../evidence/catalog-matrix.json");

test("doctor fails closed when health is down and PRIVATE_KEY is set", async () => {
  const dir = tempDir("monid-doctor-");
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
  const dir = tempDir("monid-doctor-");
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
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/health")) {
        return new Response(
          JSON.stringify({ ok: true, rail: "monid-x402", listen: "8788", prepaid_run: false }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/v1/runs/") && !url.endsWith("/v1/runs")) {
        return new Response(
          JSON.stringify({
            schema: "twzrd.gate_eval_refuse.v1",
            decision: "refuse",
            code: "siwx_no_pay_offer",
            signer_invocation_count: 0,
            usdc_spent: 0
          }),
          { status: 402 }
        );
      }
      if (url.endsWith("/v1/runs")) {
        return new Response(JSON.stringify({ code: 501, message: "do not forward prepaid run list" }), {
          status: 501
        });
      }
      return new Response("nope", { status: 500 });
    }
  });
  assert.equal(report.ok, true);
  assert.equal(report.listen, "8788");
  assert.equal(report.private_key, "unset");
  assert.equal(report.drift?.drifted, 0);
  assert.ok(report.drift?.x402);
  assert.equal(PINNED_PAY_TO.startsWith("0x"), true);
  assert.equal(PINNED_NETWORKS.length, 2);
});

test("doctor fails when listen retrieve is still the prepaid 501 list", async () => {
  const dir = tempDir("monid-doctor-");
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
    runId: "01M2BC306GSMD00DZZAPNSCSAZ",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/health")) {
        return new Response(
          JSON.stringify({ ok: true, rail: "monid-x402", listen: "8788", prepaid_run: false }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ code: 501, message: "do not forward prepaid run list" }), {
        status: 501
      });
    }
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((row) => row.id === "retrieve_siwx")?.pass, false);
});
