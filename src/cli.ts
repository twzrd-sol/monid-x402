#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { companyBriefPlan } from "./brief.js";
import { crawlSeeds, loadSeeds, writeMatrix } from "./catalog.js";
import { DEFAULT_ENDPOINT, DEFAULT_PROVIDER, MONID_X402_RUN_URL } from "./constants.js";
import { decidePayPath } from "./decision.js";
import { inspectEndpoint } from "./inspect.js";
import { appendLedger } from "./ledger.js";
import { PayGatedError, payRun } from "./pay.js";
import { amountMicro, usdcFromMicro } from "./payment-required.js";
import { defaultPolicy, evaluatePaymentRequired } from "./policy.js";
import { defaultTarget, probeRun402 } from "./probe.js";
import { pagesRoot, startFront } from "./front.js";
import { scrapePayInput } from "./input.js";
import { startProxy } from "./proxy.js";
import { refuseReceipt } from "./receipt.js";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function parseInput(): Record<string, unknown> {
  const raw = arg("--input");
  if (!raw) {
    const url = arg("--url");
    return url ? scrapePayInput(url) : {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--input must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function targetFromArgs() {
  return defaultTarget({
    provider: arg("--provider", DEFAULT_PROVIDER)!,
    endpoint: arg("--endpoint", DEFAULT_ENDPOINT)!,
    input: parseInput()
  });
}

function loadPrivateKey(): `0x${string}` {
  const envKey = process.env.PRIVATE_KEY;
  if (envKey?.startsWith("0x")) return envKey as `0x${string}`;
  const file = arg("--key-file", process.env.EVM_PRIVATE_KEY_FILE);
  if (!file) {
    throw new PayGatedError("PRIVATE_KEY or --key-file / EVM_PRIVATE_KEY_FILE is required. Do not commit it.");
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as { privateKey?: string };
  if (!raw.privateKey?.startsWith("0x")) {
    throw new PayGatedError("key file must contain a 0x privateKey field");
  }
  return raw.privateKey as `0x${string}`;
}

function writePacket(packet: { decision: string }): string {
  const out = arg("--out");
  const path = out ?? appendLedger("evidence/ledger", packet);
  if (out) writeFileSync(path, `${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync("pages/data.json", `${JSON.stringify(packet, null, 2)}\n`);
  return path;
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
  const out = writePacket(receipt);
  console.log(JSON.stringify({ out, receipt }, null, 2));
  if (receipt.signer_invocation_count !== 0 || receipt.usdc_spent !== 0) {
    process.exitCode = 2;
  }
}

async function pay() {
  if (!flag("--confirm-spend")) {
    throw new PayGatedError(
      "Pay is gated. Refuse is the default. Re-run with --confirm-spend and a key after a refuse receipt exists."
    );
  }
  const maxAmountMicro = BigInt(arg("--max-amount-micro", "10000")!);
  const result = await payRun({
    confirmSpend: true,
    privateKey: loadPrivateKey(),
    policy: defaultPolicy({ maxAmountMicro }),
    target: targetFromArgs()
  });
  const out = writePacket(result.receipt);
  console.log(JSON.stringify({ out, ...result }, null, 2));
  if (result.kind !== "paid") process.exitCode = 2;
}

async function brief() {
  const domain = arg("--domain", "canva.com")!;
  const plan = companyBriefPlan(domain);
  const maxRefuse = BigInt(arg("--refuse-cap-micro", "1")!);
  const maxPay = BigInt(arg("--max-amount-micro", "10000")!);
  const steps = [];
  for (const step of plan.steps) {
    if (!flag("--confirm-spend")) {
      const probe = await probeRun402(step.target);
      const verdict = evaluatePaymentRequired(
        probe.paymentRequired,
        defaultPolicy({ maxAmountMicro: maxRefuse })
      );
      if (verdict.decision !== "refuse") {
        throw new Error(`brief ${step.role} expected refuse under cap ${maxRefuse}`);
      }
      const receipt = refuseReceipt(step.target, verdict, MONID_X402_RUN_URL);
      writePacket(receipt);
      steps.push({ role: step.role, why: step.why, target: step.target, kind: "refused", receipt });
      continue;
    }
    const result = await payRun({
      confirmSpend: true,
      privateKey: loadPrivateKey(),
      policy: defaultPolicy({ maxAmountMicro: maxPay }),
      target: step.target
    });
    writePacket(result.receipt);
    steps.push({
      role: step.role,
      why: step.why,
      target: step.target,
      kind: result.kind,
      receipt: result.receipt,
      ...(result.kind === "paid" ? { body: result.body } : {})
    });
    if (result.kind !== "paid") process.exitCode = 2;
  }
  const spent = steps.reduce((sum, row) => {
    const receipt = row.receipt as { usdc_spent?: number };
    return sum + (typeof receipt.usdc_spent === "number" ? receipt.usdc_spent : 0);
  }, 0);
  const packet = {
    schema: "twzrd.company_brief.v1",
    rail: "monid-x402",
    opportunity: "company-brief",
    domain: plan.domain,
    confirmSpend: flag("--confirm-spend"),
    usdc_spent: spent,
    steps
  };
  writeFileSync("pages/brief.json", `${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync("evidence/live-brief.json", `${JSON.stringify(packet, null, 2)}\n`);
  console.log(JSON.stringify(packet, null, 2));
}

async function decision() {
  const target = targetFromArgs();
  const probe = await probeRun402(target);
  const verdict = decidePayPath({
    inspectKeyPresent: Boolean(process.env.MONID_API_KEY),
    confirmSpend: flag("--confirm-spend"),
    privateKeyPresent: Boolean(process.env.PRIVATE_KEY?.startsWith("0x")),
    proxyHasWallet: false,
    defaultCap: evaluatePaymentRequired(probe.paymentRequired, defaultPolicy({ maxAmountMicro: 1n })),
    floor: evaluatePaymentRequired(probe.paymentRequired, defaultPolicy())
  });
  const out = arg("--out");
  const body = {
    ...verdict,
    resource: probe.paymentRequired.resource.url,
    target: probe.target,
    selected: probe.paymentRequired.accepts[0]
      ? {
          network: probe.paymentRequired.accepts[0].network,
          amount: probe.paymentRequired.accepts[0].amount,
          payTo: probe.paymentRequired.accepts[0].payTo
        }
      : null
  };
  if (out) writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  console.log(JSON.stringify(body, null, 2));
  if (!verdict.canPay) process.exitCode = 2;
}

async function catalog() {
  const seedPath = arg("--seeds", "evidence/seeds.json")!;
  const out = arg("--out", "evidence/catalog-matrix.json")!;
  const rows = await crawlSeeds(loadSeeds(seedPath), { delayMs: 200 });
  writeMatrix(out, rows);
  console.log(
    JSON.stringify(
      {
        out,
        x402: rows.filter((r) => r.class === "x402").length,
        not_found: rows.filter((r) => r.class === "not_found").length,
        other: rows.filter((r) => r.class === "other").length,
        rows
      },
      null,
      2
    )
  );
}

async function listen() {
  const port = Number(arg("--port", process.env.PORT ?? "8788"));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid listen port: ${arg("--port", process.env.PORT ?? "8788")}`);
  }
  const { port: bound } = await startProxy(port);
  const base = `http://127.0.0.1:${bound}`;
  console.error(`monid-x402 proxy ${base}`);
  console.error(`MONID_API_BASE_URL=${base}`);
  console.error("POST /v1/run → x402 + refuse/spend_gated. Week 0 proxy has no wallet.");
}

async function front() {
  const port = Number(arg("--port", "8790"));
  const { port: bound } = await startFront(port, pagesRoot());
  console.error(`monid-x402 front http://127.0.0.1:${bound}`);
  console.error("canonical packet: GET /paid.json (not overwritten by refuse)");
}

async function main() {
  const command = process.argv[2] ?? "probe";
  if (command === "probe") return probe();
  if (command === "refuse") return refuse();
  if (command === "pay") return pay();
  if (command === "decision") return decision();
  if (command === "catalog") return catalog();
  if (command === "listen") return listen();
  if (command === "front") return front();
  if (command === "brief") return brief();
  console.error("Usage: monid-x402 <probe|refuse|catalog|decision|pay|listen|front|brief>");
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
