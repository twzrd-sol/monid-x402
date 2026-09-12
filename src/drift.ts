import { readFileSync, writeFileSync } from "node:fs";
import type { CatalogRow } from "./classify.js";
import { MONID_X402_PAY_TO, NETWORK_BASE, NETWORK_MONAD } from "./constants.js";

export const PINNED_PAY_TO = MONID_X402_PAY_TO;
export const PINNED_NETWORKS = [NETWORK_BASE, NETWORK_MONAD] as const;

export type CatalogMatrix = {
  crawledAt: string;
  x402?: number;
  rows: CatalogRow[];
};

export type DriftReport = {
  crawledAt: string;
  x402: number;
  drifted: number;
  pinnedPayTo: string;
  pinnedNetworks: string[];
  rows: CatalogRow[];
};

function norm(value: string): string {
  return value.toLowerCase();
}

export function payToPins(payTo: string | undefined, pinned: string = PINNED_PAY_TO): boolean {
  return typeof payTo === "string" && norm(payTo) === norm(pinned);
}

export function networksPin(
  networks: string[] | undefined,
  pinned: readonly string[] = PINNED_NETWORKS
): boolean {
  if (!networks) return false;
  const have = new Set(networks.map(norm));
  return pinned.every((network) => have.has(norm(network)));
}

export function rowDrifted(
  row: CatalogRow,
  pinnedPayTo: string = PINNED_PAY_TO,
  pinnedNetworks: readonly string[] = PINNED_NETWORKS
): boolean {
  if (row.class !== "x402") return false;
  return !payToPins(row.payTo, pinnedPayTo) || !networksPin(row.networks, pinnedNetworks);
}

export function checkMatrix(matrix: CatalogMatrix): DriftReport {
  const x402Rows = matrix.rows.filter((row) => row.class === "x402");
  const drifted = x402Rows.filter((row) => rowDrifted(row));
  return {
    crawledAt: matrix.crawledAt,
    x402: x402Rows.length,
    drifted: drifted.length,
    pinnedPayTo: PINNED_PAY_TO,
    pinnedNetworks: [...PINNED_NETWORKS],
    rows: drifted
  };
}

export function loadMatrix(path: string): CatalogMatrix {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") throw new Error("catalog matrix must be an object");
  const rec = raw as Record<string, unknown>;
  if (typeof rec.crawledAt !== "string") throw new Error("catalog matrix needs crawledAt");
  if (!Array.isArray(rec.rows)) throw new Error("catalog matrix needs rows");
  return {
    crawledAt: rec.crawledAt,
    x402: typeof rec.x402 === "number" ? rec.x402 : undefined,
    rows: rec.rows as CatalogRow[]
  };
}

export function writeDriftReport(path: string, report: DriftReport): void {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
