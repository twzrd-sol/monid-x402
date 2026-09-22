/**
 * Sellable SKU on the x402 rail. tool-audit was the prepaid beginning slice
 * (three measured calls vs Vendorapp $149/mo). This is that job as a live
 * quote → 402 → pay → deliver. Quote never signs. Deliver never upgrades
 * missing evidence to approval. USDC settles to Monid, not TWZRD.
 */
import { MONID_X402_RUN_URL, RAIL } from "./constants.js";
import { COUNTERPARTY_SKU, TIERS, counterpartySkuCard } from "./counterparty-sku.js";
import { scrapePayInput } from "./input.js";
import { type PrescreenClassifyFn, classifyPrescreenSkip } from "./jev-client.js";
import { hasRefusePacket } from "./ledger.js";
import { PayGatedError, payRun, type PayResult } from "./pay.js";
import { amountMicro, usdcFromMicro } from "./payment-required.js";
import { defaultPolicy, evaluatePaymentRequired } from "./policy.js";
import { probeRun402 } from "./probe.js";
import { spendGatedReceipt } from "./receipt.js";
import type {
  PaidReceipt,
  PayFailedReceipt,
  RefuseReceipt,
  RunTarget,
  SpendGatedReceipt
} from "./types.js";

export const PRODUCT_SKU = "vendor-prescreen";
export const PRODUCT_SCHEMA = "twzrd.product_quote.v1" as const;
export const PRODUCT_RUN_SCHEMA = "twzrd.product_run.v1" as const;
export const PRODUCT_DELIVER_SCHEMA = "twzrd.product_deliver.v1" as const;
export const PRODUCT_QUOTE_CAP_MICRO = 300_000n;
export const PRODUCT_CATALOG_SCHEMA = "twzrd.product_catalog.v1" as const;

export function productCatalog() {
  return {
    schema: PRODUCT_CATALOG_SCHEMA,
    rail: RAIL,
    skus: [
      {
        sku: PRODUCT_SKU,
        job: "First-pass vendor evidence: scrape + security headers + cookie scan",
        quote: "POST /v1/product/quote",
        run: "POST /v1/product/run",
        pay: "CLI `product --confirm-spend` after a refuse packet for that seat",
        operate: "GET /prescreen",
        settlement: {
          recipient: "monid" as const,
          takeRate: 0 as const,
          currency: "USDC" as const,
          note: "USDC settles to Monid payTo. TWZRD has no take-rate on this SKU."
        },
        incumbent: INCUMBENT
      },
      {
        sku: COUNTERPARTY_SKU,
        job: "Resolve who actually answers a paid call before an agent pays it.",
        quote: "quoteCounterparty({ tier, subjectsSubmitted, distinctCounterparties })",
        run: "tool-audit `catalog-provenance` (free) then `cohort-screen` (paid)",
        pay: "Not yet payable on this rail. No signer has fired for this SKU.",
        operate: "tool-audit pages/counterparty.html",
        priceUsd: {
          provenance: TIERS.provenance.priceUsd,
          posture: TIERS.posture.priceUsd,
          cohort: `${TIERS.cohort.priceUsd} per DISTINCT counterparty`
        },
        settlement: {
          recipient: "unsettled" as const,
          takeRate: 0 as const,
          currency: "USDC" as const,
          note: "Priced, schema'd, and costed against a measured COGS. Not yet sold; this rail has taken no payment."
        },
        marketCheck: counterpartySkuCard().marketCheck
      },
      {
        sku: "company-brief",
        job: "Resolve a domain then read the homepage. High-TA research/sales loop.",
        quote: "CLI `brief` (refuse under cap)",
        run: "CLI `brief`",
        pay: "CLI `brief --confirm-spend` after a refuse packet for that seat",
        operate: "GET / on the desk; pages/brief.html",
        settlement: {
          recipient: "monid" as const,
          takeRate: 0 as const,
          currency: "USDC" as const,
          note: "USDC settles to Monid payTo. TWZRD has no take-rate on this SKU."
        }
      }
    ],
    canPay: false,
    nextGate: "confirm_spend"
  };
}

/** Same limitation tool-audit recorded. Absence of issues is not approval. */
export const COOKIE_UNCERTAINTY_LIMITATION =
  "UNABLE_TO_VERIFY: only partial HTML was analyzed and JavaScript-set cookies were not observed.";

