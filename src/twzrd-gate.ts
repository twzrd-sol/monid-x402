/**
 * TWZRD wash seat on this paying client, after local policy.
 *
 * Published twzrd-x402-gate@0.9.5. This rail is EVM only (Base / Monad).
 * createTwzrdBeforePaymentHook → twzrdApprovePayment treats eip155 as
 * unscored: observe mode skips POST /v1/intel/preflight and does one
 * GET merchant_card/{payTo}. wash_flagged=true aborts (twzrd_wash_flagged).
 * HTTP 503 / network / non-JSON become allow inside the package —
 * TWZRD_FAIL_OPEN=false cannot reach that. A 200 card that is missing,
 * partial, or stale coverage is not clean: we refuse twzrd_wash_unknown
 * after the package allows. That tighten is ours; 0.9.5 does not.
 *
 * 0.9.5's merchant_card GET sends Accept only. We wrap fetch so intel
 * lookups carry X-Twzrd-Caller monid-x402/<version>@0.9.5,
 * X-TWZRD-Integration monid-x402/<version>, and X-TWZRD-Run-Id.
 *
 * Default on. TWZRD_AUTO_GATE=0 or TWZRD_GATE_ENABLED=false disables.
 * Our 2s wrapper fail-opens on hang unless TWZRD_FAIL_OPEN=false.
 */

import { randomUUID } from "node:crypto";
import { createTwzrdBeforePaymentHook } from "twzrd-x402-gate";
import { PACKAGE_VERSION, TWZRD_GATE_PACKAGE, TWZRD_GATE_PIN } from "./constants.js";
import { createBeforePaymentCreationHook } from "./policy.js";
import type { PaymentRequired, Policy } from "./types.js";

const TRUTHY_OFF = new Set(["0", "false", "no", "off"]);

export const TWZRD_GATE_TIMEOUT_MS = 2_000;
export const INTEL_BASE_DEFAULT = "https://intel.twzrd.xyz";

export type BeforePaymentCreationResult = void | { abort: true; reason: string };

export type BeforePaymentCreationContext = {
  selectedRequirements?: Record<string, unknown>;
  paymentRequired?: PaymentRequired;
};

export type TwzrdHook = (
  requirements: Record<string, unknown>,
  context?: unknown
) => Promise<BeforePaymentCreationResult>;

export type GateLog = Pick<Console, "log" | "warn">;

export type MerchantCardCoverage = "flagged" | "full" | "unknown";

export type WashSighting =
  | { kind: "card"; body: Record<string, unknown> }
  | { kind: "lookup_failed" };

/**
 * Wallet-keyed. Same on EVM and Solana. Full coverage is wash_flagged=false,
 * wash_confidence=full, ring evaluated, not stale. Anything else on a 200
 * card is unknown — not clean.
 */
export function merchantCardCoverage(body: Record<string, unknown>): MerchantCardCoverage {
  if (body.wash_flagged === true) return "flagged";
  if (body.wash_flagged !== false) return "unknown";
  if (body.wash_confidence !== "full") return "unknown";
  if (body.ring_evaluated === false) return "unknown";
  if (body.wash_stale === true) return "unknown";
  return "full";
}

export function refuseCodeFromReason(reason: string): string {
  if (reason.includes("twzrd_wash_unknown")) return "twzrd_wash_unknown";
  if (reason.includes("twzrd_wash_flagged")) return "twzrd_wash_flagged";
  if (reason.includes("did not answer")) return "twzrd_gate_timeout";
  return "twzrd_gate_refuse";
}

function normalizeFlag(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}

/** Default on. An explicit disable on either flag wins. */
export function isTwzrdGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const auto = normalizeFlag(env.TWZRD_AUTO_GATE);
  const gate = normalizeFlag(env.TWZRD_GATE_ENABLED);
  if ((auto !== undefined && TRUTHY_OFF.has(auto)) || (gate !== undefined && TRUTHY_OFF.has(gate))) {
    return false;
  }
  return true;
}

