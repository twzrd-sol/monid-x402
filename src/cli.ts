#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { DEFAULT_ENDPOINT, DEFAULT_PROVIDER, MONID_X402_RUN_URL } from "./constants.js";
import { inspectEndpoint } from "./inspect.js";
import { PayGatedError, payRun } from "./pay.js";
import { amountMicro, usdcFromMicro } from "./payment-required.js";
import { defaultPolicy, evaluatePaymentRequired } from "./policy.js";
import { defaultTarget, probeRun402 } from "./probe.js";
import { refuseReceipt } from "./receipt.js";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function targetFromArgs() {
  return defaultTarget({
    provider: arg("--provider", DEFAULT_PROVIDER)!,
    endpoint: arg("--endpoint", DEFAULT_ENDPOINT)!,
    input: {}
  });
}

async function probe() {
  const target = targetFromArgs();
  if (process.env.MONID_API_KEY) {
    try {
      const inspected = await inspectEndpoint(target);
      console.error(
        `inspect ${inspected.provider}${inspected.endpoint} ${inspected.rawType} ${inspected.baseFeeUsd} ${inspected.currency}`
      );
    } catch (error) {
      console.error(`inspect skipped: ${error instanceof Error ? error.message : error}`);
    }
  }
  const result = await probeRun402(target);
  const rows = result.paymentRequired.accepts.map((accept) => ({
    network: accept.network,
    amount: accept.amount,
    usd: usdcFromMicro(amountMicro(accept)),
    payTo: accept.payTo,
    asset: accept.asset
  }));
  console.log(
    JSON.stringify(
      {
        status: result.status,
        url: result.url,
        target: result.target,
        x402Version: result.paymentRequired.x402Version,
        resource: result.paymentRequired.resource,
        accepts: rows
      },
      null,
      2
    )
  );
}

async function refuse() {
  const target = targetFromArgs();
  const maxAmountMicro = BigInt(arg("--max-amount-micro", "1")!);
  const result = await probeRun402(target);
  const verdict = evaluatePaymentRequired(result.paymentRequired, defaultPolicy({ maxAmountMicro }));
  if (verdict.decision !== "refuse") {
    throw new Error(`Expected refuse under cap ${maxAmountMicro}, got allow.`);
  }
  const receipt = refuseReceipt(target, verdict, MONID_X402_RUN_URL);
  const out = arg("--out");
  if (out) writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.signer_invocation_count !== 0 || receipt.usdc_spent !== 0) {
    process.exitCode = 2;
  }
}

async function pay() {
  if (!flag("--confirm-spend")) {
    throw new PayGatedError(
      "Pay is gated. Refuse is the default. Re-run with --confirm-spend and PRIVATE_KEY after a refuse receipt exists."
    );
  }
  const key = process.env.PRIVATE_KEY;
  if (!key?.startsWith("0x")) {
    throw new PayGatedError("PRIVATE_KEY is required for pay. Do not commit it.");
  }
  const maxAmountMicro = BigInt(arg("--max-amount-micro", "10000")!);
  const result = await payRun({
    confirmSpend: true,
    privateKey: key as `0x${string}`,
    policy: defaultPolicy({ maxAmountMicro }),
    target: targetFromArgs()
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.kind === "refused") process.exitCode = 2;
}

async function main() {
  const command = process.argv[2] ?? "probe";
  if (command === "probe") return probe();
  if (command === "refuse") return refuse();
  if (command === "pay") return pay();
  console.error("Usage: monid-x402 <probe|refuse|pay> [--provider context.dev] [--endpoint /web/scrape/markdown]");
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
