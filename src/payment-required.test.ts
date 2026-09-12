import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponse,
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

test("v2 empty accepts parses so SIWX retrieve can be refused", () => {
  const required = parsePaymentRequired({
    x402Version: 2,
    resource: { url: "http://x402.monid.ai/x402/v1/runs/01M2BC306GSMD00DZZAPNSCSAZ" },
    accepts: [],
    extensions: { "sign-in-with-x": { info: { domain: "x402.monid.ai" } } }
  });
  assert.equal(required.accepts.length, 0);
  assert.ok(required.extensions?.["sign-in-with-x"]);
});

test("decodePaymentResponse reads payer and tx; junk is null", () => {
  const header = Buffer.from(
    JSON.stringify({
      success: true,
      payer: "0x14df772BD496bBb7f49Bc3E992Ce13B2c441177F",
      transaction: "0x4a87dcf19dfc90a095ea467f7f2e155427e981183a4086efde4c75767df4517e",
      network: "eip155:8453"
    }),
    "utf8"
  ).toString("base64");
  const proof = decodePaymentResponse(header);
  assert.equal(proof?.success, true);
  assert.equal(proof?.payer?.startsWith("0x14df"), true);
  assert.equal(decodePaymentResponse("not-base64"), null);
  assert.equal(decodePaymentResponse(null), null);
});