/** Default true. TWZRD_FAIL_OPEN=false only covers our wrapper hang/throw. */
export function twzrdGateFailOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = normalizeFlag(env.TWZRD_FAIL_OPEN);
  return !(raw !== undefined && TRUTHY_OFF.has(raw));
}

export function twzrdGateTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = normalizeFlag(env.TWZRD_GATE_TIMEOUT_MS);
  if (raw === undefined) return TWZRD_GATE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TWZRD_GATE_TIMEOUT_MS;
}

export function twzrdGateAttribution(
  _env: NodeJS.ProcessEnv = process.env,
  runId: () => string = randomUUID
): { integration: string; runId: string; caller: string } {
  const integration = `monid-x402/${PACKAGE_VERSION}`;
  const id = runId();
  return {
    integration,
    runId: id,
    caller: `${integration}@${TWZRD_GATE_PIN}`
  };
}

export function attributedIntelFetch(
  attr: { integration: string; runId: string; caller: string },
  intelBase = INTEL_BASE_DEFAULT,
  onSighting?: (sighting: WashSighting) => void,
  baseFetch: typeof fetch = (...args) => globalThis.fetch(...args)
): typeof fetch {
  const base = intelBase.replace(/\/+$/, "");
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(base)) {
      return baseFetch(input, init);
    }
    const headers = new Headers(init?.headers);
    headers.set("X-TWZRD-Client", `${TWZRD_GATE_PACKAGE}/${TWZRD_GATE_PIN}`);
    headers.set("X-Twzrd-Caller", attr.caller);
    headers.set("X-TWZRD-Integration", attr.integration);
    headers.set("X-TWZRD-Run-Id", attr.runId);
    let response: Response;
    try {
      response = await baseFetch(input, { ...init, headers });
    } catch (error) {
      onSighting?.({ kind: "lookup_failed" });
      throw error;
    }
    if (url.includes("/v1/intel/merchant_card/")) {
      if (!response.ok) {
        onSighting?.({ kind: "lookup_failed" });
      } else {
        try {
          const body = (await response.clone().json()) as unknown;
          if (body && typeof body === "object" && !Array.isArray(body)) {
            onSighting?.({ kind: "card", body: body as Record<string, unknown> });
          } else {
            onSighting?.({ kind: "lookup_failed" });
          }
        } catch {
          onSighting?.({ kind: "lookup_failed" });
        }
      }
    }
    return response;
  };
}

export function unknownWashAbort(payTo: string): { abort: true; reason: string } {
  return { abort: true, reason: `[twzrd] twzrd_wash_unknown payTo=${payTo}` };
}

export function flaggedWashAbort(payTo: string): { abort: true; reason: string } {
  return { abort: true, reason: `[twzrd] twzrd_wash_flagged payTo=${payTo}` };
}

/**
 * Probe-time wash, no wallet. Lookup failure allows (package-internal
 * fail-open). A 200 card with missing/partial/stale coverage refuses.
 */
export async function evaluateWashPayTo(
  payTo: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    runId?: () => string;
  }
): Promise<BeforePaymentCreationResult> {
  const env = options?.env ?? process.env;
  if (!isTwzrdGateEnabled(env)) return undefined;
  const intelBase = (env.TWZRD_INTEL_BASE ?? INTEL_BASE_DEFAULT).replace(/\/+$/, "");
  const attr = twzrdGateAttribution(env, options?.runId);
  let sighting: WashSighting | undefined;
  const stamped = attributedIntelFetch(
    attr,
    intelBase,
    (next) => {
      sighting = next;
    },
    options?.fetch ?? ((input, init) => globalThis.fetch(input, init))
  );
  try {
    await stamped(`${intelBase}/v1/intel/merchant_card/${encodeURIComponent(payTo)}`, {
      method: "GET",
      headers: { accept: "application/json" }
    });
  } catch {
    return undefined;
  }
  if (!sighting || sighting.kind === "lookup_failed") return undefined;
  const coverage = merchantCardCoverage(sighting.body);
  if (coverage === "flagged") return flaggedWashAbort(payTo);
  if (coverage === "unknown") return unknownWashAbort(payTo);
  return undefined;
}

