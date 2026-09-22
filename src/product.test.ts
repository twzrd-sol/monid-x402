import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempDir } from "./helpers/tmpdir.js";
import { MONID_X402_RUN_URL } from "./constants.js";
import { MONID_X402_PAY_TO, USDC_BASE } from "./constants.js";
import { PayGatedError } from "./pay.js";
import { paidReceipt } from "./receipt.js";
import {
  COOKIE_UNCERTAINTY_LIMITATION,
  INCUMBENT,
  PRODUCT_CATALOG_SCHEMA,
  PRODUCT_DELIVER_SCHEMA,
  PRODUCT_QUOTE_CAP_MICRO,
  PRODUCT_RUN_SCHEMA,
  PRODUCT_SKU,
  deliverVendorPrescreen,
  NOT_ATTEMPTED,
  PRESCREEN_CLASSIFIER_CALL_CEILING,
  productCatalog,
  quoteVendorPrescreen,
  resetPrescreenClassifierBudgetForTests,
  resolvePrescreenSkips,
  runVendorPrescreen,
  vendorPrescreenPlan
} from "./product.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../evidence/live-402-context-dev.json"),
    "utf8"
  )
) as { paymentRequired: { accepts: Array<Record<string, unknown>> } };

function offer(amount: string): typeof fixture.paymentRequired {
  const first = fixture.paymentRequired.accepts[0];
  if (!first) throw new Error("fixture missing accept");
  return {
    ...fixture.paymentRequired,
    accepts: [{ ...first, amount }]
  };
}

function quoteFetch(amounts: Record<string, string>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, MONID_X402_RUN_URL);
    const body = JSON.parse(String(init?.body ?? "{}")) as { endpoint?: string };
    const amount = amounts[body.endpoint ?? ""];
    if (!amount) throw new Error(`unexpected endpoint ${body.endpoint}`);
    return new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(offer(amount))).toString("base64")
      }
    });
  };
}

test("product catalog lists sellable SKUs without claiming a take-rate", () => {
  const catalog = productCatalog();
  assert.equal(catalog.schema, PRODUCT_CATALOG_SCHEMA);
  assert.equal(catalog.canPay, false);
  assert.deepEqual(
    catalog.skus.map((row) => row.sku),
    ["vendor-prescreen", "counterparty-provenance", "company-brief"]
  );
  assert.equal(catalog.skus[0]?.settlement.takeRate, 0);
  assert.equal(catalog.skus[0]?.settlement.recipient, "monid");
  // No SKU may claim a take-rate, and none may imply money has moved.
  for (const row of catalog.skus) {
    assert.equal(row.settlement.takeRate, 0, `${row.sku} claims a take-rate`);
    assert.equal(row.settlement.currency, "USDC");
  }
  // The unsold SKU must say so rather than borrowing the rail's credibility.
  const counterparty = catalog.skus.find((row) => row.sku === "counterparty-provenance");
  assert.equal(counterparty?.settlement.recipient, "unsettled");
  assert.match(counterparty?.settlement.note ?? "", /has taken no payment/);
  assert.match(counterparty?.pay ?? "", /No signer has fired/);
});

test("vendor-prescreen is the tool-audit three-call job on x402, not a catalog dump", () => {
  const plan = vendorPrescreenPlan("monid.ai");
  assert.equal(plan.targetUrl, "https://monid.ai/");
  assert.equal(plan.steps.length, 3);
  assert.deepEqual(
    plan.steps.map((step) => [step.role, step.target.provider, step.target.endpoint]),
    [
      ["public_offer", "context.dev", "/web/scrape/markdown"],
      ["security_headers", "api.strale.io", "/x402/header-security-check"],
      ["cookie_consent", "api.strale.io", "/x402/v2/cookie-scan"]
    ]
  );
  assert.deepEqual(plan.steps[0]?.target.input, { queryParams: { url: "https://monid.ai/" } });
});

