import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parsePaymentRequired } from "./payment-required.js";
import { retrieveRefuse, retrieveSigned, selectSiwxChain } from "./retrieve.js";
import { probeRetrieve402 } from "./retrieve.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-retrieve-siwx.json"),
    "utf8"
  )
) as { paymentRequired: unknown };

const RUN_ID = "01M2BC306GSMD00DZZAPNSCSAZ";

test("selectSiwxChain picks Base eip191 when accepts are empty", () => {
  const required = parsePaymentRequired(fixture.paymentRequired);
  const chain = selectSiwxChain(required);
  assert.equal(chain.chainId, "eip155:8453");
  assert.equal(chain.type, "eip191");
});

test("retrieveSigned refuses to construct a signer without confirmSign", async () => {
  await assert.rejects(
    () =>
      retrieveSigned({
        runId: RUN_ID,
        confirmSign: false,
        privateKey: generatePrivateKey()
      }),
    /confirm-sign|confirmSign|gated/i
  );
});

test("retrieveSigned sends SIGN-IN-WITH-X and records signer 1 with zero USDC", async () => {
  const header = Buffer.from(JSON.stringify(fixture.paymentRequired), "utf8").toString("base64");
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  let signed = false;
  const result = await retrieveSigned({
    runId: RUN_ID,
    confirmSign: true,
    privateKey: key,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get("SIGN-IN-WITH-X") || headers.get("sign-in-with-x")) {
        signed = true;
        return new Response(
          JSON.stringify({
            runId: RUN_ID,
            status: "COMPLETED",
            output: { success: true, url: "https://example.com" }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": header } });
    }
  });
  assert.equal(signed, true);
  assert.equal(result.kind, "retrieved");
  if (result.kind !== "retrieved") throw new Error("expected retrieved");
  assert.equal(result.receipt.decision, "retrieved");
  assert.equal(result.receipt.signer_invocation_count, 1);
  assert.equal(result.receipt.usdc_spent, 0);
  assert.equal(result.receipt.http_status, 200);
  assert.equal(result.receipt.address.toLowerCase(), account.address.toLowerCase());
});

test("unauthenticated retrieveRefuse still does not sign", async () => {
  const header = Buffer.from(JSON.stringify(fixture.paymentRequired), "utf8").toString("base64");
  const probe = await probeRetrieve402(RUN_ID, async () => {
    return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": header } });
  });
  const receipt = retrieveRefuse(probe);
  assert.equal(receipt.signer_invocation_count, 0);
  assert.equal(receipt.code, "siwx_no_pay_offer");
});
