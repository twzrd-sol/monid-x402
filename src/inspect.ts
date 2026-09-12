import { MONID_API_URL } from "./constants.js";
import type { RunTarget } from "./types.js";

export type InspectedPrice = {
  provider: string;
  endpoint: string;
  rawType: string;
  currency: string;
  baseFeeUsd: number;
};

export async function inspectEndpoint(
  target: RunTarget,
  apiKey = process.env.MONID_API_KEY,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<InspectedPrice> {
  if (!apiKey) {
    throw new Error("MONID_API_KEY is required for inspect. The 402 probe does not need it.");
  }
  const response = await fetchImpl(`${MONID_API_URL}/inspect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ provider: target.provider, endpoint: target.endpoint })
  });
  const payload = (await response.json()) as {
    provider?: string;
    endpoint?: string;
    price?: {
      type?: string;
      amount?: { value?: number; currency?: string };
    };
    message?: string;
  };
  if (!response.ok) {
    throw new Error(`inspect ${response.status}: ${payload.message ?? "failed"}`);
  }
  const amount = payload.price?.amount;
  if (typeof amount?.value !== "number" || !amount.currency) {
    throw new Error("inspect omitted PER_CALL USD price.");
  }
  return {
    provider: payload.provider ?? target.provider,
    endpoint: payload.endpoint ?? target.endpoint,
    rawType: String(payload.price?.type ?? "UNKNOWN"),
    currency: amount.currency,
    baseFeeUsd: amount.value
  };
}
