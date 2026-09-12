import { DEFAULT_ENDPOINT, DEFAULT_PROVIDER } from "./constants.js";

export const LISTEN_DECISION_SCHEMA = "monid-x402.listen-decision.v1" as const;
export const DEFAULT_LISTEN_BASE = "http://127.0.0.1:8788";

export type ListenRefusePacket = {
  schema: string;
  rail: string;
  decision: "refuse";
  code: "over_cap";
  signer_invocation_count: 0;
  usdc_spent: 0;
  resource?: string;
  provider?: string;
  endpoint?: string;
  reason?: string;
};

export type ListenDecisionProof = {
  schema: typeof LISTEN_DECISION_SCHEMA;
  listen: string;
  httpStatus: 402;
  ok: true;
  canPay: false;
  nextGate: "over_cap";
  code: "over_cap";
  signer_invocation_count: 0;
  usdc_spent: 0;
  packet: ListenRefusePacket;
};

export type ProveListenDecisionOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export function defaultListenBase(): string {
  return process.env.MONID_API_BASE_URL ?? DEFAULT_LISTEN_BASE;
}

export function assertListenOverCapRefuse(status: number, body: unknown): ListenRefusePacket {
  if (status !== 402) {
    throw new Error(`listen hold expected HTTP 402, got ${status}`);
  }
  if (!body || typeof body !== "object") {
    throw new Error("listen hold expected a JSON refuse packet");
  }
  const rec = body as Record<string, unknown>;
  if (rec.decision !== "refuse" || rec.code !== "over_cap") {
    throw new Error(
      `listen hold expected refuse over_cap, got decision=${String(rec.decision)} code=${String(rec.code)}`
    );
  }
  if (rec.signer_invocation_count !== 0) {
    throw new Error(`listen hold expected signer_invocation_count 0, got ${String(rec.signer_invocation_count)}`);
  }
  if (rec.usdc_spent !== 0) {
    throw new Error(`listen hold expected usdc_spent 0, got ${String(rec.usdc_spent)}`);
  }
  if (typeof rec.rail !== "string" || typeof rec.schema !== "string") {
    throw new Error("listen hold expected schema and rail");
  }
  return {
    schema: rec.schema,
    rail: rec.rail,
    decision: "refuse",
    code: "over_cap",
    signer_invocation_count: 0,
    usdc_spent: 0,
    ...(typeof rec.resource === "string" ? { resource: rec.resource } : {}),
    ...(typeof rec.provider === "string" ? { provider: rec.provider } : {}),
    ...(typeof rec.endpoint === "string" ? { endpoint: rec.endpoint } : {}),
    ...(typeof rec.reason === "string" ? { reason: rec.reason } : {})
  };
}

export function assertNotStaleFilm(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`listen hold expected a URL, got ${baseUrl}`);
  }
  if (url.port === "8787") {
    throw new Error("127.0.0.1:8787 is the stale film. Use MONID_API_BASE_URL=http://127.0.0.1:8788");
  }
}

export async function proveListenDecision(
  options: ProveListenDecisionOptions = {}
): Promise<ListenDecisionProof> {
  const listen = (options.baseUrl ?? defaultListenBase()).replace(/\/$/, "");
  assertNotStaleFilm(listen);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(`${listen}/v1/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: DEFAULT_PROVIDER,
      endpoint: DEFAULT_ENDPOINT,
      input: {}
    })
  });
  const body: unknown = await response.json();
  const packet = assertListenOverCapRefuse(response.status, body);
  return {
    schema: LISTEN_DECISION_SCHEMA,
    listen,
    httpStatus: 402,
    ok: true,
    canPay: false,
    nextGate: "over_cap",
    code: "over_cap",
    signer_invocation_count: 0,
    usdc_spent: 0,
    packet
  };
}
