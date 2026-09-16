import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MONID_X402_RUN_URL } from "./constants.js";
import { assertPayAuthorized, PayGatedError, payRun, readPaymentResponseHeader } from "./pay.js";
import { defaultPolicy } from "./policy.js";
import { scrapePayInput } from "./input.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "../evidence/live-402-context-dev.json"), "utf8")
) as { paymentRequired: unknown };

test("pay refuses to construct a client without confirmSpend", async () => {
  await assert.rejects(
    () =>
      payRun({
        // @ts-expect-error confirmSpend must be true
        confirmSpend: false
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

test("live 402 + over-cap policy returns refuse without a wallet", async () => {
  const result = await payRun({
    confirmSpend: true,
    policy: defaultPolicy({ maxAmountMicro: 1n }),
    target: {
      provider: "context.dev",
      endpoint: "/web/scrape/markdown",
      input: scrapePayInput("https://example.com")
    }
  });
  assert.equal(result.kind, "refused");
  if (result.kind !== "refused") throw new Error("expected refuse");
  assert.equal(result.receipt.signer_invocation_count, 0);
  assert.equal(result.receipt.usdc_spent, 0);
  assert.equal(result.receipt.code, "over_cap");
});

function fixture402Fetch(card: Record<string, unknown>): typeof fetch {
  return async (input) => {
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
      return new Response(JSON.stringify(card), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

test("wash unknown coverage refuses before a signer is constructed", async () => {
  const result = await payRun({
    confirmSpend: true,
    policy: defaultPolicy({ maxAmountMicro: 10_000n }),
    fetch: fixture402Fetch({ wash_flagged: false })
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

test("allow without a key does not construct a signer", async () => {
  await assert.rejects(
    () =>
      payRun({
        confirmSpend: true,
        policy: defaultPolicy({ maxAmountMicro: 10_000n }),
        fetch: fixture402Fetch({
          wash_flagged: false,
          wash_confidence: "full",
          ring_evaluated: true
        })
      }),
    (error: unknown) => error instanceof PayGatedError && /PRIVATE_KEY after policy allow/.test(error.message)
  );
});

test("the settlement header is read under both live spellings", () => {
  const bare = new Headers();
  bare.set("PAYMENT-RESPONSE", "eyJiYXJlIjp0cnVlfQ==");
  assert.equal(readPaymentResponseHeader(bare), "eyJiYXJlIjp0cnVlfQ==");

  // The legacy X- form. Headers.get is case-insensitive but NOT substring, so
  // a bare lookup returns null here — which is how a settled payment used to
  // be recorded as pay_failed after the signer had already run.
  const prefixed = new Headers();
  prefixed.set("X-PAYMENT-RESPONSE", "eyJ4Ijp0cnVlfQ==");
  assert.equal(prefixed.get("PAYMENT-RESPONSE"), null, "bare lookup cannot see the X- form");
  assert.equal(readPaymentResponseHeader(prefixed), "eyJ4Ijp0cnVlfQ==");

  // Case is irrelevant on either spelling, so lowercase variants are not a
  // separate lookup and must not be re-added as one.
  const lower = new Headers();
  lower.set("payment-response", "eyJsb3dlciI6dHJ1ZX0=");
  assert.equal(readPaymentResponseHeader(lower), "eyJsb3dlciI6dHJ1ZX0=");

  // The bare form wins when a host sends both.
  const both = new Headers();
  both.set("PAYMENT-RESPONSE", "bare-wins");
  both.append("X-PAYMENT-RESPONSE", "legacy");
  assert.equal(readPaymentResponseHeader(both), "bare-wins");

  assert.equal(readPaymentResponseHeader(new Headers()), null);
});