test("quote sums live 402 seats and never claims pay", async () => {
  const quote = await quoteVendorPrescreen("https://monid.ai", {
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null,
    now: () => "2026-09-12T17:50:00.000Z"
  });
  assert.equal(quote.schema, "twzrd.product_quote.v1");
  assert.equal(quote.sku, PRODUCT_SKU);
  assert.equal(quote.decision, "quote");
  assert.equal(quote.canPay, false);
  assert.equal(quote.signer_invocation_count, 0);
  assert.equal(quote.usdc_spent, 0);
  assert.equal(quote.quote.totalMicro, "247600");
  assert.equal(quote.quote.totalUsd, 0.2476);
  assert.equal(quote.nextGate, "confirm_spend");
  assert.equal(quote.incumbent.monthlyPriceUsd, 149);
  assert.equal(quote.vsIncumbent.incumbentPerJobUsd, INCUMBENT.perJobUsd);
  assert.equal(quote.vsIncumbent.oursUsd, 0.2476);
  assert.match(quote.vsIncumbent.note, /not a live Vendorapp/i);
  assert.equal(quote.quotedAt, "2026-09-12T17:50:00.000Z");
});

test("quote over the SKU cap refuses without a signer", async () => {
  const quote = await quoteVendorPrescreen("https://monid.ai", {
    capMicro: 1n,
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null
  });
  assert.equal(quote.nextGate, "over_cap");
  assert.equal(quote.canPay, false);
  assert.equal(quote.signer_invocation_count, 0);
  assert.ok(PRODUCT_QUOTE_CAP_MICRO > 247_600n);
});

test("deliver from quote-only is incomplete and never claims approval", async () => {
  const quote = await quoteVendorPrescreen("https://monid.ai", {
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null
  });
  const deliver = deliverVendorPrescreen({
    quote,
    steps: quote.steps.map((step) => ({
      role: step.role,
      why: "",
      provider: step.provider,
      endpoint: step.endpoint,
      kind: "quoted"
    })),
    now: () => "2026-09-12T18:00:00.000Z"
  });
  assert.equal(deliver.schema, PRODUCT_DELIVER_SCHEMA);
  assert.equal(deliver.delivered, false);
  assert.equal(deliver.verdict, "incomplete");
  assert.equal(deliver.usdc_spent, 0);
  assert.equal(deliver.signer_invocation_count, 0);
  assert.equal(deliver.settlement.takeRate, 0);
  assert.equal(deliver.settlement.recipient, "monid");
  assert.equal(deliver.settlement.payTo, "0x9D3d9410Be95fa1d230734B961997427fc61D837");
  assert.match(deliver.limitations[0] ?? "", /not delivered/i);
});

