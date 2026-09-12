import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { safePagePath } from "./front.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../pages");

test("safePagePath stays inside pages/", () => {
  const index = safePagePath(root, "/");
  assert.ok(index?.endsWith("index.html"));
  const data = safePagePath(root, "/data.json");
  assert.ok(data?.endsWith("data.json"));
  assert.equal(safePagePath(root, "/../package.json"), null);
  assert.equal(safePagePath(root, "/foo/../../package.json"), null);
});
