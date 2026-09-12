import {
  createSIWxPayload,
  encodeSIWxHeader,
  SIGN_IN_WITH_X
} from "@x402/extensions/sign-in-with-x";
import { privateKeyToAccount } from "viem/accounts";
import { MONID_X402_RUNS_URL, NETWORK_BASE } from "./constants.js";
import { PayGatedError } from "./pay.js";
import {
  decodePaymentRequiredHeader,
  headerFromResponse
} from "./payment-required.js";
import { defaultPolicy, evaluatePaymentRequired, hasSiwxExtension } from "./policy.js";
import { ProbeError, type ProbeResult } from "./probe.js";
import { payFailedReceipt, refuseReceipt, retrievedReceipt } from "./receipt.js";
import type { PaymentRequired, PayFailedReceipt, RefuseReceipt, RetrievedReceipt, RunTarget } from "./types.js";

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

export function selectSiwxChain(required: PaymentRequired): { chainId: string; type: "eip191" | "ed25519" } {
  if (!hasSiwxExtension(required)) {
    throw new Error("PAYMENT-REQUIRED has no sign-in-with-x extension");
  }
  const ext = required.extensions?.[SIGN_IN_WITH_X] as {
    supportedChains?: { chainId?: string; type?: string }[];
  };
  const chains = ext.supportedChains ?? [];
  const chosen =
    chains.find((row) => row.chainId === NETWORK_BASE) ??
    chains.find((row) => String(row.chainId).startsWith("eip155:"));
  if (!chosen?.chainId) {
    throw new Error("SIWX extension has no EVM supportedChains entry");
  }
  return {
    chainId: chosen.chainId,
    type: chosen.type === "ed25519" ? "ed25519" : "eip191"
  };
}

export type RetrieveSignedResult =
  | { kind: "retrieved"; receipt: RetrievedReceipt; body: unknown }
  | { kind: "failed"; receipt: PayFailedReceipt };

export async function retrieveSigned(options: {
  runId: string;
  confirmSign: boolean;
  privateKey?: `0x${string}`;
  fetchImpl?: typeof fetch;
}): Promise<RetrieveSignedResult> {
  if (options.confirmSign !== true) {
    throw new PayGatedError(
      "SIWX retrieve sign is gated. Re-run with --confirm-sign (or --confirm-spend) and a key."
    );
  }
  const key = options.privateKey;
  if (!key?.startsWith("0x") || key.length < 66) {
    throw new PayGatedError("SIWX retrieve requires a 0x key after confirm. Do not invent one.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const probe = await probeRetrieve402(options.runId, fetchImpl);
  const ext = probe.paymentRequired.extensions?.[SIGN_IN_WITH_X] as {
    info?: {
      domain: string;
      uri: string;
      version: string;
      nonce: string;
      issuedAt: string;
      statement?: string;
      expirationTime?: string;
      notBefore?: string;
      requestId?: string;
      resources?: string[];
    };
  };
  if (!ext?.info?.uri || !ext.info.nonce) {
    throw new Error("SIWX extension info is missing uri or nonce");
  }
  const chain = selectSiwxChain(probe.paymentRequired);
  const account = privateKeyToAccount(key);
  const payload = await createSIWxPayload(
    {
      ...ext.info,
      chainId: chain.chainId,
      type: chain.type
    },
    account,
    ext.info.uri
  );
  const siwxHeader = encodeSIWxHeader(payload);
  const response = await fetchImpl(probe.url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "SIGN-IN-WITH-X": siwxHeader
    }
  });
  const body = await response.json().catch(() => null);
  if (response.status < 200 || response.status >= 300) {
    const snippet = JSON.stringify(body ?? "").slice(0, 240);
    return {
      kind: "failed",
      receipt: payFailedReceipt(
        probe.target,
        null,
        probe.url,
        `SIWX retrieve HTTP ${response.status}; body=${snippet}`,
        response.status === 402 ? "siwx_still_402" : "siwx_upstream_error"
      )
    };
  }
  return {
    kind: "retrieved",
    receipt: retrievedReceipt(
      probe.target,
      probe.url,
      assertRunId(options.runId),
      account.address,
      chain.chainId,
      response.status
    ),
    body
  };
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