/** Incumbent prices from the frozen tool-audit snapshot. Not re-fetched. */
export const INCUMBENT = {
  name: "Vendorapp Startup",
  source: "tool-audit measured snapshot 2026-09-11",
  monthlyPriceUsd: 149,
  includedPrescreens: 200,
  perJobUsd: 0.745
} as const;

export type PrescreenRole = "public_offer" | "security_headers" | "cookie_consent";

export type PrescreenStep = {
  role: PrescreenRole;
  why: string;
  target: RunTarget;
};

export type QuotedStep = {
  role: PrescreenRole;
  provider: string;
  endpoint: string;
  // "not_needed" (not "skipped") to avoid colliding with ProductStepResult.kind's
  // "skipped", which means something different (a cascade after a prior failure).
  class: "x402" | "error" | "not_needed";
  amount: string | null;
  usd: number | null;
  network: string | null;
  payTo: string | null;
  reason?: string;
};

/**
 * Jev (jev-1.13.0) decides, per target, whether security_headers/
 * cookie_consent are worth attempting - never whether they're safe. The
 * baseline this feature must never regress below is "always run all 3
 * steps": on any classifier failure or uncertainty (no key, timeout, HTTP
 * error, bad payload, low confidence, or a hallucinated choice), both flags
 * stay false and the reason says so. Unlike a typical pre-spend gate, "keep"
 * is the safe default here, not "skip" - skipping a check nobody actually
 * decided to skip is worse than an occasional wasted $0.0594.
 */
export type PrescreenSkipDecision = {
  skipSecurityHeaders: boolean;
  skipCookieConsent: boolean;
  source: "jev" | "default";
  reasonSecurityHeaders: string;
  reasonCookieConsent: string;
};

export const PRESCREEN_SKIP_CONFIDENCE_THRESHOLD = 0.7;

/** Visible in findings when a seat was not scanned. Empty arrays are a real scan that found nothing. */
export const NOT_ATTEMPTED = "NOT_ATTEMPTED";

/** Hard stop on outbound classifier calls for this process. Cache hits do not count. Past the ceiling, seats stay in the plan and nothing is billed. */
export const PRESCREEN_CLASSIFIER_CALL_CEILING = 8;

const PRESCREEN_SKIP_CACHE_TTL_MS = 5 * 60 * 1000;
const skipCache = new Map<string, { decision: PrescreenSkipDecision; expiresAt: number }>();
let billedClassifierCalls = 0;

/** Test isolation only. Production callers never reset the ceiling. */
export function resetPrescreenClassifierBudgetForTests(): void {
  billedClassifierCalls = 0;
  skipCache.clear();
}

const DEFAULT_SKIP_REASON =
  "Jev unavailable or inconclusive; keeping all prescreen steps (safe default).";

