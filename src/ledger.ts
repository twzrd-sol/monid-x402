import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LEDGER_SCHEMA = "monid-x402.ledger.v1" as const;

export type LedgerKind = "refuse" | "spend_gated" | "paid";

export type LedgerRecord = {
  schema: typeof LEDGER_SCHEMA;
  kind: LedgerKind;
  httpStatus: number;
  receipt: unknown;
  appendedAt: string;
};

export type LedgerAppend = {
  kind: LedgerKind;
  httpStatus: number;
  receipt: unknown;
};

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/**
 * Append-only refuse/pay JSON. Uses wx so a colliding name cannot overwrite.
 */
export function appendLedger(dir: string, event: LedgerAppend): string {
  mkdirSync(dir, { recursive: true });
  const appendedAt = new Date().toISOString();
  const record: LedgerRecord = {
    schema: LEDGER_SCHEMA,
    kind: event.kind,
    httpStatus: event.httpStatus,
    receipt: event.receipt,
    appendedAt
  };
  const base = `${stamp(appendedAt)}-${event.kind}`;
  for (let seq = 1; seq <= 9999; seq += 1) {
    const path = join(dir, `${base}-${String(seq).padStart(4, "0")}.json`);
    try {
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
      return path;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      if (code !== "EEXIST") throw error;
    }
  }
  throw new Error(`ledger exhausted unique names under ${dir}`);
}

export function tryAppendLedger(dir: string | undefined, event: LedgerAppend): string | undefined {
  if (!dir) return undefined;
  try {
    return appendLedger(dir, event);
  } catch {
    return undefined;
  }
}

export function ledgerKindFromBody(body: unknown): LedgerKind {
  if (!body || typeof body !== "object") return "refuse";
  const rec = body as { decision?: string; code?: string };
  if (rec.decision === "spend_gated" || rec.code === "spend_gated") return "spend_gated";
  if (rec.decision === "paid" || rec.code === "paid") return "paid";
  return "refuse";
}