test("deliver from three paid seats stays review_required", async () => {
  const quote = await quoteVendorPrescreen("https://monid.ai", {
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null
  });
  const accept = (amount: string) => ({
    scheme: "exact",
    network: "eip155:8453",
    amount,
    asset: USDC_BASE,
    payTo: MONID_X402_PAY_TO
  });
  const steps = [
    {
      role: "public_offer" as const,
      why: "",
      provider: "context.dev",
      endpoint: "/web/scrape/markdown",
      kind: "paid" as const,
      receipt: paidReceipt(
        { provider: "context.dev", endpoint: "/web/scrape/markdown" },
        accept("10000"),
        "https://x402.monid.ai/v1/run",
        200,
        "eyJ9",
        "2026-09-12T18:00:00.000Z"
      ),
      outputSummary: { success: true, title: "Monid", finalUrl: "https://monid.ai/" }
    },
    {
      role: "security_headers" as const,
      why: "",
      provider: "api.strale.io",
      endpoint: "/x402/header-security-check",
      kind: "paid" as const,
      receipt: paidReceipt(
        { provider: "api.strale.io", endpoint: "/x402/header-security-check" },
        accept("59400"),
        "https://x402.monid.ai/v1/run",
        200,
        "eyJ9",
        "2026-09-12T18:00:00.000Z"
      ),
      outputSummary: { score: 10, grade: "F", missing: ["strict-transport-security"] }
    },
    {
      role: "cookie_consent" as const,
      why: "",
      provider: "api.strale.io",
      endpoint: "/x402/v2/cookie-scan",
      kind: "paid" as const,
      receipt: paidReceipt(
        { provider: "api.strale.io", endpoint: "/x402/v2/cookie-scan" },
        accept("178200"),
        "https://x402.monid.ai/v1/run",
        200,
        "eyJ9",
        "2026-09-12T18:00:00.000Z"
      ),
      outputSummary: { totalCookies: 0, potential_issues: ["No cookie consent banner detected"] }
    }
  ];
  const deliver = deliverVendorPrescreen({ quote, steps, now: () => "2026-09-12T18:00:00.000Z" });
  assert.equal(deliver.delivered, true);
  assert.equal(deliver.verdict, "review_required");
  assert.notEqual(deliver.verdict, "approved");
  assert.equal(deliver.usdc_spent, 0.2476);
  assert.equal(deliver.signer_invocation_count, 3);
  assert.deepEqual(deliver.findings.missingSecurityHeaders, ["strict-transport-security"]);
  assert.ok(deliver.findings.cookiePotentialIssues.includes(COOKIE_UNCERTAINTY_LIMITATION));
  assert.equal(deliver.settlement.takeRate, 0);
});

test("quote skips cookie-scan when Jev judges it unnecessary, and never probes that endpoint", async () => {
  const quote = await quoteVendorPrescreen("https://api.example.com/v1/prices", {
    // Deliberately omits "/x402/v2/cookie-scan" - if the skip logic still
    // probed it, quoteFetch would throw "unexpected endpoint" and fail the test.
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400"
    }),
    classify: async () => ({
      model: "jev-1.13.0",
      securityHeaders: { choice: "keep", confidence: 0.9 },
      cookieConsent: { choice: "skip", confidence: 0.88 }
    })
  });
  assert.deepEqual(
    quote.steps.map((step) => step.class),
    ["x402", "x402", "not_needed"]
  );
  assert.match(quote.steps[2]?.reason ?? "", /jev-1\.13\.0/);
  assert.equal(quote.quote.totalMicro, "69400"); // 10000 + 59400, cookie-scan never priced in
  assert.equal(quote.nextGate, "confirm_spend"); // a deliberate skip is not a catalog gap
});

test("run with a Jev skip pays only the needed seats and still delivers", async () => {
  const dir = tempDir("monid-product-jev-skip-");
  for (const role of ["public_offer", "security_headers"]) {
    const step = vendorPrescreenPlan("https://api.example.com/v1/prices").steps.find(
      (s) => s.role === role
    );
    if (!step) throw new Error(`missing ${role} seat`);
    writeFileSync(
      join(dir, `${role}.json`),
      `${JSON.stringify({
        decision: "refuse",
        code: "over_cap",
        provider: step.target.provider,
        endpoint: step.target.endpoint
      })}\n`
    );
  }
  let pays = 0;
  const run = await runVendorPrescreen("https://api.example.com/v1/prices", {
    confirmSpend: true,
    requireRefuseDir: dir,
    privateKey: `0x${"11".repeat(32)}`,
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400"
    }),
    classify: async () => ({
      model: "jev-1.13.0",
      securityHeaders: { choice: "keep", confidence: 0.9 },
      cookieConsent: { choice: "skip", confidence: 0.88 }
    }),
    pay: async ({ target }) => {
      pays += 1;
      return {
        kind: "paid",
        receipt: paidReceipt(
          target,
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: target.endpoint === "/web/scrape/markdown" ? "10000" : "59400",
            asset: USDC_BASE,
            payTo: MONID_X402_PAY_TO
          },
          "https://x402.monid.ai/v1/run",
          200,
          "eyJ9"
        ),
        body: { title: "ok" }
      };
    }
  });
  assert.equal(pays, 2); // never attempts to pay the skipped cookie-scan seat
  assert.equal(run.steps[0]?.kind, "paid");
  assert.equal(run.steps[1]?.kind, "paid");
  assert.equal(run.steps[2]?.kind, "not_needed");
  assert.equal(run.deliver.delivered, false);
  assert.notEqual(run.decision, "paid");
  assert.notEqual(run.nextGate, "none");
  assert.equal(run.usdc_spent, 0.0694);
  assert.deepEqual(run.deliver.findings.cookiePotentialIssues, [NOT_ATTEMPTED]);
  assert.ok(
    run.deliver.limitations.some((line) => /NOT_ATTEMPTED \(cookie_consent\)/.test(line)),
    "must record that the skipped check was not attempted, not silently imply a clean bill of health"
  );
});

