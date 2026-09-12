import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type LedgerPacket = Record<string, unknown> & {
  decision?: string;
  schema?: string;
  provider?: string;
  endpoint?: string;
};

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

export function isLedgerPacketName(name: string): boolean {
  return name.endsWith(".json") && name !== "INDEX.json";
}

export function listLedgerPacketNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(isLedgerPacketName).sort();
}

export function packetSettled(rec: LedgerPacket): boolean {
  return (
    rec.decision === "paid" &&
    rec.http_status === 200 &&
    rec.signer_invocation_count === 1 &&
    typeof rec.usdc_spent === "number" &&
    rec.usdc_spent > 0 &&
    typeof rec.payment_response === "string" &&
    rec.payment_response.length > 0
  );
}

export function hasRefusePacket(
  dir: string,
  target: { provider: string; endpoint: string }
): boolean {
  return listLedgerPacketNames(dir).some((name) => {
      const rec = JSON.parse(readFileSync(join(dir, name), "utf8")) as LedgerPacket;
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
      const rec = JSON.parse(readFileSync(join(dir, name), "utf8")) as LedgerPacket;
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

export function appendLedger(dir: string, packet: LedgerPacket & { decision: string }): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const path = join(dir, `${stamp}-${packet.decision}.json`);
  writeFileSync(path, `${JSON.stringify(packet, null, 2)}\n`, { flag: "wx" });
  rebuildLedgerIndex(dir);
  return path;
}
