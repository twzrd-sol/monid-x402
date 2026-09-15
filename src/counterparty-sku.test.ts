import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  COUNTERPARTY_INPUT_SCHEMA,
  COUNTERPARTY_OUTPUT_SCHEMA,
  TIERS,
  X402_FLOOR_MICRO,
  counterpartySkuCard,
  quoteCounterparty
} from "./counterparty-sku.js";

test("no tier prices below the x402 floor", () => {
  for (const t of Object.values(TIERS)) {
    assert.ok(t.priceMicro >= X402_FLOOR_MICRO, `${t.id} is below the floor`);
  }
});

test("the metadata tier carries no marginal cost", () => {
  assert.equal(TIERS.provenance.cogsUsd, 0);
  assert.equal(TIERS.provenance.priceUsd, 0.01);
  assert.equal(TIERS.provenance.marginPct, 100);
});

test("the posture tier margin is stated honestly against a measured COGS", () => {
  assert.equal(TIERS.posture.cogsUsd, 0.0594);
  assert.equal(TIERS.posture.priceUsd, 0.08);
  assert.equal(TIERS.posture.marginUsd, 0.0206);
  assert.equal(TIERS.posture.marginPct, 25.8);
});

test("cohort bills per distinct counterparty, not per listing", () => {
  const q = quoteCounterparty({ tier: "cohort", subjectsSubmitted: 59, distinctCounterparties: 31 });
  assert.equal(q.priceUsd, 2.48);
  assert.equal(q.naivePriceUsd, 4.72);
  assert.equal(q.buyerSavesUsd, 2.24);
  assert.equal(q.buyerSavesPct, 47.5);
  assert.equal(q.priceMicro, "2480000");
});

test("cohort COGS tracks hosts screened, so margin scales with the dedup", () => {
  const q = quoteCounterparty({ tier: "cohort", subjectsSubmitted: 59, distinctCounterparties: 31 });
  assert.equal(q.cogsUsd, 1.8414);
  assert.equal(q.marginUsd, 0.6386);
  // The buyer saves more than the seller gives up, because 28 duplicate
  // screens are not performed at all rather than discounted.
  assert.ok(q.buyerSavesUsd > q.marginUsd);
});

test("non-cohort tiers bill every subject", () => {
  const q = quoteCounterparty({ tier: "posture", subjectsSubmitted: 5, distinctCounterparties: 2 });
  assert.equal(q.priceUsd, 0.4);
  assert.equal(q.buyerSavesUsd, 0);
});

test("a single-subject provenance call prices at the floor", () => {
  const q = quoteCounterparty({ tier: "provenance", subjectsSubmitted: 1, distinctCounterparties: 1 });
  assert.equal(q.priceMicro, String(X402_FLOOR_MICRO));
  assert.equal(q.priceUsd, 0.01);
  assert.equal(q.cogsUsd, 0);
});

test("incoherent counts are refused rather than priced", () => {
  assert.throws(() => quoteCounterparty({ tier: "cohort", subjectsSubmitted: 3, distinctCounterparties: 5 }));
  assert.throws(() => quoteCounterparty({ tier: "cohort", subjectsSubmitted: 0, distinctCounterparties: 0 }));
  assert.throws(() => quoteCounterparty({ tier: "nope" as never, subjectsSubmitted: 1, distinctCounterparties: 1 }));
});

test("every quote states the limits and claims no settled payment", () => {
  const q = quoteCounterparty({ tier: "cohort", subjectsSubmitted: 10, distinctCounterparties: 4 });
  assert.match(q.limitation, /not proof of first-party operation/);
  assert.match(q.limitation, /not the same as clean/);
  assert.match(q.settlement, /has not taken a payment/);
});

test("the sku card reports the market check that justifies the price", () => {
  const card = counterpartySkuCard();
  assert.equal(card.marketCheck.sellingCounterpartyProvenance, 0);
  assert.equal(card.marketCheck.sellingTextExtraction, 67);
  assert.equal(card.marketCheck.endpointsSwept, 412);
  assert.equal(card.canPay, false);
  // The one keyword match must stay visible with its reason, not vanish.
  assert.equal(card.marketCheck.counterpartyKeywordMatches, 1);
  assert.match(card.marketCheck.counterpartyExcludedOnReview, /not endpoint provenance/);
  // WHOIS is adjacent, and the card must say why it is not the same product.
  assert.ok(card.marketCheck.adjacentWhoisSellers > 0);
  assert.match(card.marketCheck.adjacentNote, /does not report/);
});

test("the published schemas constrain what an agent may send and expect", () => {
  assert.deepEqual(COUNTERPARTY_INPUT_SCHEMA.required, ["tier", "subject"]);
  assert.equal(COUNTERPARTY_INPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(COUNTERPARTY_INPUT_SCHEMA.properties.tier.enum, ["provenance", "posture", "cohort"]);
  const cls = COUNTERPARTY_OUTPUT_SCHEMA.properties.results.items.properties.classification;
  assert.ok(cls.enum.includes("undocumented"));
  assert.ok(COUNTERPARTY_OUTPUT_SCHEMA.required.includes("limitation"));
});