export async function resolvePrescreenSkips(
  targetUrl: string,
  options?: { fetch?: typeof fetch; classify?: PrescreenClassifyFn }
): Promise<PrescreenSkipDecision> {
  // Only cache the real classifier path. A caller that injects its own
  // `classify` (every test, and any future caller wanting per-call control)
  // is opting out of the shared cache by construction - caching that would
  // both defeat the injection and leak state across independent calls that
  // happen to share a target URL.
  const usingRealClassifier = options?.classify === undefined;
  if (usingRealClassifier) {
    const cached = skipCache.get(targetUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.decision;
    if (billedClassifierCalls >= PRESCREEN_CLASSIFIER_CALL_CEILING) {
      return keepAllPrescreenSteps();
    }
    billedClassifierCalls += 1;
  }

  const decision = await resolvePrescreenSkipsUncached(targetUrl, options);
  if (usingRealClassifier) {
    skipCache.set(targetUrl, { decision, expiresAt: Date.now() + PRESCREEN_SKIP_CACHE_TTL_MS });
  }
  return decision;
}

function keepAllPrescreenSteps(): PrescreenSkipDecision {
  return {
    skipSecurityHeaders: false,
    skipCookieConsent: false,
    source: "default",
    reasonSecurityHeaders: DEFAULT_SKIP_REASON,
    reasonCookieConsent: DEFAULT_SKIP_REASON
  };
}

async function resolvePrescreenSkipsUncached(
  targetUrl: string,
  options?: { fetch?: typeof fetch; classify?: PrescreenClassifyFn }
): Promise<PrescreenSkipDecision> {
  const classify = options?.classify ?? classifyPrescreenSkip;
  const classification = await classify(targetUrl, { fetch: options?.fetch });
  if (!classification) {
    return keepAllPrescreenSteps();
  }

  const decide = (answer: typeof classification.securityHeaders): { skip: boolean; reason: string } => {
    // An unusable sub-answer (missing, or a hallucinated choice the
    // anti-hallucination guard in jev-client.ts already nulled out) is the
    // only case that gets the generic "unavailable" reason - a real "keep"
    // or a real-but-low-confidence "skip" answer must say so accurately,
    // since this reason string is user/log-facing (see QuotedStep.reason).
    if (!answer || answer.choice === null) {
      return { skip: false, reason: DEFAULT_SKIP_REASON };
    }
    if (answer.choice === "skip" && answer.confidence >= PRESCREEN_SKIP_CONFIDENCE_THRESHOLD) {
      return {
        skip: true,
        reason: `Jev (${classification.model}) judged this step unnecessary for this target (confidence ${answer.confidence.toFixed(2)}).`
      };
    }
    if (answer.choice === "skip") {
      return {
        skip: false,
        reason: `Jev (${classification.model}) suggested skipping (confidence ${answer.confidence.toFixed(2)}, below the ${PRESCREEN_SKIP_CONFIDENCE_THRESHOLD} threshold); keeping the step.`
      };
    }
    return {
      skip: false,
      reason: `Jev (${classification.model}) judged this step necessary (confidence ${answer.confidence.toFixed(2)}).`
    };
  };

  const headers = decide(classification.securityHeaders);
  const cookies = decide(classification.cookieConsent);
  return {
    skipSecurityHeaders: headers.skip,
    skipCookieConsent: cookies.skip,
    source: "jev",
    reasonSecurityHeaders: headers.reason,
    reasonCookieConsent: cookies.reason
  };
}

export type ProductQuote = {
  schema: typeof PRODUCT_SCHEMA;
  sku: typeof PRODUCT_SKU;
  rail: typeof RAIL;
  targetUrl: string;
  incumbent: typeof INCUMBENT;
  steps: QuotedStep[];
  quote: {
    stepCount: number;
    totalMicro: string;
    totalUsd: number;
    currency: "USDC";
    capMicro: string;
  };
  vsIncumbent: {
    incumbentPerJobUsd: number;
    oursUsd: number;
    deltaUsd: number;
    note: string;
  };
  decision: "quote";
  canPay: false;
  nextGate: "confirm_spend" | "over_cap" | "catalog_gap";
  blocker: string;
  nextStep: string;
  signer_invocation_count: 0;
  usdc_spent: 0;
  quotedAt: string;
};

export function normalizeTargetUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("product quote needs a target URL");
  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(href);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("target URL must be http(s)");
  }
  return url.href;
}

export function vendorPrescreenPlan(raw: string): { targetUrl: string; steps: PrescreenStep[] } {
  const targetUrl = normalizeTargetUrl(raw);
  return {
    targetUrl,
    steps: [
      {
        role: "public_offer",
        why: "Read the target's current public page. First-pass evidence, not a Vendorapp film.",
        target: {
          provider: "context.dev",
          endpoint: "/web/scrape/markdown",
          input: scrapePayInput(targetUrl)
        }
      },
      {
        role: "security_headers",
        why: "Inspect security headers before any downstream tool spend.",
        target: {
          provider: "api.strale.io",
          endpoint: "/x402/header-security-check",
          input: { queryParams: { url: targetUrl } }
        }
      },
      {
        role: "cookie_consent",
        why: "Inspect cookie/consent evidence. Partial HTML stays review_required, not a green check.",
        target: {
          provider: "api.strale.io",
          endpoint: "/x402/v2/cookie-scan",
          input: { queryParams: { url: targetUrl } }
        }
      }
    ]
  };
}

