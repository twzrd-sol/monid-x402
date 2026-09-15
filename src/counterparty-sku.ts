/**
 * Seller-side SKU: counterparty provenance.
 *
 * Nothing in Monid's catalog answers "who actually answers this call". A
 * sweep of 412 endpoints found 67 selling text extraction from $0.00009 and
 * none selling provenance. The nearest neighbours are WHOIS, which reports who
 * registered a domain, and institutional-ownership feeds, which are about
 * equities. Neither tells a buying agent that the brand on a listing is not
 * the party that will answer.
 *
 * The pricing model is the finding. Cohort work is billed per distinct
 * counterparty rather than per listing, because the free provenance pass is
 * what collapses 59 listings onto 31 hosts. A competitor undercutting us per
 * listing is selling 29 duplicate audits of the wrong host.
 *
 * COGS below is measured, not estimated: provenance runs on discovery and
 * inspection, which settled $0.00 across 90 calls on 2026-09-15; posture adds
 * one live header check billed at $0.0594.
 */
import { RAIL } from "./constants.js";

export const COUNTERPARTY_SKU = "counterparty-provenance";
export const COUNTERPARTY_SKU_SCHEMA = "twzrd.counterparty_sku.v1" as const;
export const COUNTERPARTY_QUOTE_SCHEMA = "twzrd.counterparty_quote.v1" as const;

/** x402 floor on this rail: 10000 micro-USDC. Nothing may price below it. */
export const X402_FLOOR_MICRO = 10_000n;

export type TierId = "provenance" | "posture" | "cohort";

export interface SkuTier {
  id: TierId;
  priceMicro: bigint;
  priceUsd: number;
  /** Measured marginal cost to fulfil one unit. */
  cogsUsd: number;
  marginUsd: number;
  marginPct: number;
  unit: string;
  answers: string;
  cogsBasis: string;
}

function tier(
  id: TierId,
  priceMicro: bigint,
  cogsUsd: number,
  unit: string,
  answers: string,
  cogsBasis: string
): SkuTier {
  const priceUsd = Number(priceMicro) / 1e6;
  const marginUsd = Number((priceUsd - cogsUsd).toFixed(6));
  return {
    id,
    priceMicro,
    priceUsd,
    cogsUsd,
    marginUsd,
    marginPct: priceUsd === 0 ? 0 : Number(((marginUsd / priceUsd) * 100).toFixed(1)),
    unit,
    answers,
    cogsBasis
  };
}

export const TIERS: Record<TierId, SkuTier> = {
  provenance: tier(
    "provenance",
    X402_FLOOR_MICRO,
    0,
    "one resource",
    "Who answers this call, and is that the brand the listing asserts?",
    "Discovery and inspection only. Measured $0.00 across 90 preflight calls, balance unchanged either side."
  ),
  posture: tier(
    "posture",
    80_000n,
    0.0594,
    "one counterparty",
    "Provenance, plus the live security-header posture of the host that actually answers.",
    "One api.strale.io:/x402/header-security-check at its listed $0.0594."
  ),
  cohort: tier(
    "cohort",
    80_000n,
    0.0594,
    "one DISTINCT counterparty, not one listing",
    "The same as posture, billed across a catalog after deduplicating listings onto the hosts that answer.",
    "One header check per distinct host. Listings sharing a host are screened once."
  )
};

/** Input schema a purchasing agent must satisfy. */
export const COUNTERPARTY_INPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "counterparty-provenance request",
  type: "object",
  additionalProperties: false,
  required: ["tier", "subject"],
  properties: {
    tier: {
      type: "string",
      enum: ["provenance", "posture", "cohort"],
      description: "provenance is metadata only; posture adds a live header check; cohort bills per distinct counterparty."
    },
    subject: {
      description: "What to resolve. A Monid tool id, a resource URL, or a list for cohort.",
      oneOf: [
        { type: "string", pattern: "^[a-z0-9.\\-]+:/.+$", description: "Monid tool id, e.g. nasdaq:/get_stock_quote" },
        { type: "string", format: "uri", pattern: "^https://", description: "Resource URL" },
        {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: { type: "string" },
          description: "Cohort: tool ids or URLs. Billed per DISTINCT counterparty resolved, not per item."
        }
      ]
    },
    maxTotalMicro: {
      type: "string",
      pattern: "^[0-9]+$",
      description: "Buyer's ceiling in micro-USDC. The seller refuses before fulfilling if the quote exceeds it."
    }
  }
} as const;