test("run with a skipped header seat is not a finished paid delivery", async () => {
  const dir = tempDir("monid-product-jev-skip-header-");
  for (const role of ["public_offer", "cookie_consent"]) {
    const step = vendorPrescreenPlan("https://shop.example/item").steps.find((s) => s.role === role);
    if (!step) throw new Error(`missing ${role} seat`);
    writeFileSync(
      join(dir, `${role}.json`),
      `${JSON.stringify({
        decision: "refuse",
        code: "over_cap",
        provider: step.target.provider,
        endpoint: step.target.endpoint
      })}\n`
    );
  }
  const run = await runVendorPrescreen("https://shop.example/item", {
    confirmSpend: true,
    requireRefuseDir: dir,
    privateKey: `0x${"22".repeat(32)}`,
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => ({
      model: "jev-1.13.0",
      securityHeaders: { choice: "skip", confidence: 0.91 },
      cookieConsent: { choice: "keep", confidence: 0.9 }
    }),
    pay: async ({ target }) => ({
      kind: "paid",
      receipt: paidReceipt(
        target,
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: target.endpoint === "/web/scrape/markdown" ? "10000" : "178200",
          asset: USDC_BASE,
          payTo: MONID_X402_PAY_TO
        },
        "https://x402.monid.ai/v1/run",
        200,
        "eyJ9"
      ),
      body: { title: "ok" }
    })
  });
  assert.equal(run.steps[1]?.kind, "not_needed");
  assert.equal(run.deliver.delivered, false);
  assert.notEqual(run.decision, "paid");
  assert.notEqual(run.nextGate, "none");
  assert.deepEqual(run.deliver.findings.missingSecurityHeaders, [NOT_ATTEMPTED]);
  assert.deepEqual(run.deliver.findings.headerPotentialIssues, [NOT_ATTEMPTED]);
});

test("classify returning null keeps all three steps (safe default, never silently skips)", async () => {
  const quote = await quoteVendorPrescreen("https://api.example.com/v1/prices", {
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null
  });
  assert.ok(quote.steps.every((step) => step.class !== "not_needed"));
  assert.deepEqual(
    quote.steps.map((step) => step.class),
    ["x402", "x402", "x402"]
  );
});

test("a skip choice below the confidence threshold keeps the step", async () => {
  const quote = await quoteVendorPrescreen("https://api.example.com/v1/prices", {
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => ({
      model: "jev-1.13.0",
      securityHeaders: { choice: "keep", confidence: 0.9 },
      cookieConsent: { choice: "skip", confidence: 0.5 } // below PRESCREEN_SKIP_CONFIDENCE_THRESHOLD
    })
  });
  assert.ok(quote.steps.every((step) => step.class !== "not_needed"));
});

