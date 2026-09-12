import { readFileSync, writeFileSync } from "node:fs";
import { classifyRun, type CatalogRow } from "./classify.js";
import type { RunTarget } from "./types.js";

export type Seed = { provider: string; endpoint: string };

export function loadSeeds(path: string): Seed[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("seeds.json must be an array");
  return raw.map((row) => {
    if (!row || typeof row !== "object") throw new Error("seed row must be an object");
    const rec = row as Record<string, unknown>;
    if (typeof rec.provider !== "string" || typeof rec.endpoint !== "string") {
      throw new Error("seed needs provider and endpoint");
    }
    return { provider: rec.provider, endpoint: rec.endpoint };
  });
}

export async function crawlSeeds(
  seeds: Seed[],
  options: { delayMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<CatalogRow[]> {
  const delayMs = options.delayMs ?? 150;
  const rows: CatalogRow[] = [];
  for (const seed of seeds) {
    const target: RunTarget = { provider: seed.provider, endpoint: seed.endpoint, input: {} };
    rows.push(await classifyRun(target, options.fetchImpl ?? globalThis.fetch));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return rows;
}

export function writeMatrix(path: string, rows: CatalogRow[]): void {
  const body = {
    schema: "monid-x402.catalog-matrix.v1",
    crawledAt: new Date().toISOString(),
    count: rows.length,
    x402: rows.filter((r) => r.class === "x402").length,
    not_found: rows.filter((r) => r.class === "not_found").length,
    other: rows.filter((r) => r.class === "other").length,
    rows
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}
