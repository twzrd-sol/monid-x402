import type { PaymentRequired, X402Accept } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Payment-Required omitted ${key}.`);
  }
  return value;
}

function parseAccept(raw: unknown): X402Accept {
  if (!isRecord(raw)) throw new Error("accepts[] entry was not an object.");
  return {
    scheme: requireString(raw, "scheme"),
    network: requireString(raw, "network"),
    amount: requireString(raw, "amount"),
    asset: requireString(raw, "asset"),
    payTo: requireString(raw, "payTo"),
    ...(typeof raw.maxTimeoutSeconds === "number"
      ? { maxTimeoutSeconds: raw.maxTimeoutSeconds }
      : {}),
    ...(isRecord(raw.extra) ? { extra: raw.extra } : {})
  };
}

export function parsePaymentRequired(payload: unknown): PaymentRequired {
  if (!isRecord(payload)) throw new Error("Payment-Required body was not an object.");
  const version = payload.x402Version;
  if (version !== 2) {
    throw new Error(`Unsupported x402Version ${String(version)}; expected 2.`);
  }
  if (!isRecord(payload.resource)) {
    throw new Error("Payment-Required omitted resource.");
  }
  if (!Array.isArray(payload.accepts) || payload.accepts.length === 0) {
    throw new Error("Payment-Required omitted accepts[].");
  }
  return {
    x402Version: 2,
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
    resource: {
      url: requireString(payload.resource, "url"),
      ...(typeof payload.resource.description === "string"
        ? { description: payload.resource.description }
        : {}),
      ...(typeof payload.resource.mimeType === "string"
        ? { mimeType: payload.resource.mimeType }
        : {})
    },
    accepts: payload.accepts.map(parseAccept),
    ...(isRecord(payload.extensions) ? { extensions: payload.extensions } : {})
  };
}

export function decodePaymentRequiredHeader(header: string): PaymentRequired {
  const trimmed = header.trim();
  if (!trimmed) throw new Error("Empty PAYMENT-REQUIRED header.");
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
  } catch {
    throw new Error("PAYMENT-REQUIRED header was not base64 JSON.");
  }
  return parsePaymentRequired(json);
}

export function headerFromResponse(headers: Headers): string | null {
  return (
    headers.get("PAYMENT-REQUIRED") ??
    headers.get("payment-required") ??
    headers.get("Payment-Required")
  );
}

export function amountMicro(accept: X402Accept): bigint {
  if (!/^\d+$/.test(accept.amount)) {
    throw new Error(`Non-integer amount '${accept.amount}'.`);
  }
  return BigInt(accept.amount);
}

export function usdcFromMicro(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

export type PaymentProof = {
  success: boolean;
  payer: string | null;
  transaction: string | null;
  network: string | null;
};

/** Decode x402 PAYMENT-RESPONSE. Fail closed to null — never throw on a bad header. */
export function decodePaymentResponse(header: string | null): PaymentProof | null {
  if (!header) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (!isRecord(parsed)) return null;
    return {
      success: parsed.success === true,
      payer: typeof parsed.payer === "string" ? parsed.payer : null,
      transaction: typeof parsed.transaction === "string" ? parsed.transaction : null,
      network: typeof parsed.network === "string" ? parsed.network : null
    };
  } catch {
    return null;
  }
}