test("resolvePrescreenSkips gives an accurate reason for a real keep answer, not a false 'unavailable'", async () => {
  const decision = await resolvePrescreenSkips("https://api.example.com/v1/prices", {
    classify: async () => ({
      model: "jev-1.13.0",
      securityHeaders: { choice: "keep", confidence: 0.95 },
      cookieConsent: { choice: "skip", confidence: 0.5 } // below threshold -> kept, but not "unavailable"
    })
  });
  assert.equal(decision.skipSecurityHeaders, false);
  assert.equal(decision.skipCookieConsent, false);
  assert.doesNotMatch(decision.reasonSecurityHeaders, /unavailable|inconclusive/i);
  assert.doesNotMatch(decision.reasonCookieConsent, /unavailable|inconclusive/i);
  assert.match(decision.reasonSecurityHeaders, /judged this step necessary/);
  assert.match(decision.reasonCookieConsent, /below the .* threshold/);
});

test("resolvePrescreenSkips only reports 'unavailable' when the classifier truly returns nothing usable", async () => {
  const decision = await resolvePrescreenSkips("https://api.example.com/v1/prices", {
    classify: async () => null
  });
  assert.match(decision.reasonSecurityHeaders, /unavailable|inconclusive/i);
  assert.match(decision.reasonCookieConsent, /unavailable|inconclusive/i);
});

test("quote stops billed classifier calls once the ceiling is hit", async () => {
  resetPrescreenClassifierBudgetForTests();
  const originalKey = process.env.TYPESAFE_API_KEY;
  const originalJev = process.env.JEV;
  delete process.env.JEV;
  process.env.TYPESAFE_API_KEY = "stand-in-ceiling-key";
  let billed = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.typesafe.ai/")) {
      billed += 1;
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            security_headers: { choice: "keep", confidence: 0.91 },
            cookie_consent: { choice: "keep", confidence: 0.91 }
          }
        }),
        { status: 200 }
      );
    }
    return quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    })(input, init);
  };
  try {
    for (let i = 0; i < PRESCREEN_CLASSIFIER_CALL_CEILING + 3; i += 1) {
      const quote = await quoteVendorPrescreen(`https://ceiling.example/item-${i}`, {
        fetch: fetchImpl
      });
      assert.equal(quote.steps.length, 3);
      assert.ok(quote.steps.every((step) => step.class === "x402"));
    }
    assert.equal(billed, PRESCREEN_CLASSIFIER_CALL_CEILING);
    const again = billed;
    await quoteVendorPrescreen("https://ceiling.example/one-more-distinct-url", { fetch: fetchImpl });
    assert.equal(billed, again);
  } finally {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
    if (originalJev === undefined) delete process.env.JEV;
    else process.env.JEV = originalJev;
    resetPrescreenClassifierBudgetForTests();
  }
});

test("resolvePrescreenSkips caches the real classifier's result per target URL", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          security_headers: { choice: "keep", confidence: 0.9 },
          cookie_consent: { choice: "skip", confidence: 0.9 }
        }
      }),
      { status: (calls += 1) && 200 }
    );
  const target = "https://cache-test.monid-jev-prescreen-skip.example/x";
  resetPrescreenClassifierBudgetForTests();
  const originalKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "test-key-for-cache-test";
  try {
    const first = await resolvePrescreenSkips(target, { fetch: fakeFetch });
    const second = await resolvePrescreenSkips(target, { fetch: fakeFetch });
    assert.equal(calls, 1, "second call within the TTL must reuse the cached decision, not re-bill Jev");
    assert.deepEqual(first, second);
  } finally {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  }
});