/** Output schema the buyer can rely on. */
export const COUNTERPARTY_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "counterparty-provenance result",
  type: "object",
  required: ["schema", "tier", "results", "limitation"],
  properties: {
    schema: { const: "twzrd.counterparty_result.v1" },
    tier: { type: "string", enum: ["provenance", "posture", "cohort"] },
    billedCounterparties: {
      type: "integer",
      description: "Distinct hosts billed. For a cohort this is lower than the number of subjects submitted."
    },
    subjectsSubmitted: { type: "integer" },
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["subject", "classification", "verifiedTag"],
        properties: {
          subject: { type: "string" },
          brandAsserted: { type: "string", description: "providerName as the listing asserts it." },
          classification: {
            type: "string",
            enum: ["first_party_doc_host", "third_party_doc_host", "undocumented"]
          },
          docHost: { type: "string" },
          answeringCounterparty: {
            type: ["string", "null"],
            description: "Registrable domain that answers. null when undocumented."
          },
          sharesCounterpartyWith: {
            type: "array", items: { type: "string" },
            description: "Other brands in the request resolving to the same host."
          },
          verifiedTag: { type: "boolean", description: "Listing carries Monid's verified tag." },
          verifiedButNotFirstParty: {
            type: "boolean",
            description: "Tagged verified while not documenting on its own host. The selection-time gap."
          },
          posture: {
            type: ["object", "null"],
            description: "Present only on posture and cohort tiers.",
            properties: {
              grade: { type: "string", enum: ["A", "B", "C", "D", "F"] },
              score: { type: "integer" },
              missingHeaders: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    },
    limitation: { type: "string" }
  }
} as const;

export const COUNTERPARTY_LIMITATION =
  "A documentation host identifies who documents an endpoint, not who operates it, receives payment, or holds the data. A matching host is not proof of first-party operation, and a passing header grade is not an approval to spend. Undocumented subjects are returned unevaluated, which is not the same as clean.";

export interface CohortQuote {
  schema: typeof COUNTERPARTY_QUOTE_SCHEMA;
  sku: typeof COUNTERPARTY_SKU;
  rail: typeof RAIL;
  tier: TierId;
  subjectsSubmitted: number;
  distinctCounterparties: number;
  /** What a per-listing competitor would bill for the same request. */
  naivePriceUsd: number;
  priceUsd: number;
  priceMicro: string;
  buyerSavesUsd: number;
  buyerSavesPct: number;
  cogsUsd: number;
  marginUsd: number;
  currency: "USDC";
  settlement: string;
  limitation: string;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Price a request. `distinctCounterparties` comes from the free provenance
 * pass, so the discount is earned before the buyer is billed rather than
 * offered as a promotion.
 */
export function quoteCounterparty(input: {
  tier: TierId;
  subjectsSubmitted: number;
  distinctCounterparties: number;
}): CohortQuote {
  const t = TIERS[input.tier];
  if (!t) throw new Error(`Unknown tier: ${input.tier}`);
  if (input.subjectsSubmitted < 1) throw new Error("subjectsSubmitted must be at least 1.");
  if (input.distinctCounterparties < 1) throw new Error("distinctCounterparties must be at least 1.");
  if (input.distinctCounterparties > input.subjectsSubmitted) {
    throw new Error("distinctCounterparties cannot exceed subjectsSubmitted.");
  }

  const billed = input.tier === "cohort" ? input.distinctCounterparties : input.subjectsSubmitted;
  const priceUsd = round(billed * t.priceUsd);
  const naivePriceUsd = round(input.subjectsSubmitted * t.priceUsd);
  const buyerSavesUsd = round(naivePriceUsd - priceUsd);

  return {
    schema: COUNTERPARTY_QUOTE_SCHEMA,
    sku: COUNTERPARTY_SKU,
    rail: RAIL,
    tier: input.tier,
    subjectsSubmitted: input.subjectsSubmitted,
    distinctCounterparties: input.distinctCounterparties,
    naivePriceUsd,
    priceUsd,
    priceMicro: String(BigInt(billed) * t.priceMicro),
    buyerSavesUsd,
    buyerSavesPct: naivePriceUsd === 0 ? 0 : Number(((buyerSavesUsd / naivePriceUsd) * 100).toFixed(1)),
    cogsUsd: round(billed * t.cogsUsd),
    marginUsd: round(billed * t.marginUsd),
    currency: "USDC",
    settlement:
      "Priced for the x402 rail. This SKU has not taken a payment: no signer has fired on this rail and the tree holds no receipt claiming otherwise.",
    limitation: COUNTERPARTY_LIMITATION
  };
}

export function counterpartySkuCard() {
  return {
    schema: COUNTERPARTY_SKU_SCHEMA,
    sku: COUNTERPARTY_SKU,
    rail: RAIL,
    job: "Resolve who actually answers a paid call before an agent pays it.",
    // Figures from tool-audit evidence/market-scan.json, a discovery-only
    // sweep that settles nothing. Reproduce with `node scripts/market-scan.mjs`.
    marketCheck: {
      source: "tool-audit evidence/market-scan.json",
      endpointsSwept: 412,
      providersSwept: 63,
      sellingTextExtraction: 67,
      textExtractionProviders: 11,
      textExtractionFloorUsd: 0.00009,
      sellingCounterpartyProvenance: 0,
      counterpartyKeywordMatches: 1,
      counterpartyExcludedOnReview: "weather-underground:/get_historical_airport — historical airport weather, not endpoint provenance",
      adjacentWhoisSellers: 5,
      adjacentNote: "WHOIS reports who registered a domain. It does not report that a listing's asserted brand is not the party that answers.",
      sweptAt: "2026-09-15",
      coverage: "endpoints surfaced by 25 seed queries; a floor on how many sellers exist, not a census"
    },
    tiers: Object.values(TIERS),
    pricingModel:
      "Cohort work bills per distinct counterparty, not per listing. The free provenance pass collapses listings onto the hosts that answer, so the buyer pays for hosts rather than names.",
    evidence: {
      measuredCohort: { listings: 59, distinctCounterparties: 31, screensAvoided: 28 },
      note: "From the 2026-09-15 sweep of Monid's own catalog. 29 listings resolved to a single host."
    },
    canPay: false,
    limitation: COUNTERPARTY_LIMITATION
  };
}
