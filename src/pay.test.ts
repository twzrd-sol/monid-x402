import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPayAuthorized, PayGatedError, payRun } from "./pay.js";
import { defaultPolicy } from "./policy.js";
import { scrapePayInput } from "./input.js";

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

test("allow without a key does not construct a signer", async () => {
  await assert.rejects(
    () =>
      payRun({
        confirmSpend: true,
        policy: defaultPolicy({ maxAmountMicro: 10_000n })
      }),
    (error: unknown) => error instanceof PayGatedError && /PRIVATE_KEY after policy allow/.test(error.message)
  );
});
