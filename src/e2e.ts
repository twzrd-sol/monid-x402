import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TWZRD_GATE_PIN } from "./constants.js";
import { assertNotStaleFilm, defaultListenBase } from "./listen-decision.js";
import { PRODUCT_CATALOG_SCHEMA, PRODUCT_SKU } from "./product.js";
import { assertRunId } from "./retrieve.js";

export const LISTEN_E2E_SCHEMA = "monid-x402.listen-e2e.v1" as const;
export const DEFAULT_E2E_RUN_ID = "01M2BC306GSMD00DZZAPNSCSAZ";

export type ListenE2EStep = {
  status: number;
  code?: string;
  schema?: string;
  signer_invocation_count?: number;
  usdc_spent?: number;
};

export type ListenE2EProof = {
  schema: typeof LISTEN_E2E_SCHEMA;
  listen: string;
  runId: string;
  ok: true;
  signer_invocation_count: 0;
  usdc_spent: 0;
  steps: {
    health: ListenE2EStep;
    run_refuse: ListenE2EStep;
    spend_gated: ListenE2EStep;
    confirm_still_gated: ListenE2EStep;
    retrieve: ListenE2EStep;
    list: ListenE2EStep;
    product_catalog: ListenE2EStep;
    product_confirm: ListenE2EStep;
  };
};

type JsonBody = Record<string, unknown>;

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: JsonBody }> {
  const response = await fetchImpl(url, init);
  const body = (await response.json().catch(() => ({}))) as JsonBody;
  return { status: response.status, body };
}

function step(status: number, body: JsonBody): ListenE2EStep {
  return {
    status,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
    ...(typeof body.schema === "string" ? { schema: body.schema } : {}),
    ...(typeof body.signer_invocation_count === "number"
      ? { signer_invocation_count: body.signer_invocation_count }
      : {}),
    ...(typeof body.usdc_spent === "number" ? { usdc_spent: body.usdc_spent } : {})
  };
}

function requireZero(label: string, body: JsonBody): void {
  if (body.signer_invocation_count !== 0) {
    throw new Error(`${label} expected signer_invocation_count 0`);
  }
  if (body.usdc_spent !== 0) {
    throw new Error(`${label} expected usdc_spent 0`);
  }
}

