import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LEDGER_SCHEMA = "monid-x402.ledger.v1" as const;

export type LedgerKind = "refuse" | "spend_gated" | "paid" | "pay_failed" | "quote" | "run" | "deliver";

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

export type LedgerPacket = Record<string, unknown> & {
  decision?: string;
  schema?: string;
  provider?: string;
  endpoint?: string;
};

export type LegacyLedgerPacket = { decision: string } & Record<string, unknown>;

export type LedgerIndexRow = {
  name: string;
  decision: string | null;
  schema: string | null;
  signer_invocation_count: number | null;
  usdc_spent: number | null;
  http_status: number | null;
  settled: boolean;
  provider: string | null;
  endpoint: string | null;
  capturedAt: string | null;
};

export type LedgerIndex = {
  packets: LedgerIndexRow[];
  totals: {
    refuse: number;
    paid: number;
    paid_settled: number;
    mislabeled_paid: number;
    pay_failed: number;
    spend_gated: number;
    usdc_spent_sum: number;
    signer_invocations_sum: number;
  };
};

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function isLedgerAppend(event: LedgerAppend | LegacyLedgerPacket): event is LedgerAppend {
  return "kind" in event && "httpStatus" in event && "receipt" in event;
}

export function isLedgerPacketName(name: string): boolean {
  return name.endsWith(".json") && name !== "INDEX.json";
}

export function listLedgerPacketNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(isLedgerPacketName).sort();
}

export function unwrapLedgerPacket(raw: unknown): LedgerPacket {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  if (rec.schema === LEDGER_SCHEMA && rec.receipt && typeof rec.receipt === "object") {
    const inner = rec.receipt as LedgerPacket;
    return {
      ...inner,
      http_status: inner.http_status ?? asNumber(rec.httpStatus),
      decision: inner.decision ?? asString(rec.kind) ?? undefined
    };
  }
  return rec as LedgerPacket;
}

export function packetSettled(rec: LedgerPacket): boolean {
  const packet = unwrapLedgerPacket(rec);
  return (
    packet.decision === "paid" &&
    packet.http_status === 200 &&
    packet.signer_invocation_count === 1 &&
    typeof packet.usdc_spent === "number" &&
    packet.usdc_spent > 0 &&
    typeof packet.payment_response === "string" &&
    packet.payment_response.length > 0
  );
}

export function hasRefusePacket(
  dir: string,
  target: { provider: string; endpoint: string }
): boolean {
  return listLedgerPacketNames(dir).some((name) => {
    const rec = unwrapLedgerPacket(JSON.parse(readFileSync(join(dir, name), "utf8")));
    return (
      rec.decision === "refuse" &&
      rec.provider === target.provider &&
      rec.endpoint === target.endpoint
    );
  });
}

export function requireRefuseOnDisk(
  dir: string,
  target: { provider: string; endpoint: string }
): void {
  if (!hasRefusePacket(dir, target)) {
    throw new Error(
      `no refuse packet on disk for ${target.provider}${target.endpoint}. Refuse first.`
    );
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function rebuildLedgerIndex(dir: string): LedgerIndex {
  mkdirSync(dir, { recursive: true });
  const packets: LedgerIndexRow[] = listLedgerPacketNames(dir).map((name) => {
    const rec = unwrapLedgerPacket(JSON.parse(readFileSync(join(dir, name), "utf8")));
    return {
      name,
      decision: asString(rec.decision),
      schema: asString(rec.schema),
      signer_invocation_count: asNumber(rec.signer_invocation_count),
      usdc_spent: asNumber(rec.usdc_spent),
      http_status: asNumber(rec.http_status),
      settled: packetSettled(rec),
      provider: asString(rec.provider),
      endpoint: asString(rec.endpoint),
      capturedAt: asString(rec.capturedAt)
    };
  });

  const index: LedgerIndex = {
    packets,
    totals: {
      refuse: packets.filter((row) => row.decision === "refuse").length,
      paid: packets.filter((row) => row.decision === "paid").length,
      paid_settled: packets.filter((row) => row.settled).length,
      mislabeled_paid: packets.filter((row) => row.decision === "paid" && !row.settled).length,
      pay_failed: packets.filter((row) => row.decision === "pay_failed").length,
      spend_gated: packets.filter((row) => row.decision === "spend_gated").length,
      usdc_spent_sum: packets
        .filter((row) => row.settled)
        .reduce((sum, row) => sum + (row.usdc_spent ?? 0), 0),
      signer_invocations_sum: packets.reduce(
        (sum, row) => sum + (row.signer_invocation_count ?? 0),
        0
      )
    }
  };
  writeFileSync(join(dir, "INDEX.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/**
 * Append-only refuse/pay JSON. Uses wx so a colliding name cannot overwrite.
 * LedgerAppend writes a wrapped monid-x402.ledger.v1 record.
 * A bare `{ decision }` packet keeps the on-disk receipt shape INDEX.json catalogs.
 */
export function appendLedger(dir: string, event: LedgerAppend | LegacyLedgerPacket): string {
  mkdirSync(dir, { recursive: true });
  let path: string;
  if (!isLedgerAppend(event)) {
    const iso = new Date().toISOString();
    path = join(dir, `${iso.replace(/[:.]/g, "")}-${event.decision}.json`);
    writeFileSync(path, `${JSON.stringify(event, null, 2)}\n`, { flag: "wx" });
  } else {
    const appendedAt = new Date().toISOString();
    const record: LedgerRecord = {
      schema: LEDGER_SCHEMA,
      kind: event.kind,
      httpStatus: event.httpStatus,
      receipt: event.receipt,
      appendedAt
    };
    const base = `${stamp(appendedAt)}-${event.kind}`;
    path = "";
    for (let seq = 1; seq <= 9999; seq += 1) {
      const candidate = join(dir, `${base}-${String(seq).padStart(4, "0")}.json`);
      try {
        writeFileSync(candidate, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
        path = candidate;
        break;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "";
        if (code !== "EEXIST") throw error;
      }
    }
    if (!path) throw new Error(`ledger exhausted unique names under ${dir}`);
  }
  rebuildLedgerIndex(dir);
  return path;
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
  const rec = body as { decision?: string; code?: string; schema?: string };
  if (rec.decision === "spend_gated" || rec.code === "spend_gated") return "spend_gated";
  if (rec.decision === "paid" || rec.code === "paid") return "paid";
  if (rec.schema === "twzrd.product_deliver.v1" || rec.decision === "deliver") return "deliver";
  if (rec.schema === "twzrd.product_run.v1") return "run";
  if (rec.decision === "quote") return "quote";
  if (rec.decision === "pay_failed" || rec.code === "pay_failed" || rec.code === "insufficient_funds") {
    return "pay_failed";
  }
  return "refuse";
}