export async function quoteVendorPrescreen(
  raw: string,
  options?: {
    capMicro?: bigint;
    fetch?: typeof fetch;
    now?: () => string;
    classify?: PrescreenClassifyFn;
  }
): Promise<ProductQuote> {
  const plan = vendorPrescreenPlan(raw);
  const capMicro = options?.capMicro ?? PRODUCT_QUOTE_CAP_MICRO;
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  // Fired now, awaited lazily below - runs concurrently with the
  // public_offer probe (which never depends on it) instead of adding Jev's
  // full round-trip/timeout to every quote's latency unconditionally.
  const skipPromise = resolvePrescreenSkips(plan.targetUrl, {
    fetch: fetchImpl,
    classify: options?.classify
  });
  const steps: QuotedStep[] = [];
  let totalMicro = 0n;
  let skip: PrescreenSkipDecision | null = null;

  const skippedStep = (step: PrescreenStep, reason: string): QuotedStep => ({
    role: step.role,
    provider: step.target.provider,
    endpoint: step.target.endpoint,
    class: "not_needed",
    amount: null,
    usd: null,
    network: null,
    payTo: null,
    reason
  });

  for (const step of plan.steps) {
    if (step.role !== "public_offer" && skip === null) {
      skip = await skipPromise;
    }
    if (step.role === "security_headers" && skip?.skipSecurityHeaders) {
      steps.push(skippedStep(step, skip.reasonSecurityHeaders));
      continue;
    }
    if (step.role === "cookie_consent" && skip?.skipCookieConsent) {
      steps.push(skippedStep(step, skip.reasonCookieConsent));
      continue;
    }
    try {
      const probe = await probeRun402(step.target, fetchImpl);
      const accepts = probe.paymentRequired.accepts;
      if (probe.status !== 402 || accepts.length === 0) {
        steps.push({
          role: step.role,
          provider: step.target.provider,
          endpoint: step.target.endpoint,
          class: "error",
          amount: null,
          usd: null,
          network: null,
          payTo: null,
          reason: `expected 402, got HTTP ${probe.status}`
        });
        continue;
      }
      // Eligibility (payTo, network, asset, scheme) is the quote filter.
      // The SKU cap applies to the sum below, not to this selection.
      const verdict = evaluatePaymentRequired(probe.paymentRequired, defaultPolicy({
        maxAmountMicro: 10n ** 18n
      }));
      if (verdict.decision !== "allow" || !verdict.selected) {
        steps.push({
          role: step.role,
          provider: step.target.provider,
          endpoint: step.target.endpoint,
          class: "error",
          amount: null,
          usd: null,
          network: null,
          payTo: null,
          reason: verdict.reason
        });
        continue;
      }
      const selected = verdict.selected;
      const micro = amountMicro(selected);
      totalMicro += micro;
      steps.push({
        role: step.role,
        provider: step.target.provider,
        endpoint: step.target.endpoint,
        class: "x402",
        amount: selected.amount,
        usd: usdcFromMicro(micro),
        network: selected.network,
        payTo: selected.payTo
      });
    } catch (error) {
      steps.push({
        role: step.role,
        provider: step.target.provider,
        endpoint: step.target.endpoint,
        class: "error",
        amount: null,
        usd: null,
        network: null,
        payTo: null,
        reason: error instanceof Error ? error.message.slice(0, 180) : "probe failed"
      });
    }
  }

  const oursUsd = usdcFromMicro(totalMicro);
  const gap = steps.some((row) => row.class === "error");
  const over = totalMicro > capMicro;
  const nextGate = gap ? "catalog_gap" : over ? "over_cap" : "confirm_spend";
  const blocker = gap
    ? "One or more SKU seats did not 402. Quote is not a price lock."
    : over
      ? `quoted ${totalMicro} exceeds cap ${capMicro}. Do not sign.`
      : "Quote allowed under cap. Pay is CLI `product --confirm-spend` after a refuse packet for that seat.";

  return {
    schema: PRODUCT_SCHEMA,
    sku: PRODUCT_SKU,
    rail: RAIL,
    targetUrl: plan.targetUrl,
    incumbent: INCUMBENT,
    steps,
    quote: {
      stepCount: steps.length,
      totalMicro: totalMicro.toString(),
      totalUsd: oursUsd,
      currency: "USDC",
      capMicro: capMicro.toString()
    },
    vsIncumbent: {
      incumbentPerJobUsd: INCUMBENT.perJobUsd,
      oursUsd,
      deltaUsd: Number((INCUMBENT.perJobUsd - oursUsd).toFixed(4)),
      note: "Incumbent per-job is $149/200 from the frozen tool-audit snapshot. Not a live Vendorapp fetch."
    },
    decision: "quote",
    canPay: false,
    nextGate,
    blocker,
    nextStep:
      nextGate === "confirm_spend"
        ? "Operator runs `product --confirm-spend` after a refuse packet for each seat being paid."
        : "Do not sign. Re-probe or raise the quote cap only after a refuse packet exists.",
    signer_invocation_count: 0,
    usdc_spent: 0,
    quotedAt: options?.now?.() ?? new Date().toISOString()
  };
}

export type ProductPayFn = (input: {
  target: RunTarget;
  confirmSpend: true;
  privateKey?: `0x${string}`;
  fetch?: typeof fetch;
}) => Promise<PayResult>;

export type ProductStepKind =
  | "quoted"
  | "paid"
  | "refused"
  | "failed"
  | "spend_gated"
  | "skipped"
  | "not_needed";

