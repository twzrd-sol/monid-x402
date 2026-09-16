import { MONID_API_URL, TWZRD_GATE_PIN } from "./constants.js";
import { checkMatrix, loadMatrix } from "./drift.js";
import { DEFAULT_E2E_RUN_ID } from "./e2e.js";
import { rebuildLedgerIndex } from "./ledger.js";
import { PRODUCT_CATALOG_SCHEMA, PRODUCT_SKU } from "./product.js";

export type DoctorCheck = { id: string; pass: boolean; detail: string };

export type DoctorReport = {
  ok: boolean;
  listen: string;
  health: Record<string, unknown> | null;
  ledger: ReturnType<typeof rebuildLedgerIndex>["totals"] | null;
  drift: { crawledAt: string; x402: number; drifted: number } | null;
  private_key: "unset" | "set";
  checks: DoctorCheck[];
};

export async function doctor(options: {
  healthUrl?: string;
  ledgerDir?: string;
  matrixPath?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  runId?: string;
}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const healthUrl = options.healthUrl ?? `${(env.MONID_API_BASE_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "")}/health`;
  const ledgerDir = options.ledgerDir ?? "evidence/ledger";
  const matrixPath = options.matrixPath ?? "evidence/catalog-matrix.json";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const checks: DoctorCheck[] = [];
  let health: Record<string, unknown> | null = null;
  try {
    const response = await fetchImpl(healthUrl);
    health = (await response.json()) as Record<string, unknown>;
    checks.push({
      id: "health_ok",
      pass: response.status === 200 && health.ok === true && health.prepaid_run === false,
      detail: `GET ${healthUrl} HTTP ${response.status} prepaid_run=${String(health.prepaid_run)}`
    });
    checks.push({
      id: "health_gate",
      pass: health.twzrd_gate === TWZRD_GATE_PIN && health.sku === PRODUCT_SKU,
      detail: `twzrd_gate=${String(health.twzrd_gate)} sku=${String(health.sku)}`
    });
    checks.push({
      id: "not_prepaid_host",
      pass: !healthUrl.includes(MONID_API_URL) && healthUrl.includes("/health"),
      detail: "health URL is the loopback listen, not api.monid.ai"
    });
  } catch (error) {
    checks.push({
      id: "health_ok",
      pass: false,
      detail: error instanceof Error ? error.message : "health fetch failed"
    });
  }

  let ledger: DoctorReport["ledger"] = null;
  try {
    ledger = rebuildLedgerIndex(ledgerDir).totals;
    checks.push({
      id: "ledger_honest",
      pass: true,
      detail: `settled ${ledger.paid_settled} / mislabeled ${ledger.mislabeled_paid} / usdc ${ledger.usdc_spent_sum}`
    });
    checks.push({
      id: "refuse_exists",
      pass: ledger.refuse >= 1,
      detail: `${ledger.refuse} refuse packets on disk`
    });
  } catch (error) {
    checks.push({
      id: "ledger_honest",
      pass: false,
      detail: error instanceof Error ? error.message : "ledger failed"
    });
  }

  let drift: DoctorReport["drift"] = null;
  try {
    const report = checkMatrix(loadMatrix(matrixPath));
    drift = { crawledAt: report.crawledAt, x402: report.x402, drifted: report.drifted };
    checks.push({
      id: "catalog_pin",
      pass: report.drifted === 0,
      detail: `x402 ${report.x402} drifted ${report.drifted} (row count is not adoption)`
    });
  } catch (error) {
    checks.push({
      id: "catalog_pin",
      pass: false,
      detail: error instanceof Error ? error.message : "drift failed"
    });
  }

  const privateKey = env.PRIVATE_KEY?.startsWith("0x") ? "set" : "unset";
  checks.push({
    id: "private_key_unset",
    pass: privateKey === "unset",
    detail: `PRIVATE_KEY ${privateKey}`
  });

  const listenBase = healthUrl.replace(/\/health\/?$/, "");
  const runId = options.runId ?? env.MONID_RUN_ID ?? DEFAULT_E2E_RUN_ID;
  try {
    const catalog = await fetchImpl(`${listenBase}/v1/product`);
    const body = (await catalog.json().catch(() => ({}))) as Record<string, unknown>;
    const skus = Array.isArray(body.skus) ? body.skus : [];
    const hasSku = skus.some(
      (row) => row && typeof row === "object" && (row as { sku?: unknown }).sku === PRODUCT_SKU
    );
    checks.push({
      id: "sku_catalog",
      pass:
        catalog.status === 200 &&
        body.schema === PRODUCT_CATALOG_SCHEMA &&
        body.canPay === false &&
        hasSku,
      detail: `GET /v1/product HTTP ${catalog.status} schema=${String(body.schema)} sku=${PRODUCT_SKU}`
    });
  } catch (error) {
    checks.push({
      id: "sku_catalog",
      pass: false,
      detail: error instanceof Error ? error.message : "product catalog failed"
    });
  }
  try {
    const retrieve = await fetchImpl(`${listenBase}/v1/runs/${runId}`);
    const body = (await retrieve.json().catch(() => ({}))) as Record<string, unknown>;
    checks.push({
      id: "retrieve_siwx",
      pass:
        retrieve.status === 402 &&
        body.code === "siwx_no_pay_offer" &&
        body.signer_invocation_count === 0 &&
        body.usdc_spent === 0,
      detail: `GET /v1/runs/${runId} HTTP ${retrieve.status} code=${String(body.code)}`
    });
    const list = await fetchImpl(`${listenBase}/v1/runs`);
    checks.push({
      id: "runs_list_501",
      pass: list.status === 501,
      detail: `GET /v1/runs HTTP ${list.status} (prepaid list stays 501)`
    });
  } catch (error) {
    checks.push({
      id: "retrieve_siwx",
      pass: false,
      detail: error instanceof Error ? error.message : "retrieve failed"
    });
  }

  const listen = String(health?.listen ?? "down");
  return {
    ok: checks.every((check) => check.pass),
    listen,
    health,
    ledger,
    drift,
    private_key: privateKey,
    checks
  };
}
