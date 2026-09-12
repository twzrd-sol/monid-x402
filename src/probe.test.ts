import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { probeRun402 } from "./probe.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-context-dev.json"),
    "utf8"
  )
) as { paymentRequired: unknown };

test("probe decodes PAYMENT-REQUIRED from a 402 and never sees a wallet", async () => {
  const header = Buffer.from(JSON.stringify(fixture.paymentRequired), "utf8").toString("base64");
  const fetchImpl: typeof fetch = async () =>
    new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": header }
    });
  const result = await probeRun402(undefined, fetchImpl);
  assert.equal(result.status, 402);
  assert.equal(result.paymentRequired.accepts.length, 2);
});
