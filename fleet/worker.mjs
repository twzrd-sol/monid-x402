#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const DEFAULT_BASE_URL = "http://127.0.0.1:8788";
export const DEFAULT_JOB = Object.freeze({
  provider: "context.dev",
  endpoint: "/web/scrape/markdown",
  input: Object.freeze({})
});
export const REFUSE_SCHEMA = "twzrd.gate_eval_refuse.v1";

const SPEND_FLAGS = ["--confirm-spend", "--key-file", "--wallet"];

export function resolveRunUrl(env = process.env) {
  const base = env.MONID_API_BASE_URL ?? DEFAULT_BASE_URL;
  return `${base}/v1/run`;
}

export function assertNoSpendPath(argv = process.argv) {
  for (const flag of SPEND_FLAGS) {
    if (argv.includes(flag)) {
      throw new Error(`fleet worker has no spend path (${flag})`);
    }
  }
}

export function buildRefuseRequest(env = process.env, argv = process.argv) {
  assertNoSpendPath(argv);
  return {
    url: resolveRunUrl(env),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        provider: DEFAULT_JOB.provider,
        endpoint: DEFAULT_JOB.endpoint,
        input: {}
      })
    }
  };
}

export function assertRefusePacket(status, packet) {
  if (status !== 402) {
    throw new Error(`expected HTTP 402 refuse, got ${status}`);
  }
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new Error("expected refuse JSON packet");
  }
  const rec = /** @type {Record<string, unknown>} */ (packet);
  if (rec.schema !== REFUSE_SCHEMA) {
    throw new Error(`expected ${REFUSE_SCHEMA}, got ${String(rec.schema)}`);
  }
  if (rec.signer_invocation_count !== 0) {
    throw new Error(`expected signer_invocation_count 0, got ${String(rec.signer_invocation_count)}`);
  }
  if (rec.usdc_spent !== 0) {
    throw new Error(`expected usdc_spent 0, got ${String(rec.usdc_spent)}`);
  }
  return rec;
}

export async function runWorker({
  fetchImpl = globalThis.fetch,
  env = process.env,
  argv = process.argv
} = {}) {
  const { url, init } = buildRefuseRequest(env, argv);
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let packet;
  try {
    packet = JSON.parse(text);
  } catch {
    throw new Error(`refuse packet was not JSON (HTTP ${response.status})`);
  }
  assertRefusePacket(response.status, packet);
  return { url, status: response.status, packet };
}

export async function main() {
  const result = await runWorker();
  console.log(JSON.stringify(result, null, 2));
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