test("deliverVendorPrescreen never claims partial cookie analysis for a Jev-skipped cookie step", async () => {
  const quote = await quoteVendorPrescreen("https://api.example.com/v1/prices", {
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400"
    }),
    classify: async () => ({
      model: "jev-1.13.0",
      securityHeaders: { choice: "keep", confidence: 0.9 },
      cookieConsent: { choice: "skip", confidence: 0.88 }
    })
  });
  const accept = (amount: string) => ({
    scheme: "exact" as const,
    network: "eip155:8453",
    amount,
    asset: USDC_BASE,
    payTo: MONID_X402_PAY_TO
  });
  const steps = [
    {
      role: "public_offer" as const,
      why: "",
      provider: "context.dev",
      endpoint: "/web/scrape/markdown",
      kind: "paid" as const,
      receipt: paidReceipt(
        { provider: "context.dev", endpoint: "/web/scrape/markdown" },
        accept("10000"),
        "https://x402.monid.ai/v1/run",
        200,
        "eyJ9"
      ),
      outputSummary: { success: true }
    },
    {
      role: "security_headers" as const,
      why: "",
      provider: "api.strale.io",
      endpoint: "/x402/header-security-check",
      kind: "paid" as const,
      receipt: paidReceipt(
        { provider: "api.strale.io", endpoint: "/x402/header-security-check" },
        accept("59400"),
        "https://x402.monid.ai/v1/run",
        200,
        "eyJ9"
      ),
      outputSummary: { score: 10, grade: "F", missing: [] }
    },
    {
      role: "cookie_consent" as const,
      why: "",
      provider: "api.strale.io",
      endpoint: "/x402/v2/cookie-scan",
      kind: "not_needed" as const,
      reason: "Jev (jev-1.13.0) judged this step unnecessary for this target (confidence 0.88)."
    }
  ];
  const deliver = deliverVendorPrescreen({ quote, steps });
  assert.equal(deliver.delivered, false);
  assert.equal(deliver.verdict, "incomplete");
  assert.deepEqual(deliver.findings.cookiePotentialIssues, [NOT_ATTEMPTED]);
  assert.ok(
    !deliver.limitations.includes(COOKIE_UNCERTAINTY_LIMITATION),
    "must not claim partial HTML/cookie analysis happened when cookie_consent was never attempted"
  );
  assert.ok(deliver.limitations.some((line) => /NOT_ATTEMPTED \(cookie_consent\)/.test(line)));
});

test("run without confirm quotes and delivers incomplete without calling pay", async () => {
  let pays = 0;
  const run = await runVendorPrescreen("https://monid.ai", {
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null,
    pay: async () => {
      pays += 1;
      throw new Error("pay must not run on quote");
    }
  });
  assert.equal(run.schema, PRODUCT_RUN_SCHEMA);
  assert.equal(run.decision, "quoted");
  assert.equal(run.deliver.delivered, false);
  assert.equal(run.deliver.verdict, "incomplete");
  assert.equal(run.canPay, false);
  assert.equal(run.usdc_spent, 0);
  assert.equal(run.signer_invocation_count, 0);
  assert.equal(run.settlement.takeRate, 0);
  assert.equal(pays, 0);
});

test("run confirm without a refuse packet holds the first unpaid seat only", async () => {
  const dir = tempDir("monid-product-norefuse-");
  let pays = 0;
  const run = await runVendorPrescreen("https://monid.ai", {
    confirmSpend: true,
    requireRefuseDir: dir,
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null,
    pay: async () => {
      pays += 1;
      throw new Error("pay must not run without refuse");
    }
  });
  assert.equal(run.decision, "incomplete");
  assert.equal(run.nextGate, "refuse_required");
  assert.equal(run.steps[0]?.kind, "spend_gated");
  assert.equal(run.steps[1]?.kind, "skipped");
  assert.equal(run.deliver.delivered, false);
  assert.equal(run.usdc_spent, 0);
  assert.equal(pays, 0);
});

