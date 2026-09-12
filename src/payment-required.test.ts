import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  decodePaymentRequiredHeader,
  parsePaymentRequired
} from "./payment-required.js";
import { MONID_X402_PAY_TO, NETWORK_BASE, NETWORK_MONAD } from "./constants.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-context-dev.json"),
    "utf8"
  )
) as { paymentRequired: unknown };

test("parses the captured Monid v2 Payment-Required body", () => {
  const required = parsePaymentRequired(fixture.paymentRequired);
  assert.equal(required.x402Version, 2);
  assert.equal(required.resource.url, "https://x402.monid.ai/v1/run");
  assert.equal(required.accepts.length, 2);
  assert.equal(required.accepts[0]?.network, NETWORK_BASE);
  assert.equal(required.accepts[1]?.network, NETWORK_MONAD);
  assert.equal(required.accepts[0]?.payTo, MONID_X402_PAY_TO);
  assert.equal(required.accepts[0]?.amount, "10000");
});

test("round-trips a PAYMENT-REQUIRED header", () => {
  const header = Buffer.from(JSON.stringify(fixture.paymentRequired), "utf8").toString("base64");
  const required = decodePaymentRequiredHeader(header);
  assert.equal(required.accepts[0]?.asset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
});

test("rejects a non-v2 body", () => {
  assert.throws(() => parsePaymentRequired({ x402Version: 1, resource: {}, accepts: [] }), /x402Version/);
});