export async function proveListenE2E(options: {
  baseUrl?: string;
  runId?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<ListenE2EProof> {
  const listen = (options.baseUrl ?? defaultListenBase()).replace(/\/$/, "");
  assertNotStaleFilm(listen);
  const runId = assertRunId(options.runId ?? DEFAULT_E2E_RUN_ID);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const runBody = {
    provider: "context.dev",
    endpoint: "/web/scrape/markdown",
    input: {}
  };

  const health = await readJson(fetchImpl, `${listen}/health`);
  if (health.status !== 200 || health.body.ok !== true || health.body.prepaid_run !== false) {
    throw new Error(`e2e health failed HTTP ${health.status}`);
  }
  if (health.body.twzrd_gate !== TWZRD_GATE_PIN || health.body.sku !== PRODUCT_SKU) {
    throw new Error(
      `e2e health expected twzrd_gate=${TWZRD_GATE_PIN} sku=${PRODUCT_SKU}, got twzrd_gate=${String(health.body.twzrd_gate)} sku=${String(health.body.sku)}`
    );
  }

  const runRefuse = await readJson(fetchImpl, `${listen}/v1/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runBody)
  });
  if (runRefuse.status !== 402 || runRefuse.body.code !== "over_cap") {
    throw new Error(`e2e run refuse expected 402 over_cap, got ${runRefuse.status} ${String(runRefuse.body.code)}`);
  }
  requireZero("run_refuse", runRefuse.body);

  const spendGated = await readJson(fetchImpl, `${listen}/v1/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-TWZRD-Max-Amount-Micro": "10000" },
    body: JSON.stringify(runBody)
  });
  if (spendGated.status !== 403 || spendGated.body.code !== "spend_gated") {
    throw new Error(`e2e spend_gated expected 403, got ${spendGated.status} ${String(spendGated.body.code)}`);
  }
  requireZero("spend_gated", spendGated.body);

  const confirm = await readJson(fetchImpl, `${listen}/v1/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TWZRD-Max-Amount-Micro": "10000",
      "X-TWZRD-Confirm-Spend": "true"
    },
    body: JSON.stringify(runBody)
  });
  if (confirm.status !== 403 || confirm.body.code !== "spend_gated") {
    throw new Error(`e2e confirm expected 403 spend_gated, got ${confirm.status}`);
  }
  requireZero("confirm_still_gated", confirm.body);

  const retrieve = await readJson(fetchImpl, `${listen}/v1/runs/${runId}`);
  if (retrieve.status !== 402 || retrieve.body.code !== "siwx_no_pay_offer") {
    throw new Error(
      `e2e retrieve expected 402 siwx_no_pay_offer, got ${retrieve.status} ${String(retrieve.body.code)}`
    );
  }
  requireZero("retrieve", retrieve.body);

  const list = await readJson(fetchImpl, `${listen}/v1/runs`);
  if (list.status !== 501) {
    throw new Error(`e2e list expected 501, got ${list.status}`);
  }

  const catalog = await readJson(fetchImpl, `${listen}/v1/product`);
  const skus = Array.isArray(catalog.body.skus) ? catalog.body.skus : [];
  const hasSku = skus.some(
    (row) => row && typeof row === "object" && (row as { sku?: unknown }).sku === PRODUCT_SKU
  );
  if (
    catalog.status !== 200 ||
    catalog.body.schema !== PRODUCT_CATALOG_SCHEMA ||
    catalog.body.canPay !== false ||
    !hasSku
  ) {
    throw new Error(
      `e2e product catalog expected 200 ${PRODUCT_CATALOG_SCHEMA} sku=${PRODUCT_SKU} canPay=false, got HTTP ${catalog.status}`
    );
  }

  const productConfirm = await readJson(fetchImpl, `${listen}/v1/product/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://monid.ai" })
  });
  if (productConfirm.status !== 403 || productConfirm.body.code !== "spend_gated") {
    throw new Error(
      `e2e product confirm expected 403 spend_gated, got ${productConfirm.status} ${String(productConfirm.body.code)}`
    );
  }
  requireZero("product_confirm", productConfirm.body);

  return {
    schema: LISTEN_E2E_SCHEMA,
    listen,
    runId,
    ok: true,
    signer_invocation_count: 0,
    usdc_spent: 0,
    steps: {
      health: step(health.status, health.body),
      run_refuse: step(runRefuse.status, runRefuse.body),
      spend_gated: step(spendGated.status, spendGated.body),
      confirm_still_gated: step(confirm.status, confirm.body),
      retrieve: step(retrieve.status, retrieve.body),
      list: step(list.status, list.body),
      product_catalog: step(catalog.status, catalog.body),
      product_confirm: step(productConfirm.status, productConfirm.body)
    }
  };
}

export function writeWeek4(root: string, proof: ListenE2EProof): string {
  return writeWeekReport(root, "evidence/verify/week4.json", "twzrd.default_path_verify.week4.v1", proof);
}

export function writeWeek6(root: string, proof: ListenE2EProof): string {
  return writeWeekReport(root, "evidence/verify/week6.json", "twzrd.default_path_verify.week6.v1", proof);
}

function writeWeekReport(
  root: string,
  relative: string,
  schema: string,
  proof: ListenE2EProof
): string {
  const gradedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const report = {
    schema,
    lane: "VERIFY",
    rail: "monid-x402",
    path: "Default Path 1",
    path_statement: "every execution that can 402 does 402 and nothing signs until policy says so",
    gradedAt,
    grader: "same-session e2e; did not claim an independent lane",
    spent: false,
    payment_header_sent: false,
    proof,
    verdict: proof.ok ? "valid" : "invalid"
  };
  const out = join(root, relative);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  return out;
}
