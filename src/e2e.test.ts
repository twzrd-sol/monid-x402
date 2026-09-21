import assert from "node:assert/strict";
import { test } from "node:test";
import { proveListenE2E } from "./e2e.js";

const RUN_ID = "01M2BC306GSMD00DZZAPNSCSAZ";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("proveListenE2E walks health, refuse, spend_gated, SIWX retrieve, list 501, and SKU catalog", async () => {
  const seen: { method: string; url: string }[] = [];
  const proof = await proveListenE2E({
    baseUrl: "http://127.0.0.1:8788",
    runId: RUN_ID,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      seen.push({ method, url });
      if (url.endsWith("/health")) {
        return json(200, {
          ok: true,
          rail: "monid-x402",
          listen: "8788",
          prepaid_run: false,
          twzrd_gate: "0.9.10",
          sku: "vendor-prescreen"
        });
      }
      if (method === "POST" && url.endsWith("/v1/run")) {
        const headers = new Headers(init?.headers);
        if (headers.get("x-twzrd-confirm-spend") === "true") {
          return json(403, {
            schema: "twzrd.gate_eval_spend_gated.v1",
            decision: "spend_gated",
            code: "spend_gated",
            signer_invocation_count: 0,
            usdc_spent: 0,
            reason: "Listen has no proxy wallet. Confirm is not enough to sign."
          });
        }
        if (headers.get("x-twzrd-max-amount-micro") === "10000") {
          return json(403, {
            schema: "twzrd.gate_eval_spend_gated.v1",
            decision: "spend_gated",
            code: "spend_gated",
            signer_invocation_count: 0,
            usdc_spent: 0
          });
        }
        return json(402, {
          schema: "twzrd.gate_eval_refuse.v1",
          decision: "refuse",
          code: "over_cap",
          signer_invocation_count: 0,
          usdc_spent: 0
        });
      }
      if (method === "GET" && url.endsWith(`/v1/runs/${RUN_ID}`)) {
        return json(402, {
          schema: "twzrd.gate_eval_refuse.v1",
          decision: "refuse",
          code: "siwx_no_pay_offer",
          signer_invocation_count: 0,
          usdc_spent: 0
        });
      }
      if (method === "GET" && url.endsWith("/v1/runs")) {
        return json(501, { code: 501, message: "do not forward prepaid run list" });
      }
      if (method === "GET" && url.endsWith("/v1/product")) {
        return json(200, {
          schema: "twzrd.product_catalog.v1",
          skus: [{ sku: "vendor-prescreen" }],
          canPay: false,
          nextGate: "confirm_spend"
        });
      }
      if (method === "POST" && url.endsWith("/v1/product/confirm")) {
        return json(403, {
          schema: "twzrd.gate_eval_spend_gated.v1",
          decision: "spend_gated",
          code: "spend_gated",
          signer_invocation_count: 0,
          usdc_spent: 0
        });
      }
      return json(500, { message: `unexpected ${method} ${url}` });
    }
  });
  assert.equal(proof.ok, true);
  assert.equal(proof.schema, "monid-x402.listen-e2e.v1");
  assert.equal(proof.steps.health.status, 200);
  assert.equal(proof.steps.run_refuse.code, "over_cap");
  assert.equal(proof.steps.spend_gated.code, "spend_gated");
  assert.equal(proof.steps.confirm_still_gated.code, "spend_gated");
  assert.equal(proof.steps.retrieve.code, "siwx_no_pay_offer");
  assert.equal(proof.steps.list.status, 501);
  assert.equal(proof.steps.product_catalog.status, 200);
  assert.equal(proof.steps.product_confirm.code, "spend_gated");
  assert.equal(proof.signer_invocation_count, 0);
  assert.equal(proof.usdc_spent, 0);
  assert.ok(!seen.some((row) => row.url.includes("8787")));
  assert.ok(!seen.some((row) => row.url.includes("api.monid.ai")));
});

test("proveListenE2E fails when health omits the SKU pin", async () => {
  await assert.rejects(
    () =>
      proveListenE2E({
        baseUrl: "http://127.0.0.1:8788",
        runId: RUN_ID,
        fetchImpl: async () =>
          json(200, { ok: true, rail: "monid-x402", listen: "8788", prepaid_run: false })
      }),
    /twzrd_gate|sku/
  );
});

test("proveListenE2E refuses the stale 8787 film", async () => {
  await assert.rejects(
    () => proveListenE2E({ baseUrl: "http://127.0.0.1:8787", runId: RUN_ID, fetchImpl: async () => new Response("no") }),
    /8787|stale|8788/
  );
});
