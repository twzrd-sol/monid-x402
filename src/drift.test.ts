import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { CatalogRow } from "./classify.js";
import {
  PINNED_NETWORKS,
  PINNED_PAY_TO,
  checkMatrix,
  loadMatrix,
  rowDrifted,
  type DriftReport
} from "./drift.js";

const evidenceDir = join(dirname(fileURLToPath(import.meta.url)), "../evidence");
const matrixPath = join(evidenceDir, "catalog-matrix.json");
const driftPath = join(evidenceDir, "catalog-drift.json");

function x402Row(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    provider: "context.dev",
    endpoint: "/web/scrape/markdown",
    status: 402,
    class: "x402",
    payTo: PINNED_PAY_TO,
    networks: [...PINNED_NETWORKS],
    ...overrides
  };
}

test("saved matrix x402 rows still pin payTo and both networks", () => {
  const matrix = loadMatrix(matrixPath);
  const report = checkMatrix(matrix);
  assert.equal(report.crawledAt, matrix.crawledAt);
  assert.equal(report.x402, matrix.rows.filter((row) => row.class === "x402").length);
  assert.equal(report.pinnedPayTo, PINNED_PAY_TO);
  assert.deepEqual(report.pinnedNetworks, [...PINNED_NETWORKS]);
  for (const row of matrix.rows) {
    if (row.class !== "x402") continue;
    assert.ok(row.payTo, `${row.provider}${row.endpoint} missing payTo`);
    assert.equal(
      row.payTo.toLowerCase(),
      PINNED_PAY_TO.toLowerCase(),
      `${row.provider}${row.endpoint} foreign payTo ${row.payTo}`
    );
    assert.ok(row.networks?.includes("eip155:8453"), `${row.provider}${row.endpoint} missing Base`);
    assert.ok(row.networks?.includes("eip155:143"), `${row.provider}${row.endpoint} missing Monad`);
  }
  assert.equal(report.drifted, 0);
  assert.deepEqual(report.rows, []);
});

test("fails a row with a foreign payTo", () => {
  const foreign = x402Row({ payTo: "0x0000000000000000000000000000000000000001" });
  assert.equal(rowDrifted(foreign), true);
  const report = checkMatrix({
    crawledAt: "2026-09-12T00:00:00.000Z",
    rows: [foreign]
  });
  assert.equal(report.x402, 1);
  assert.equal(report.drifted, 1);
  assert.deepEqual(report.rows, [foreign]);
});

test("payTo pin is case-insensitive; missing network is drift", () => {
  assert.equal(rowDrifted(x402Row({ payTo: PINNED_PAY_TO.toLowerCase() })), false);
  assert.equal(rowDrifted(x402Row({ networks: ["eip155:8453"] })), true);
  assert.equal(rowDrifted(x402Row({ class: "not_found", payTo: undefined, networks: undefined })), false);
});

test("catalog-drift.json matches an offline check of the saved matrix", () => {
  const report = checkMatrix(loadMatrix(matrixPath));
  const onDisk = JSON.parse(readFileSync(driftPath, "utf8")) as DriftReport;
  assert.deepEqual(onDisk, report);
});
