import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MONID_X402_RUN_URL } from "./constants.js";
import { assertPayAuthorized, PayGatedError, payRun } from "./pay.js";
import { defaultPolicy } from "./policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "../evidence/live-402-context-dev.json"), "utf8")
) as { paymentRequired: unknown };

test("pay refuses to construct a client without confirmSpend", async () => {
  await assert.rejects(
    () =>
      payRun({
        // @ts-expect-error confirmSpend must be true
        confirmSpend: false,
        privateKey: "0x01"
      }),
    PayGatedError
  );
});

test("assertPayAuthorized requires confirmSpend then a 0x PRIVATE_KEY", () => {
  assert.throws(() => assertPayAuthorized({ confirmSpend: false }), PayGatedError);
  assert.throws(() => assertPayAuthorized({ confirmSpend: true }), PayGatedError);
  assert.throws(
    () => assertPayAuthorized({ confirmSpend: true, privateKey: "not-a-key" }),
    PayGatedError
  );
  assert.doesNotThrow(() =>
    assertPayAuthorized({ confirmSpend: true, privateKey: `0x${"11".repeat(32)}` })
  );
});

test("live 402 + over-cap policy returns refuse and does not spend", async () => {
  const result = await payRun({
    confirmSpend: true,
    privateKey: `0x${"11".repeat(32)}`,
    policy: defaultPolicy({ maxAmountMicro: 1n })
  });
  assert.equal(result.kind, "refused");
  if (result.kind !== "refused") throw new Error("expected refuse");
  assert.equal(result.receipt.signer_invocation_count, 0);
  assert.equal(result.receipt.usdc_spent, 0);
  assert.equal(result.receipt.code, "over_cap");
});

test("wash unknown coverage refuses before a signer is constructed", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(MONID_X402_RUN_URL)) {
      return new Response("{}", {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(fixture.paymentRequired)).toString("base64")
        }
      });
    }
    if (url.includes("/v1/intel/merchant_card/")) {
      return new Response(JSON.stringify({ wash_flagged: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await payRun({
    confirmSpend: true,
    privateKey: `0x${"11".repeat(32)}`,
    policy: defaultPolicy({ maxAmountMicro: 10_000n }),
    fetch: fetchImpl
  });
  assert.equal(result.kind, "refused");
  if (result.kind !== "refused") throw new Error("expected refuse");
  assert.equal(result.receipt.schema, "twzrd.gate_eval_refuse.v1");
  assert.equal(result.receipt.code, "twzrd_wash_unknown");
  assert.equal(result.receipt.signer_invocation_count, 0);
  assert.equal(result.receipt.usdc_spent, 0);
  assert.match(result.receipt.reason, /twzrd_wash_unknown/);

  const ledger = JSON.parse(
    readFileSync(join(here, "../evidence/ledger/twzrd-wash-unknown.v1.json"), "utf8")
  ) as { code: string; signer_invocation_count: number; usdc_spent: number };
  assert.equal(ledger.code, "twzrd_wash_unknown");
  assert.equal(ledger.signer_invocation_count, 0);
  assert.equal(ledger.usdc_spent, 0);
});
