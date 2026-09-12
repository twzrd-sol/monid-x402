import assert from "node:assert/strict";
import { test } from "node:test";
import { brandRetrieveTarget, companyBriefPlan, homepageScrapeTarget, normalizeDomain } from "./brief.js";

test("brief normalizes urls to a bare domain", () => {
  assert.equal(normalizeDomain("https://www.Canva.com/pricing"), "canva.com");
});

test("brand retrieve uses context.dev queryParams.domain", () => {
  const target = brandRetrieveTarget("https://canva.com");
  assert.equal(target.provider, "context.dev");
  assert.equal(target.endpoint, "/brand/retrieve");
  assert.deepEqual(target.input, { queryParams: { domain: "canva.com" } });
});

test("homepage scrape uses queryParams.url", () => {
  const target = homepageScrapeTarget("canva.com");
  assert.deepEqual(target.input, { queryParams: { url: "https://canva.com" } });
});

test("company brief is two live x402 steps, not a catalog dump", () => {
  const plan = companyBriefPlan("canva.com");
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0]?.role, "brand");
  assert.equal(plan.steps[1]?.role, "homepage");
});
