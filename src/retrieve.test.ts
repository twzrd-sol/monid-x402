import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parsePaymentRequired } from "./payment-required.js";
import { evaluatePaymentRequired, defaultPolicy, hasSiwxExtension } from "./policy.js";
import {
  assertRunId,
  parseRunsPath,
  probeRetrieve402,
  retrieveRefuse,
  retrieveUrl
} from "./retrieve.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-retrieve-siwx.json"),
    "utf8"
  )
) as { paymentRequired: unknown; url: string };

const RUN_ID = "01M2BC306GSMD00DZZAPNSCSAZ";

test("parses SIWX retrieve 402 with empty accepts", () => {
  const required = parsePaymentRequired(fixture.paymentRequired);
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts.length, 0);
  assert.equal(hasSiwxExtension(required), true);
});

test("policy refuses SIWX retrieve as siwx_no_pay_offer and never allows", () => {
  const required = parsePaymentRequired(fixture.paymentRequired);
  const verdict = evaluatePaymentRequired(required, defaultPolicy());
  assert.equal(verdict.decision, "refuse");
  if (verdict.decision !== "refuse") throw new Error("expected refuse");
  assert.equal(verdict.code, "siwx_no_pay_offer");
  assert.equal(verdict.selected, null);
});

test("assertRunId and retrieveUrl pin the x402 host, not prepaid", () => {
  assert.equal(assertRunId(RUN_ID), RUN_ID);
  assert.equal(retrieveUrl(RUN_ID), `https://x402.monid.ai/v1/runs/${RUN_ID}`);
  assert.throws(() => assertRunId("not-a-run"), /invalid run id/);
  assert.throws(() => retrieveUrl("https://api.monid.ai/v1/runs/x"), /invalid run id/);
});

test("parseRunsPath keeps the prepaid list off the retrieve door", () => {
  assert.deepEqual(parseRunsPath("/v1/runs"), { kind: "list" });
  assert.deepEqual(parseRunsPath("/v1/runs/"), { kind: "list" });
  assert.deepEqual(parseRunsPath(`/v1/runs/${RUN_ID}`), { kind: "one", runId: RUN_ID });
  assert.equal(parseRunsPath("/v1/runs/nope").kind, "bad");
  assert.equal(parseRunsPath("/v1/runs/foo/bar").kind, "bad");
});

test("probeRetrieve402 decodes a fixture 402 and refuse is signer 0", async () => {
  const header = Buffer.from(JSON.stringify(fixture.paymentRequired), "utf8").toString("base64");
  const probe = await probeRetrieve402(RUN_ID, async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, retrieveUrl(RUN_ID));
    assert.equal(url.includes("api.monid.ai"), false);
    return new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": header }
    });
  });
  assert.equal(probe.status, 402);
  assert.equal(probe.paymentRequired.accepts.length, 0);
  const receipt = retrieveRefuse(probe);
  assert.equal(receipt.decision, "refuse");
  assert.equal(receipt.code, "siwx_no_pay_offer");
  assert.equal(receipt.signer_invocation_count, 0);
  assert.equal(receipt.usdc_spent, 0);
  assert.equal(receipt.resource, retrieveUrl(RUN_ID));
});
