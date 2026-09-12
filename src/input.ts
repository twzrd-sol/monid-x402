/**
 * Shape that cleared the live 402 on context.dev /web/scrape/markdown.
 * Bare `input.url` is a 400 from the host — not a successful pay.
 */
export function scrapePayInput(url: string): { queryParams: { url: string } } {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("scrape URL must be http(s)");
  }
  return { queryParams: { url } };
}

export function isClearingScrapeInput(input: Record<string, unknown> | undefined): boolean {
  if (!input) return false;
  const qp = input.queryParams;
  if (!qp || typeof qp !== "object" || Array.isArray(qp)) return false;
  const url = (qp as Record<string, unknown>).url;
  return typeof url === "string" && /^https?:\/\//i.test(url);
}
