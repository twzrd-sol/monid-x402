import { MONID_X402_RUNS_URL } from "./constants.js";
import {
  decodePaymentRequiredHeader,
  headerFromResponse
} from "./payment-required.js";
import { defaultPolicy, evaluatePaymentRequired } from "./policy.js";
import { ProbeError, type ProbeResult } from "./probe.js";
import { refuseReceipt } from "./receipt.js";
import type { RefuseReceipt, RunTarget } from "./types.js";

/** ULID used by Monid run ids (crockford, 26 chars). */
export const RUN_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function assertRunId(runId: string): string {
  const id = runId.trim().toUpperCase();
  if (!RUN_ID_RE.test(id)) {
    throw new Error(`invalid run id: ${runId}`);
  }
  return id;
}

export function retrieveUrl(runId: string): string {
  return `${MONID_X402_RUNS_URL}/${assertRunId(runId)}`;
}

export function retrieveTarget(runId: string): RunTarget {
  const id = assertRunId(runId);
  return {
    provider: "x402.monid.ai",
    endpoint: `/v1/runs/${id}`
  };
}

export async function probeRetrieve402(
  runId: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ProbeResult> {
  const id = assertRunId(runId);
  const url = retrieveUrl(id);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  const header = headerFromResponse(response.headers);
  if (response.status !== 402 || !header) {
    const body = await response.text();
    throw new ProbeError(
      `Expected HTTP 402 with PAYMENT-REQUIRED on GET ${url}, got ${response.status}: ${body.slice(0, 300)}`,
      response.status
    );
  }
  return {
    status: 402,
    url,
    target: retrieveTarget(id),
    paymentRequired: decodePaymentRequiredHeader(header),
    rawHeader: header
  };
}

export function retrieveRefuse(probe: ProbeResult): RefuseReceipt {
  const verdict = evaluatePaymentRequired(probe.paymentRequired, defaultPolicy());
  if (verdict.decision !== "refuse") {
    throw new Error(`Expected retrieve refuse, got ${verdict.decision}`);
  }
  return refuseReceipt(probe.target, verdict, probe.url);
}

export function parseRunsPath(urlPath: string): { kind: "list" } | { kind: "one"; runId: string } | { kind: "bad" } {
  const path = urlPath.split("?")[0] ?? "";
  if (path === "/v1/runs" || path === "/v1/runs/") return { kind: "list" };
  const match = path.match(/^\/v1\/runs\/([^/]+)$/);
  if (!match?.[1]) return { kind: "bad" };
  try {
    return { kind: "one", runId: assertRunId(match[1]) };
  } catch {
    return { kind: "bad" };
  }
}
