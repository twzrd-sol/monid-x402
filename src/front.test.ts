import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolvePage, safePagePath, startFront } from "./front.js";

const pages = join(dirname(fileURLToPath(import.meta.url)), "../pages");

test("resolvePage refuses path escape", () => {
  assert.equal(resolvePage(pages, "/../package.json"), null);
  assert.equal(safePagePath(pages, "/foo/../../package.json"), null);
  assert.equal(resolvePage(pages, "/paid.json")?.endsWith("paid.json"), true);
  assert.equal(resolvePage(pages, "/")?.endsWith("index.html"), true);
});

test("front serves canonical paid.json and not repo escape", async () => {
  const { port, close } = await startFront(0, pages);
  try {
    const paid = await fetch(`http://127.0.0.1:${port}/paid.json`);
    assert.equal(paid.status, 200);
    const body = (await paid.json()) as {
      usdc_spent?: number;
      signer_invocation_count?: number;
      transaction?: string;
    };
    assert.equal(body.usdc_spent, 0.01);
    assert.equal(body.signer_invocation_count, 1);
    assert.equal(typeof body.transaction, "string");
    const escape = await fetch(`http://127.0.0.1:${port}/../package.json`);
    assert.equal(escape.status, 404);
  } finally {
    await close();
  }
});
