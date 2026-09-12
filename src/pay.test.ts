import assert from "node:assert/strict";
import { test } from "node:test";
import { PayGatedError, payRun } from "./pay.js";
import { defaultPolicy } from "./policy.js";

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
