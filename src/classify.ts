import { MONID_X402_RUN_URL } from "./constants.js";
import { decodePaymentRequiredHeader, headerFromResponse } from "./payment-required.js";
import type { PaymentRequired, RunTarget, X402Accept } from "./types.js";

export type CatalogRow = {
  provider: string;
  endpoint: string;
  status: number;
  class: "x402" | "not_found" | "other";
  message?: string;
  payTo?: string;
  payTos?: string[];
  networks?: string[];
  amounts?: string[];
  assets?: string[];
};

export async function classifyRun(
  target: RunTarget,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<CatalogRow> {
  const response = await fetchImpl(MONID_X402_RUN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: target.provider,
      endpoint: target.endpoint,
      input: target.input ?? {}
    })
  });

  const header = headerFromResponse(response.headers);
  if (response.status === 402 && header) {
    const required: PaymentRequired = decodePaymentRequiredHeader(header);
    const accepts: X402Accept[] = required.accepts;
    return {
      provider: target.provider,
      endpoint: target.endpoint,
      status: 402,
      class: "x402",
      payTo: accepts[0]?.payTo,
      payTos: accepts.map((a) => a.payTo),
      networks: accepts.map((a) => a.network),
      amounts: accepts.map((a) => a.amount),
      assets: accepts.map((a) => a.asset)
    };
  }

  const body = await response.text();
  let message = body.slice(0, 240);
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) message = parsed.message;
  } catch {
    /* keep slice */
  }

  return {
    provider: target.provider,
    endpoint: target.endpoint,
    status: response.status,
    class: response.status === 404 ? "not_found" : "other",
    message
  };
}
