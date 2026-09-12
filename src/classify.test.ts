import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { classifyRun } from "./classify.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-context-dev.json"),
    "utf8"
  )
) as { paymentRequired: unknown };

test("classify records x402 from PAYMENT-REQUIRED", async () => {
  const header = Buffer.from(JSON.stringify(fixture.paymentRequired), "utf8").toString("base64");
  const row = await classifyRun(
    { provider: "context.dev", endpoint: "/web/scrape/markdown" },
    async () =>
      new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": header } })
  );
  assert.equal(row.class, "x402");
  assert.equal(row.status, 402);
  assert.equal(row.payTo, "0x9D3d9410Be95fa1d230734B961997427fc61D837");
  assert.ok(row.payTos?.includes("0x9D3d9410Be95fa1d230734B961997427fc61D837"));
  assert.equal(row.payTos?.length, 2);
});

test("classify records 404 as not_found and never treats it as a seat", async () => {
  const row = await classifyRun(
    { provider: "pdl", endpoint: "/person/enrich" },
    async () =>
      new Response(JSON.stringify({ code: 404, message: "Endpoint not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      })
  );
  assert.equal(row.class, "not_found");
  assert.equal(row.status, 404);
});