const TIMED_OUT = { __twzrdTimedOut: true } as const;

export async function runTwzrdGateWithTimeout(
  run: () => Promise<BeforePaymentCreationResult>,
  opts: { timeoutMs: number; failOpen: boolean; log?: GateLog }
): Promise<BeforePaymentCreationResult> {
  const log = opts.log ?? console;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race<
      BeforePaymentCreationResult | typeof TIMED_OUT | { __twzrdError: unknown }
    >([
      Promise.resolve()
        .then(run)
        .catch((err: unknown) => ({ __twzrdError: err })),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), opts.timeoutMs);
      })
    ]);
    if (raced === TIMED_OUT) {
      return decideOnGateFailure(`did not answer within ${opts.timeoutMs}ms`, opts.failOpen, log);
    }
    if (raced && typeof raced === "object" && "__twzrdError" in raced) {
      const err = raced.__twzrdError;
      const msg = err instanceof Error ? err.message : String(err);
      return decideOnGateFailure(`threw: ${msg.slice(0, 120)}`, opts.failOpen, log);
    }
    return raced as BeforePaymentCreationResult;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function decideOnGateFailure(
  what: string,
  failOpen: boolean,
  log: GateLog
): BeforePaymentCreationResult {
  const reason = `twzrd gate ${what}`;
  if (failOpen) {
    log.warn(`[monid-x402] ${reason} — proceeding. Local policy still applied.`);
    return undefined;
  }
  log.warn(`[monid-x402] ${reason} — refusing (TWZRD_FAIL_OPEN=false).`);
  return { abort: true, reason };
}

export function composeBeforePaymentCreation(
  policy: Policy,
  options?: {
    env?: NodeJS.ProcessEnv;
    log?: GateLog;
    runId?: () => string;
    createHook?: () => TwzrdHook;
  }
): (ctx: BeforePaymentCreationContext) => Promise<BeforePaymentCreationResult> {
  const env = options?.env ?? process.env;
  const log = options?.log ?? console;
  const local = createBeforePaymentCreationHook(policy);
  const attr = twzrdGateAttribution(env, options?.runId);
  const timeoutMs = twzrdGateTimeoutMs(env);
  const failOpen = twzrdGateFailOpen(env);
  const intelBase = (env.TWZRD_INTEL_BASE ?? INTEL_BASE_DEFAULT).replace(/\/+$/, "");
  const seen: { current?: WashSighting } = {};
  const hook = options?.createHook
    ? options.createHook()
    : createTwzrdBeforePaymentHook({
        refuseWashFlagged: true,
        unsupportedNetworkMode: "observe",
        attribution: { integration: attr.integration, runId: attr.runId },
        fetch: attributedIntelFetch(attr, intelBase, (next) => {
          seen.current = next;
        })
      });

  return async (ctx) => {
    const first = await local(ctx);
    if (first && "abort" in first && first.abort) return first;
    if (!isTwzrdGateEnabled(env)) return undefined;
    const selected = ctx.selectedRequirements ?? {};
    delete seen.current;
    const result = await runTwzrdGateWithTimeout(() => hook(selected), {
      timeoutMs,
      failOpen,
      log
    });
    if (result && "abort" in result && result.abort) return result;
    const payTo = String(selected.payTo ?? selected.pay_to ?? "");
    const sighting = seen.current as WashSighting | undefined;
    if (sighting && sighting.kind === "card" && merchantCardCoverage(sighting.body) === "unknown") {
      return unknownWashAbort(payTo || "unknown");
    }
    return result;
  };
}
