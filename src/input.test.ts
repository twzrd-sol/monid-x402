import assert from "node:assert/strict";
import { test } from "node:test";
import { isClearingScrapeInput, scrapePayInput } from "./input.js";
import { homepageScrapeTarget } from "./brief.js";

test("queryParams.url is the scrape shape that clears the 402", () => {
  const input = scrapePayInput("https://example.com");
  assert.deepEqual(input, { queryParams: { url: "https://example.com" } });
  assert.equal(isClearingScrapeInput(input), true);
  assert.equal(isClearingScrapeInput(homepageScrapeTarget("example.com").input), true);
});

test("bare input.url is not treated as a successful pay shape", () => {
  assert.equal(isClearingScrapeInput({ url: "https://example.com" }), false);
  assert.equal(isClearingScrapeInput({}), false);
  assert.equal(isClearingScrapeInput(undefined), false);
});
