import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LEDGER_SCHEMA = "monid-x402.ledger.v1" as const;

export type LedgerKind = "refuse" | "spend_gated" | "paid" | "pay_failed";

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

export type LegacyLedgerPacket = { decision: string } & Record<string, unknown>;

function isLedgerAppend(event: LedgerAppend | LegacyLedgerPacket): event is LedgerAppend {
  return "kind" in event && "httpStatus" in event && "receipt" in event;
}

/**
 * Append-only refuse/pay JSON. Uses wx so a colliding name cannot overwrite.
 * LedgerAppend writes a wrapped monid-x402.ledger.v1 record.
 * A bare `{ decision }` packet keeps the on-disk receipt shape INDEX.json catalogs.
 */
export function appendLedger(dir: string, event: LedgerAppend | LegacyLedgerPacket): string {
  mkdirSync(dir, { recursive: true });
  if (!isLedgerAppend(event)) {
    const iso = new Date().toISOString();
    const path = join(dir, `${iso.replace(/[:.]/g, "")}-${event.decision}.json`);
    writeFileSync(path, `${JSON.stringify(event, null, 2)}\n`, { flag: "wx" });
    return path;
  }
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
  if (rec.decision === "pay_failed" || rec.code === "pay_failed" || rec.code === "insufficient_funds") {
    return "pay_failed";
  }
  return "refuse";
}
