import type { RunTarget } from "./types.js";

export const BRIEF_BRAND_PROVIDER = "context.dev";
export const BRIEF_BRAND_ENDPOINT = "/brand/retrieve";
export const BRIEF_SCRAPE_PROVIDER = "context.dev";
export const BRIEF_SCRAPE_ENDPOINT = "/web/scrape/markdown";

export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase();
}

export function brandRetrieveTarget(domain: string): RunTarget {
  const host = normalizeDomain(domain);
  return {
    provider: BRIEF_BRAND_PROVIDER,
    endpoint: BRIEF_BRAND_ENDPOINT,
    input: { queryParams: { domain: host } }
  };
}

export function homepageScrapeTarget(domain: string): RunTarget {
  const host = normalizeDomain(domain);
  return {
    provider: BRIEF_SCRAPE_PROVIDER,
    endpoint: BRIEF_SCRAPE_ENDPOINT,
    input: { queryParams: { url: `https://${host}` } }
  };
}

export type BriefStep = {
  role: "brand" | "homepage";
  target: RunTarget;
  why: string;
};

export function companyBriefPlan(domain: string): { domain: string; steps: BriefStep[] } {
  const host = normalizeDomain(domain);
  return {
    domain: host,
    steps: [
      {
        role: "brand",
        target: brandRetrieveTarget(host),
        why: "Resolve brand identity from a domain. Highest-frequency agent job on this catalog."
      },
      {
        role: "homepage",
        target: homepageScrapeTarget(host),
        why: "Read the homepage as markdown after the domain is the join key."
      }
    ]
  };
}
