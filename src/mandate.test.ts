import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { test } from "node:test";
import {
  EDGE_GAP,
  EDGE_PAGES,
  FIVE_CENTS,
  HAPPY_ANSWER,
  HAPPY_PAGE,
  OVER_BUDGET_PAGE,
  TASK,
  contentHash,
  recordMandate,
  runEdgePath,
  runHappyPath,
  runMandate,
  runOverBudget
} from "./mandate.js";

const pages = join(dirname(fileURLToPath(import.meta.url)), "../pages");

test("sha256 matches the empty-vector digest", () => {
  assert.equal(
    contentHash(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
});

test("happy path records five cents, pays inside it, and does not buy", () => {
  const mandate = recordMandate(TASK, FIVE_CENTS);
  assert.equal(mandate.limitUsd, 0.05);
  assert.equal(mandate.buy, false);
  assert.equal(mandate.spentUsd, 0);
  const result = runMandate(mandate, [HAPPY_PAGE]);
  assert.equal(result.approvalRequired, false);
  assert.equal(result.interrupted, false);
  assert.equal(result.purchased, false);
  assert.equal(result.answer, HAPPY_ANSWER);
  assert.equal(result.answer, "Listed at $40 and in stock at 2:14 p.m.");
  assert.ok(result.spentUsd > 0 && result.spentUsd <= FIVE_CENTS);
  assert.ok(result.receipt);
  assert.equal(result.receipt.source, HAPPY_PAGE.source);
  assert.equal(result.receipt.paymentUsd, result.spentUsd);
  assert.equal(result.receipt.timestamp, "2:14 p.m.");
  assert.equal(result.receipt.contentHash, contentHash(HAPPY_PAGE.body));
  assert.equal(runHappyPath().answer, result.answer);
});

test("conflicting or stale sources stop inside the limit and do not claim stock", () => {
  const result = runEdgePath();
  assert.equal(result.approvalRequired, false);
  assert.equal(result.interrupted, false);
  assert.equal(result.purchased, false);
  assert.equal(result.answer, null);
  assert.notEqual(result.gap, HAPPY_ANSWER);
  assert.equal(result.gap, EDGE_GAP);
  assert.match(result.gap ?? "", /could not establish/i);
  assert.ok(result.spentUsd > 0 && result.spentUsd <= FIVE_CENTS);
  assert.ok(result.receipt);
  const delivered = EDGE_PAGES.map((page) => page.body).join("\n");
  assert.equal(result.receipt.contentHash, contentHash(delivered));
});

test("a price above the remaining limit does not spend and does not ask approval", () => {
  const result = runOverBudget();
  assert.equal(result.spentUsd, 0);
  assert.equal(result.approvalRequired, false);
  assert.equal(result.interrupted, false);
  assert.equal(result.purchased, false);
  assert.equal(result.answer, null);
  assert.equal(result.receipt, null);
  assert.match(result.gap ?? "", /remaining budget/);
  assert.ok(OVER_BUDGET_PAGE.openPriceUsd > FIVE_CENTS);
});

test("the page leads with the half-cent failure and keeps rail words out of the lead", () => {
  const html = readFileSync(join(pages, "mandate.html"), "utf8");
  const failure = "Your agent asks permission to spend half a cent, even though you already told it to check.";
  const promise = "Give your agent a small research budget once.";
  const failureAt = html.indexOf(failure);
  const promiseAt = html.indexOf(promise);
  assert.ok(failureAt >= 0);
  assert.ok(promiseAt > failureAt);
  const lead = html.slice(0, html.indexOf("<h2>One task</h2>"));
  for (const banned of ["agentic payments", "x402", "cryptographic receipts"]) {
    assert.equal(lead.toLowerCase().includes(banned), false);
  }
  assert.ok(html.includes(TASK));
  assert.ok(html.includes(HAPPY_ANSWER));
  assert.ok(html.includes("without interrupting"));
  assert.ok(html.includes(EDGE_GAP));
  assert.ok(html.includes("<details"));
  assert.equal(html.includes("<details open"), false);
  assert.ok(html.includes("Content hash"));
  assert.ok(html.includes("MCP tool authors"));
  assert.ok(html.includes("research-agent developers"));
  assert.ok(html.includes("browser-agent builders"));
  assert.ok(html.includes("Bring one agent task that still hands a small decision back to the user."));
  assert.ok(html.includes("We keep teaching agents to ask permission at exactly the moment they should finish."));
  assert.ok(html.includes("Asking again is not safety. It is forgotten context."));
  assert.ok(html.includes("We’re building the missing layer: bounded permission, machine payment, and evidence of what came back."));
  assert.ok(html.includes("Looking for developers with one real workflow where their agent still asks them to supervise the last step."));
  assert.ok(html.includes("second task"));
  assert.ok(html.includes("Impressions are not that signal."));
});

test("the browser script installs both beats with module and require absent", () => {
  const code = readFileSync(join(pages, "mandate.js"), "utf8");
  const window: { MandateDemo?: { happy: ReturnType<typeof runHappyPath>; edge: ReturnType<typeof runEdgePath> } } = {};
  const sandbox = {
    window,
    TextEncoder,
    Uint8Array,
    DataView,
    Math,
    Number,
    Object,
    Array,
    String
  };
  runInContext(code, createContext(sandbox));
  assert.equal(window.MandateDemo?.happy.answer, HAPPY_ANSWER);
  assert.equal(window.MandateDemo?.happy.receipt?.contentHash, runHappyPath().receipt?.contentHash);
  assert.equal(window.MandateDemo?.edge.gap, EDGE_GAP);
  assert.notEqual(window.MandateDemo?.edge.gap, HAPPY_ANSWER);
  assert.equal(window.MandateDemo?.happy.approvalRequired, false);
});
