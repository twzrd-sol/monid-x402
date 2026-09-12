import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DEFAULT_BASE_URL,
  DEFAULT_JOB,
  REFUSE_SCHEMA,
  assertNoSpendPath,
  buildRefuseRequest,
  resolveRunUrl,
  runWorker
} from "./worker.mjs";

const PREPAID_RUN_URL = "https://api.monid.ai/v1/run";
const WORKER_SRC = readFileSync(new URL("./worker.mjs", import.meta.url), "utf8");

function refusePacket() {
  return {
    schema: REFUSE_SCHEMA,
    rail: "monid-x402",
    resource: "http://127.0.0.1:8788/v1/run",
    provider: DEFAULT_JOB.provider,
    endpoint: DEFAULT_JOB.endpoint,
    selected: null,
    decision: "refuse",
    reason: "mock refuse",
    code: "mock",
    signer_invocation_count: 0,
    usdc_spent: 0,
    capturedAt: "2026-09-12T00:00:00.000Z"
  };
}

function mockRefuseFetch(seen) {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, init });
    return new Response(JSON.stringify(refusePacket()), {
      status: 402,
      headers: { "content-type": "application/json" }
    });
  };
}

function paymentHeaderNames(headers) {
  const bag = new Headers(headers);
  return [
    "authorization",
    "payment-signature",
    "payment-required",
    "x-payment",
    "x-payment-response",
    "x-twzrd-confirm-spend"
  ].filter((name) => bag.has(name));
}

test("worker source never names the prepaid run URL", () => {
  assert.equal(WORKER_SRC.includes(PREPAID_RUN_URL), false);
  assert.equal(WORKER_SRC.includes("PRIVATE_KEY"), false);
  assert.equal(WORKER_SRC.includes("wallet.json"), false);
});

test("default run URL is loopback 8788 /v1/run, never prepaid", () => {
  const url = resolveRunUrl({});
  assert.equal(DEFAULT_BASE_URL, "http://127.0.0.1:8788");
  assert.equal(url, "http://127.0.0.1:8788/v1/run");
  assert.notEqual(url, PREPAID_RUN_URL);
  assert.equal(url.includes("8787"), false);
});

test("env base is concatenated with /v1/run", () => {
  const url = resolveRunUrl({ MONID_API_BASE_URL: "http://127.0.0.1:39991" });
  assert.equal(url, "http://127.0.0.1:39991/v1/run");
  assert.notEqual(url, PREPAID_RUN_URL);
});

test("trailing slash on MONID_API_BASE_URL does not double /v1/run", () => {
  const url = resolveRunUrl({ MONID_API_BASE_URL: "http://127.0.0.1:8788/" });
  assert.equal(url, "http://127.0.0.1:8788/v1/run");
});

test("refuse request has default job and no payment header", () => {
  const { url, init } = buildRefuseRequest({});
  assert.equal(url, "http://127.0.0.1:8788/v1/run");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), {
    provider: "context.dev",
    endpoint: "/web/scrape/markdown",
    input: {}
  });
  assert.deepEqual(paymentHeaderNames(init.headers), []);
  assert.equal(init.headers.authorization, undefined);
});

test("worker rejects spend flags and has no wallet path", () => {
  assert.throws(() => assertNoSpendPath(["node", "fleet/worker.mjs", "--confirm-spend"]), /no spend path/);
  assert.throws(() => assertNoSpendPath(["node", "fleet/worker.mjs", "--key-file"]), /no spend path/);
  assert.throws(() => assertNoSpendPath(["node", "fleet/worker.mjs", "--wallet"]), /no spend path/);
  assert.doesNotThrow(() => assertNoSpendPath(["node", "fleet/worker.mjs"]));
});

test("mock fetch posts only to default 8788 run URL and never prepaid", async () => {
  const seen = [];
  const result = await runWorker({ fetchImpl: mockRefuseFetch(seen), env: {} });
  assert.equal(result.status, 402);
  assert.equal(result.url, "http://127.0.0.1:8788/v1/run");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://127.0.0.1:8788/v1/run");
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(JSON.parse(seen[0].init.body), DEFAULT_JOB);
  assert.deepEqual(paymentHeaderNames(seen[0].init.headers), []);
  assert.equal(result.packet.schema, REFUSE_SCHEMA);
  assert.equal(result.packet.signer_invocation_count, 0);
  assert.equal(result.packet.usdc_spent, 0);
  assert.ok(!seen.some((row) => row.url === PREPAID_RUN_URL));
  assert.ok(!seen.some((row) => String(row.url).includes("api.monid.ai")));
});

test("mock fetch honors MONID_API_BASE_URL and still never prepaid", async () => {
  const seen = [];
  const env = { MONID_API_BASE_URL: "http://127.0.0.1:39991" };
  const result = await runWorker({ fetchImpl: mockRefuseFetch(seen), env });
  assert.equal(result.url, "http://127.0.0.1:39991/v1/run");
  assert.equal(seen[0].url, "http://127.0.0.1:39991/v1/run");
  assert.notEqual(seen[0].url, PREPAID_RUN_URL);
  assert.equal(seen[0].url.includes(":8787/"), false);
  assert.deepEqual(paymentHeaderNames(seen[0].init.headers), []);
});

test("mock server on an ephemeral port is the env base, not 8787 or 8788", async () => {
  const hits = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      hits.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(JSON.stringify(refusePacket()));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  assert.notEqual(addr.port, 8787);
  assert.notEqual(addr.port, 8788);

  try {
    const env = { MONID_API_BASE_URL: `http://127.0.0.1:${addr.port}` };
    const result = await runWorker({ env });
    assert.equal(result.status, 402);
    assert.equal(result.url, `http://127.0.0.1:${addr.port}/v1/run`);
    assert.notEqual(result.url, PREPAID_RUN_URL);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].method, "POST");
    assert.equal(hits[0].url, "/v1/run");
    assert.equal(hits[0].headers.authorization, undefined);
    assert.equal(hits[0].headers["x-twzrd-confirm-spend"], undefined);
    assert.equal(hits[0].headers["payment-signature"], undefined);
    assert.deepEqual(JSON.parse(hits[0].body), DEFAULT_JOB);
    assert.equal(result.packet.schema, REFUSE_SCHEMA);
    assert.equal(result.packet.signer_invocation_count, 0);
    assert.equal(result.packet.usdc_spent, 0);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("non-402 or prepaid-looking packet fails closed", async () => {
  await assert.rejects(
    () =>
      runWorker({
        env: {},
        fetchImpl: async () =>
          new Response(JSON.stringify({ schema: "other", signer_invocation_count: 0, usdc_spent: 0 }), {
            status: 200
          })
      }),
    /expected HTTP 402/
  );
  await assert.rejects(
    () =>
      runWorker({
        env: {},
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              schema: REFUSE_SCHEMA,
              signer_invocation_count: 1,
              usdc_spent: 0
            }),
            { status: 402 }
          )
      }),
    /signer_invocation_count/
  );
  await assert.rejects(
    () => runWorker({ env: {}, argv: ["node", fileURLToPath(import.meta.url), "--confirm-spend"] }),
    /no spend path/
  );
});