export type ProductStepResult = {
  role: PrescreenRole;
  why: string;
  provider: string;
  endpoint: string;
  kind: ProductStepKind;
  receipt?: RefuseReceipt | PaidReceipt | PayFailedReceipt | SpendGatedReceipt;
  outputSummary?: Record<string, unknown>;
  reason?: string;
};

export type ProductSettlement = {
  recipient: "monid";
  payTo: string | null;
  payTos: string[];
  takeRate: 0;
  currency: "USDC";
  note: string;
};

export type ProductDeliver = {
  schema: typeof PRODUCT_DELIVER_SCHEMA;
  sku: typeof PRODUCT_SKU;
  rail: typeof RAIL;
  targetUrl: string;
  delivered: boolean;
  verdict: "review_required" | "incomplete";
  findings: {
    publicOffer: Record<string, unknown>;
    missingSecurityHeaders: unknown[];
    headerPotentialIssues: string[];
    cookiePotentialIssues: string[];
  };
  steps: ProductStepResult[];
  limitations: string[];
  vsIncumbent: ProductQuote["vsIncumbent"];
  settlement: ProductSettlement;
  signer_invocation_count: number;
  usdc_spent: number;
  capturedAt: string;
};

export type ProductRun = {
  schema: typeof PRODUCT_RUN_SCHEMA;
  sku: typeof PRODUCT_SKU;
  rail: typeof RAIL;
  targetUrl: string;
  quote: ProductQuote;
  settlement: ProductSettlement;
  steps: ProductStepResult[];
  deliver: ProductDeliver;
  decision: "quoted" | "held" | "paid" | "incomplete";
  canPay: boolean;
  nextGate: "confirm_spend" | "over_cap" | "catalog_gap" | "proxy_wallet" | "refuse_required" | "wash" | "key" | "none";
  blocker: string;
  nextStep: string;
  hold?: SpendGatedReceipt;
  signer_invocation_count: number;
  usdc_spent: number;
  capturedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unwrapOutput(body: unknown): Record<string, unknown> {
  const rec = asRecord(body);
  if ("output" in rec) return asRecord(rec.output);
  if ("data" in rec) return asRecord(rec.data);
  return rec;
}

function withCookieUncertainty(issues: string[]): string[] {
  if (issues.some((issue) => /unable_to_verify|javascript-set cookies|partial HTML/i.test(issue))) {
    return issues;
  }
  return [...issues, COOKIE_UNCERTAINTY_LIMITATION];
}

export function settlementFromQuote(quote: ProductQuote): ProductSettlement {
  const payTos = [
    ...new Set(quote.steps.map((step) => step.payTo).filter((value): value is string => Boolean(value)))
  ];
  return {
    recipient: "monid",
    payTo: payTos[0] ?? null,
    payTos,
    takeRate: 0,
    currency: "USDC",
    note: "USDC settles to Monid payTo. TWZRD has no take-rate on this SKU."
  };
}

function summarizePublicOffer(body: unknown): Record<string, unknown> {
  const out = unwrapOutput(body);
  const title = typeof out.title === "string" ? out.title : undefined;
  const finalUrl = typeof out.finalUrl === "string" ? out.finalUrl : undefined;
  const success = typeof out.success === "boolean" ? out.success : undefined;
  return {
    success,
    finalUrl,
    title,
    present: Boolean(title || finalUrl || success === true || typeof out.markdown === "string")
  };
}

function summarizeHeaders(body: unknown): {
  missing: unknown[];
  issues: string[];
  summary: Record<string, unknown>;
} {
  const out = unwrapOutput(body);
  const missing = Array.isArray(out.missing)
    ? out.missing
    : Array.isArray(out.missingHeaders)
      ? out.missingHeaders
      : [];
  const issues = Array.isArray(out.missing) || Array.isArray(out.missingHeaders)
    ? []
    : ["Security-header result omitted its missing-header evidence."];
  return {
    missing,
    issues,
    summary: {
      score: out.score,
      grade: out.grade,
      missingHeaders: missing,
      present: missing.length > 0 || typeof out.score === "number"
    }
  };
}

function summarizeCookies(body: unknown): { issues: string[]; summary: Record<string, unknown> } {
  const out = unwrapOutput(body);
  const rawIssues = Array.isArray(out.potential_issues)
    ? out.potential_issues
    : Array.isArray(out.potentialIssues)
      ? out.potentialIssues
      : [];
  const parsed = rawIssues.filter((item): item is string => typeof item === "string");
  const issues = withCookieUncertainty(
    parsed.length > 0
      ? parsed
      : ["Cookie scan returned no limitation details; absence of reported issues is not approval."]
  );
  return {
    issues,
    summary: {
      totalCookiesObserved: out.totalCookiesObserved ?? out.totalCookies ?? out.total_cookies,
      consentBannerDetected: out.consentBannerDetected ?? out.consent_banner_detected,
      potentialIssues: issues,
      present: true
    }
  };
}

function spentFromReceipt(receipt: ProductStepResult["receipt"]): number {
  return receipt && typeof receipt.usdc_spent === "number" ? receipt.usdc_spent : 0;
}

function signersFromReceipt(receipt: ProductStepResult["receipt"]): number {
  return receipt && typeof receipt.signer_invocation_count === "number" ? receipt.signer_invocation_count : 0;
}

export function deliverVendorPrescreen(input: {
  quote: ProductQuote;
  steps: ProductStepResult[];
  now?: () => string;
}): ProductDeliver {
  const paid = input.steps.filter((step) => step.kind === "paid");
  const notNeeded = input.steps.filter((step) => step.kind === "not_needed");
  const offerPaid = paid.some((step) => step.role === "public_offer");
  const delivered =
    notNeeded.length === 0 &&
    input.quote.steps.length === 3 &&
    paid.length === 3 &&
    offerPaid;
  const headerSkipped = notNeeded.some((step) => step.role === "security_headers");
  const cookieSkipped = notNeeded.some((step) => step.role === "cookie_consent");
  const headerStep = headerSkipped ? undefined : paid.find((step) => step.role === "security_headers");
  const cookieStep = cookieSkipped ? undefined : paid.find((step) => step.role === "cookie_consent");
  const offerStep = paid.find((step) => step.role === "public_offer");
  const headers = headerStep ? summarizeHeaders(headerStep.outputSummary ?? headerStep) : null;
  const cookies = cookieStep ? summarizeCookies(cookieStep.outputSummary ?? cookieStep) : null;
  const publicOffer = offerStep
    ? summarizePublicOffer(offerStep.outputSummary ?? offerStep)
    : { present: false };

  const steps = input.steps.map((step) => {
    if (step.kind !== "paid") return step;
    const summary =
      step.role === "public_offer"
        ? summarizePublicOffer(step.outputSummary)
        : step.role === "security_headers"
          ? summarizeHeaders(step.outputSummary).summary
          : summarizeCookies(step.outputSummary).summary;
    return { ...step, outputSummary: summary };
  });

  const unpaid = input.steps
    .filter((step) => step.kind !== "paid" && step.kind !== "not_needed")
    .map((step) => step.role);
  const limitations = [
    "This replaces first-pass evidence collection before downstream tool spend—not monitoring, remediation, contracts, or human review.",
    "Incumbent $149/200 is the frozen tool-audit snapshot. Not a live Vendorapp fetch.",
    "USDC settles to Monid payTo. TWZRD take-rate is 0."
  ];
  for (const step of notNeeded) {
    limitations.push(
      `NOT_ATTEMPTED (${step.role}): ${step.reason ?? "Jev judged this step unnecessary."} Absence of a paid check is not a clean bill of health.`
    );
  }
  if (!delivered) {
    const notAttempted = notNeeded.map((step) => step.role);
    limitations.unshift(
      unpaid.length
        ? `Not delivered. Unpaid steps: ${unpaid.join(", ")}.`
        : notAttempted.length
          ? `Not delivered. Not attempted: ${notAttempted.join(", ")}.`
          : "Not delivered. Quote only; no paid step completed."
    );
  } else if (cookieStep) {
    // Only claims "partial HTML was analyzed" when a cookie scan actually
    // ran - asserting this when cookie_consent was Jev-skipped (not_needed)
    // would contradict the NOT_ATTEMPTED line above with a false claim that
    // some analysis happened.
    limitations.unshift(COOKIE_UNCERTAINTY_LIMITATION);
  }

  const signer_invocation_count = input.steps.reduce((sum, step) => sum + signersFromReceipt(step.receipt), 0);
  const usdc_spent = Number(
    input.steps.reduce((sum, step) => sum + spentFromReceipt(step.receipt), 0).toFixed(6)
  );

  return {
    schema: PRODUCT_DELIVER_SCHEMA,
    sku: PRODUCT_SKU,
    rail: RAIL,
    targetUrl: input.quote.targetUrl,
    delivered,
    verdict: delivered ? "review_required" : "incomplete",
    findings: {
      publicOffer,
      missingSecurityHeaders: headerSkipped ? [NOT_ATTEMPTED] : headers?.missing ?? [],
      headerPotentialIssues: headerSkipped ? [NOT_ATTEMPTED] : headers?.issues ?? [],
      cookiePotentialIssues: cookieSkipped ? [NOT_ATTEMPTED] : cookies?.issues ?? []
    },
    steps,
    limitations,
    vsIncumbent: input.quote.vsIncumbent,
    settlement: settlementFromQuote(input.quote),
    signer_invocation_count,
    usdc_spent,
    capturedAt: input.now?.() ?? new Date().toISOString()
  };
}

function quotedStepResults(
  quote: ProductQuote,
  plan: { steps: PrescreenStep[] }
): ProductStepResult[] {
  return plan.steps.map((step, index) => {
    const quoted = quote.steps[index];
    return {
      role: step.role,
      why: step.why,
      provider: step.target.provider,
      endpoint: step.target.endpoint,
      kind: quoted?.class === "x402" ? "quoted" : quoted?.class === "not_needed" ? "not_needed" : "failed",
      reason: quoted?.reason
    };
  });
}

function runTotals(steps: ProductStepResult[]): { signer_invocation_count: number; usdc_spent: number } {
  return {
    signer_invocation_count: steps.reduce((sum, step) => sum + signersFromReceipt(step.receipt), 0),
    usdc_spent: Number(steps.reduce((sum, step) => sum + spentFromReceipt(step.receipt), 0).toFixed(6))
  };
}

function gateFromHold(steps: ProductStepResult[], quote: ProductQuote): ProductRun["nextGate"] {
  if (steps.some((step) => step.kind === "refused" && step.receipt && "code" in step.receipt && /wash/i.test(step.receipt.code))) {
    return "wash";
  }
  if (
    steps.some(
      (step) =>
        step.kind === "spend_gated" && /refuse packet/i.test(step.reason ?? "")
    )
  ) {
    return "refuse_required";
  }
  if (steps.some((step) => step.kind === "spend_gated")) return "key";
  if (quote.nextGate !== "confirm_spend") return quote.nextGate;
  if (steps.some((step) => step.kind === "not_needed")) return "confirm_spend";
  if (steps.every((step) => step.kind === "paid")) return "none";
  return "confirm_spend";
}

export async function runVendorPrescreen(
  raw: string,
  options?: {
    confirmSpend?: boolean;
    privateKey?: `0x${string}`;
    fetch?: typeof fetch;
    pay?: ProductPayFn;
    requireRefuseDir?: string;
    now?: () => string;
    capMicro?: bigint;
    /** Per-seat policy cap. Cookie scan is $0.1782. */
    maxAmountMicro?: bigint;
    classify?: PrescreenClassifyFn;
  }
): Promise<ProductRun> {
  const plan = vendorPrescreenPlan(raw);
  const quote = await quoteVendorPrescreen(raw, {
    fetch: options?.fetch,
    now: options?.now,
    capMicro: options?.capMicro,
    classify: options?.classify
  });
  const settlement = settlementFromQuote(quote);
  const capturedAt = options?.now?.() ?? new Date().toISOString();

  const finish = (
    steps: ProductStepResult[],
    extra: Partial<Pick<ProductRun, "decision" | "nextGate" | "blocker" | "nextStep" | "hold">>
  ): ProductRun => {
    const totals = runTotals(steps);
    const deliver = deliverVendorPrescreen({ quote, steps, now: options?.now });
    const unattempted = steps.some((step) => step.kind === "not_needed");
    let decision =
      extra.decision ??
      (deliver.delivered ? "paid" : options?.confirmSpend ? "incomplete" : "quoted");
    let nextGate = extra.nextGate ?? gateFromHold(steps, quote);
    if (unattempted) {
      if (decision === "paid") decision = "incomplete";
      if (nextGate === "none") nextGate = "confirm_spend";
    }
    return {
      schema: PRODUCT_RUN_SCHEMA,
      sku: PRODUCT_SKU,
      rail: RAIL,
      targetUrl: plan.targetUrl,
      quote,
      settlement,
      steps,
      deliver,
      decision,
      canPay: Boolean(
        options?.confirmSpend &&
          options.privateKey?.startsWith("0x") &&
          quote.nextGate === "confirm_spend"
      ),
      nextGate,
      blocker: extra.blocker ?? quote.blocker,
      nextStep: extra.nextStep ?? quote.nextStep,
      ...(extra.hold ? { hold: extra.hold } : {}),
      signer_invocation_count: totals.signer_invocation_count,
      usdc_spent: totals.usdc_spent,
      capturedAt
    };
  };

  if (!options?.confirmSpend) {
    return finish(quotedStepResults(quote, plan), {
      decision: "quoted",
      nextGate: quote.nextGate,
      blocker: quote.blocker,
      nextStep: quote.nextStep
    });
  }

  if (quote.nextGate !== "confirm_spend") {
    return finish(quotedStepResults(quote, plan), {
      decision: "held",
      nextGate: quote.nextGate,
      blocker: quote.blocker,
      nextStep: quote.nextStep
    });
  }

  const pay =
    options.pay ??
    ((input) =>
      payRun({
        confirmSpend: true,
        privateKey: input.privateKey,
        fetch: input.fetch,
        target: input.target,
        policy: defaultPolicy({ maxAmountMicro: options.maxAmountMicro ?? 178_200n })
      }));
  const steps: ProductStepResult[] = [];
  let stop = false;
  for (const [i, step] of plan.steps.entries()) {
    const quoted = quote.steps[i];
    if (quoted?.class === "not_needed") {
      // A deliberate Jev skip is independent of any prior failure - it is
      // never a "not paid" cascade, and it must not set stop = true (later
      // seats are still attempted normally).
      steps.push({
        role: step.role,
        why: step.why,
        provider: step.target.provider,
        endpoint: step.target.endpoint,
        kind: "not_needed",
        reason: quoted.reason
      });
      continue;
    }
    if (stop) {
      steps.push({
        role: step.role,
        why: step.why,
        provider: step.target.provider,
        endpoint: step.target.endpoint,
        kind: "skipped",
        reason: "Prior SKU step was not paid. Remaining seats were not signed."
      });
      continue;
    }
    if (options.requireRefuseDir && !hasRefusePacket(options.requireRefuseDir, step.target)) {
      const reason = `no refuse packet on disk for ${step.target.provider}${step.target.endpoint}. Refuse first.`;
      steps.push({
        role: step.role,
        why: step.why,
        provider: step.target.provider,
        endpoint: step.target.endpoint,
        kind: "spend_gated",
        receipt: spendGatedReceipt(step.target, MONID_X402_RUN_URL, reason),
        reason
      });
      stop = true;
      continue;
    }
    try {
      const result = await pay({
        target: step.target,
        confirmSpend: true,
        privateKey: options.privateKey,
        fetch: options.fetch
      });
      const paidBody = result.kind === "paid" ? result.body : undefined;
      steps.push({
        role: step.role,
        why: step.why,
        provider: step.target.provider,
        endpoint: step.target.endpoint,
        kind:
          result.kind === "paid" ? "paid" : result.kind === "refused" ? "refused" : "failed",
        receipt: result.receipt,
        ...(paidBody !== undefined ? { outputSummary: asRecord(paidBody) } : {}),
        reason: "reason" in result.receipt ? result.receipt.reason : undefined
      });
      if (result.kind !== "paid") stop = true;
    } catch (error) {
      if (error instanceof PayGatedError) {
        const receipt = spendGatedReceipt(
          step.target,
          MONID_X402_RUN_URL,
          error.message
        );
        steps.push({
          role: step.role,
          why: step.why,
          provider: step.target.provider,
          endpoint: step.target.endpoint,
          kind: "spend_gated",
          receipt,
          reason: error.message
        });
        stop = true;
        continue;
      }
      steps.push({
        role: step.role,
        why: step.why,
        provider: step.target.provider,
        endpoint: step.target.endpoint,
        kind: "failed",
        reason: error instanceof Error ? error.message.slice(0, 180) : "pay failed"
      });
      stop = true;
    }
  }

  return finish(steps, {});
}

export function holdVendorPrescreenOnListen(run: ProductRun, reason: string): ProductRun {
  return {
    ...run,
    canPay: false,
    decision: "held",
    nextGate: "proxy_wallet",
    blocker: reason,
    nextStep: "Buyer pays via CLI `product --confirm-spend` after a refuse packet. Listen has no wallet. Do not invent a key.",
    hold: spendGatedReceipt(
      { provider: PRODUCT_SKU, endpoint: "/run" },
      MONID_X402_RUN_URL,
      reason
    ),
    deliver: {
      ...run.deliver,
      delivered: false,
      verdict: "incomplete"
    }
  };
}
