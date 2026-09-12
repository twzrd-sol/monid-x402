import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LISTEN_DECISION_SCHEMA,
  assertListenOverCapRefuse,
  defaultListenBase,
  proveListenDecision
} from "./listen-decision.js";

const live8788Body = {
  schema: "twzrd.gate_eval_refuse.v1",
  rail: "monid-x402",
  resource: "https://x402.monid.ai/v1/run",
  provider: "context.dev",
  endpoint: "/web/scrape/markdown",
  selected: {
    network: "eip155:8453",
    amount: "10000",
    payTo: "0x9D3d9410Be95fa1d230734B961997427fc61D837",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  },
  decision: "refuse",
  reason: "amount 10000 exceeds maxAmountMicro 1 on eip155:8453.",
  code: "over_cap",
  signer_invocation_count: 0,
  usdc_spent: 0,
  capturedAt: "2026-09-12T10:15:54.358Z"
};

test("default listen base is the 8788 pin unless MONID_API_BASE_URL is set", () => {
  const prior = process.env.MONID_API_BASE_URL;
  delete process.env.MONID_API_BASE_URL;
  try {
    assert.equal(defaultListenBase(), "http://127.0.0.1:8788");
    process.env.MONID_API_BASE_URL = "http://127.0.0.1:18787";
    assert.equal(defaultListenBase(), "http://127.0.0.1:18787");
  } finally {
    if (prior === undefined) delete process.env.MONID_API_BASE_URL;
    else process.env.MONID_API_BASE_URL = prior;
  }
});

test("8788 over_cap refuse packet is the listen hold", () => {
  const packet = assertListenOverCapRefuse(402, live8788Body);
  assert.equal(packet.decision, "refuse");
  assert.equal(packet.code, "over_cap");
  assert.equal(packet.signer_invocation_count, 0);
  assert.equal(packet.usdc_spent, 0);
  assert.equal(packet.rail, "monid-x402");
});

test("listen hold rejects a signer or a spend", () => {
  assert.throws(
    () => assertListenOverCapRefuse(402, { ...live8788Body, signer_invocation_count: 1 }),
    /signer/
  );
  assert.throws(() => assertListenOverCapRefuse(402, { ...live8788Body, usdc_spent: 0.01 }), /usdc/);
  assert.throws(() => assertListenOverCapRefuse(200, live8788Body), /402/);
  assert.throws(
    () => assertListenOverCapRefuse(403, { ...live8788Body, decision: "spend_gated", code: "spend_gated" }),
    /over_cap|402/
  );
});

test("listen proof refuses the stale 8787 film", async () => {
  await assert.rejects(
    () => proveListenDecision({ baseUrl: "http://127.0.0.1:8787", fetchImpl: async () => new Response("no") }),
    /8787|stale|8788/
  );
});

test("proveListenDecision POSTs /v1/run with no wallet, confirm, or payment header", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, init: init ?? {} });
    return new Response(JSON.stringify(live8788Body), {
      status: 402,
      headers: { "Content-Type": "application/json" }
    });
  };

  const proof = await proveListenDecision({
    baseUrl: "http://127.0.0.1:8788",
    fetchImpl
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://127.0.0.1:8788/v1/run");
  assert.equal(seen[0].init.method, "POST");
  const headers = new Headers(seen[0].init.headers);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("PAYMENT-REQUIRED"), null);
  assert.equal(headers.get("x-twzrd-confirm-spend"), null);
  assert.ok(!JSON.stringify(seen[0].init.headers ?? {}).includes("0x"));
  const posted = JSON.parse(String(seen[0].init.body));
  assert.equal(posted.provider, "context.dev");
  assert.equal(posted.endpoint, "/web/scrape/markdown");

  assert.equal(proof.schema, LISTEN_DECISION_SCHEMA);
  assert.equal(proof.listen, "http://127.0.0.1:8788");
  assert.equal(proof.httpStatus, 402);
  assert.equal(proof.ok, true);
  assert.equal(proof.code, "over_cap");
  assert.equal(proof.signer_invocation_count, 0);
  assert.equal(proof.usdc_spent, 0);
  assert.equal(proof.canPay, false);
  assert.equal(proof.nextGate, "over_cap");
});