test("one refuse packet unlocks only that seat, not the whole SKU", async () => {
  const dir = tempDir("monid-product-one-refuse-");
  const scrape = vendorPrescreenPlan("https://monid.ai").steps[0];
  if (!scrape) throw new Error("missing scrape seat");
  writeFileSync(
    join(dir, "scrape.json"),
    `${JSON.stringify({
      decision: "refuse",
      provider: scrape.target.provider,
      endpoint: scrape.target.endpoint
    })}\n`
  );
  let pays = 0;
  const run = await runVendorPrescreen("https://monid.ai", {
    confirmSpend: true,
    requireRefuseDir: dir,
    privateKey: `0x${"11".repeat(32)}`,
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null,
    pay: async ({ target }) => {
      pays += 1;
      return {
        kind: "paid",
        receipt: paidReceipt(
          target,
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: "10000",
            asset: USDC_BASE,
            payTo: MONID_X402_PAY_TO
          },
          "https://x402.monid.ai/v1/run",
          200,
          "eyJ9"
        ),
        body: { title: "Monid", success: true }
      };
    }
  });
  assert.equal(pays, 1);
  assert.equal(run.canPay, true);
  assert.equal(run.steps[0]?.kind, "paid");
  assert.equal(run.steps[1]?.kind, "spend_gated");
  assert.equal(run.nextGate, "refuse_required");
  assert.equal(run.deliver.delivered, false);
});

test("run confirm with mocked pay delivers the buyer packet", async () => {
  const dir = tempDir("monid-product-refuse-");
  for (const step of vendorPrescreenPlan("https://monid.ai").steps) {
    writeFileSync(
      join(dir, `${step.role}.json`),
      `${JSON.stringify({
        decision: "refuse",
        code: "over_cap",
        provider: step.target.provider,
        endpoint: step.target.endpoint
      })}\n`
    );
  }
  const run = await runVendorPrescreen("https://monid.ai", {
    confirmSpend: true,
    requireRefuseDir: dir,
    privateKey: `0x${"11".repeat(32)}`,
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null,
    pay: async ({ target }) => ({
      kind: "paid",
      receipt: paidReceipt(
        target,
        {
          scheme: "exact",
          network: "eip155:8453",
          amount:
            target.endpoint === "/web/scrape/markdown"
              ? "10000"
              : target.endpoint === "/x402/header-security-check"
                ? "59400"
                : "178200",
          asset: USDC_BASE,
          payTo: MONID_X402_PAY_TO
        },
        "https://x402.monid.ai/v1/run",
        200,
        "eyJ9"
      ),
      body:
        target.endpoint === "/web/scrape/markdown"
          ? { title: "Monid", success: true }
          : target.endpoint === "/x402/header-security-check"
            ? { score: 10, grade: "F", missing: ["content-security-policy"] }
            : { potential_issues: ["No cookie consent banner detected"] }
    }),
    now: () => "2026-09-12T18:10:00.000Z"
  });
  assert.equal(run.decision, "paid");
  assert.equal(run.nextGate, "none");
  assert.equal(run.deliver.delivered, true);
  assert.equal(run.deliver.verdict, "review_required");
  assert.equal(run.usdc_spent, 0.2476);
  assert.equal(run.signer_invocation_count, 3);
  assert.equal(run.canPay, true);
});

test("run confirm stops after a missing key and skips later seats", async () => {
  let pays = 0;
  const run = await runVendorPrescreen("https://monid.ai", {
    confirmSpend: true,
    fetch: quoteFetch({
      "/web/scrape/markdown": "10000",
      "/x402/header-security-check": "59400",
      "/x402/v2/cookie-scan": "178200"
    }),
    classify: async () => null,
    pay: async () => {
      pays += 1;
      throw new PayGatedError("Pay requires a 0x PRIVATE_KEY after policy allow. Do not invent one.");
    }
  });
  assert.equal(pays, 1);
  assert.equal(run.decision, "incomplete");
  assert.equal(run.nextGate, "key");
  assert.equal(run.steps[0]?.kind, "spend_gated");
  assert.equal(run.steps[1]?.kind, "skipped");
  assert.equal(run.steps[2]?.kind, "skipped");
  assert.equal(run.deliver.delivered, false);
  assert.equal(run.usdc_spent, 0);
  assert.equal(run.signer_invocation_count, 0);
});
