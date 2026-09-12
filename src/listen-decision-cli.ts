#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { proveListenDecision } from "./listen-decision.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

try {
  const proof = await proveListenDecision({ baseUrl: arg("--base") });
  const out = arg("--out");
  if (out) writeFileSync(out, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.ok || proof.signer_invocation_count !== 0 || proof.usdc_spent !== 0) {
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
