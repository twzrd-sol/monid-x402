import { DEFAULT_ENDPOINT, DEFAULT_PROVIDER, MONID_X402_RUN_URL } from "./constants.js";
import {
  decodePaymentRequiredHeader,
  headerFromResponse
} from "./payment-required.js";
import type { PaymentRequired, RunTarget } from "./types.js";

export class ProbeError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ProbeError";
  }
}

export type ProbeResult = {
  status: number;
  url: string;
  target: RunTarget;
  paymentRequired: PaymentRequired;
  rawHeader: string;
};

export function defaultTarget(overrides: Partial<RunTarget> = {}): RunTarget {
  return {
    provider: DEFAULT_PROVIDER,
    endpoint: DEFAULT_ENDPOINT,
    input: {},
    ...overrides
  };
}

export async function probeRun402(
  target: RunTarget = defaultTarget(),
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ProbeResult> {
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
  if (response.status !== 402 || !header) {
    const body = await response.text();
    throw new ProbeError(
      `Expected HTTP 402 with PAYMENT-REQUIRED, got ${response.status}: ${body.slice(0, 300)}`,
      response.status
    );
  }

  return {
    status: 402,
    url: MONID_X402_RUN_URL,
    target,
    paymentRequired: decodePaymentRequiredHeader(header),
    rawHeader: header
  };
}
