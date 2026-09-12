import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MONID_API_URL, MONID_X402_RUN_URL } from "./constants.js";
import { handleProxyRequest, PREPAID_RUN_URL, assertNotPrepaid, startProxy } from "./proxy.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-context-dev.json"),
    "utf8"
  )
) as { paymentRequired: unknown };

function fixture402Fetch(): typeof fetch {
  const header = Buffer.from(JSON.stringify(fixture.paymentRequired), "utf8").toString("base64");
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assertNotPrepaid(url);
    assert.equal(url, MONID_X402_RUN_URL);
    return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": header } });
  };
}

test("prepaid run URL is not the x402 host", () => {
  assert.equal(PREPAID_RUN_URL, "https://api.monid.ai/v1/run");
  assert.equal(MONID_X402_RUN_URL, "https://x402.monid.ai/v1/run");
  assert.notEqual(PREPAID_RUN_URL, MONID_X402_RUN_URL);
  assert.throws(() => assertNotPrepaid(PREPAID_RUN_URL), /forbids prepaid/);
});

test("proxy /v1/run refuses live 402 under default week-0 cap and never names prepaid", async () => {
  const result = await handleProxyRequest("POST", "/v1/run", {
    provider: "context.dev",
    endpoint: "/web/scrape/markdown",
    input: {}
  });
  assert.equal(result.status, 402);
  const body = result.body as { schema?: string; rail?: string; signer_invocation_count?: number; usdc_spent?: number };
  assert.equal(body.schema, "twzrd.gate_eval_refuse.v1");
  assert.equal(body.rail, "monid-x402");
  assert.equal(body.signer_invocation_count, 0);
  assert.equal(body.usdc_spent, 0);
  assert.ok(!JSON.stringify(result.body).includes(MONID_API_URL));
});

test("allow without confirm is 403 spend_gated, not 409", async () => {
  const result = await handleProxyRequest(
    "POST",
    "/v1/run",
    { provider: "context.dev", endpoint: "/web/scrape/markdown", input: {} },
    { "X-TWZRD-Max-Amount-Micro": "10000" },
    fixture402Fetch()
  );
  assert.equal(result.status, 403);
  const body = result.body as { code?: string; decision?: string; signer_invocation_count?: number };
  assert.equal(body.code, "spend_gated");
  assert.equal(body.decision, "spend_gated");
  assert.equal(body.signer_invocation_count, 0);
  assert.ok(!JSON.stringify(result.body).includes(MONID_API_URL));
});

test("inspect without Authorization is 401", async () => {
  const result = await handleProxyRequest("POST", "/v1/inspect", {
    provider: "context.dev",
    endpoint: "/web/scrape/markdown"
  });
  assert.equal(result.status, 401);
  const body = result.body as { code?: number };
  assert.equal(body.code, 401);
});

test("discover with Authorization forwards to api.monid.ai/v1/discover, never prepaid run", async () => {
  const seen: string[] = [];
  const result = await handleProxyRequest(
    "POST",
    "/v1/discover",
    { q: "context.dev" },
    { Authorization: "Bearer test-key", "x-workspace-id": "ws_1" },
    async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-key");
      assert.equal(headers.get("x-workspace-id"), "ws_1");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  );
  assert.equal(result.status, 200);
  assert.deepEqual(seen, [`${MONID_API_URL}/discover`]);
  assert.ok(!seen.some((url) => url.includes("/v1/run")));
});

test("startProxy binds loopback; unknown route is 404", async () => {
  const { server, port } = await startProxy(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { code?: number };
    assert.equal(body.code, 404);
    assert.ok(port > 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("GET /health is 200 and does not fetch", async () => {
  let fetched = false;
  const result = await handleProxyRequest("GET", "/health", {}, {}, async () => {
    fetched = true;
    return new Response("nope");
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    rail: "monid-x402",
    listen: "8788",
    prepaid_run: false
  });
  assert.equal(fetched, false);
});

test("GET /v1/runs is 501 and does not fetch prepaid", async () => {
  let fetched = false;
  const result = await handleProxyRequest("GET", "/v1/runs", {}, {}, async () => {
    fetched = true;
    return new Response("nope");
  });
  assert.equal(result.status, 501);
  assert.equal(fetched, false);
});
