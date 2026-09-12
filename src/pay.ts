import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { MONID_X402_RUN_URL, NETWORK_BASE, NETWORK_MONAD } from "./constants.js";
import { defaultPolicy, evaluatePaymentRequired } from "./policy.js";
import { defaultTarget, probeRun402 } from "./probe.js";
import { paidReceipt, payFailedReceipt, refuseReceipt } from "./receipt.js";
import {
  composeBeforePaymentCreation,
  evaluateWashPayTo,
  refuseCodeFromReason
} from "./twzrd-gate.js";
import type {
  PaidReceipt,
  PayFailedReceipt,
  Policy,
  PolicyDecision,
  RefuseReceipt,
  RunTarget,
  X402Accept
} from "./types.js";

export class PayGatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayGatedError";
  }
}

export function assertPayAuthorized(input: {
  confirmSpend: boolean;
  privateKey?: string;
}): void {
  if (input.confirmSpend !== true) {
    throw new PayGatedError(
      "Pay is gated. Refuse is the default. Re-run with --confirm-spend and PRIVATE_KEY after a refuse receipt exists."
    );
  }
  if (!input.privateKey?.startsWith("0x")) {
    throw new PayGatedError("PRIVATE_KEY is required for pay. Do not commit it.");
  }
}

export type PayOptions = {
  confirmSpend: true;
  /** Required only after policy allows. Refuse does not need a wallet. */
  privateKey?: `0x${string}`;
  policy?: Policy;
  target?: RunTarget;
  fetch?: typeof fetch;
};

export type PayResult =
  | { kind: "refused"; receipt: RefuseReceipt }
  | { kind: "paid"; receipt: PaidReceipt; body: unknown }
  | { kind: "failed"; receipt: PayFailedReceipt };

function redact(reason: string): string {
  return reason.replace(/0x[a-fA-F0-9]{8,}/g, "0x…");
}

function failCode(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes("insufficient") || lower.includes("exceeds the balance")) {
    return "insufficient_funds";
  }
  return "pay_failed";
}

function buildPaidFetch(
  privateKey: `0x${string}`,
  policy: Policy,
  fetchImpl: typeof fetch
): typeof fetch {
  const account = privateKeyToAccount(privateKey);
  const client = new x402Client()
    .register(NETWORK_BASE, new ExactEvmScheme(account))
    .register(NETWORK_MONAD, new ExactEvmScheme(account))
    .onBeforePaymentCreation(composeBeforePaymentCreation(policy));
  return wrapFetchWithPayment(fetchImpl, client);
}

function washRefuseReceipt(
  target: RunTarget,
  verdict: Extract<PolicyDecision, { decision: "allow" }>,
  reason: string
): RefuseReceipt {
  return refuseReceipt(
    target,
    {
      decision: "refuse",
      selected: verdict.selected,
      reason,
      code: refuseCodeFromReason(reason)
    },
    MONID_X402_RUN_URL
  );
}

/**
 * Pay path. Local policy, then wash, then a key. Wash refuse does not
 * need a wallet. Hook stays registered so a swapped offer still cannot sign.
 */
export async function payRun(options: PayOptions): Promise<PayResult> {
  if (options.confirmSpend !== true) {
    throw new PayGatedError("Pay requires confirmSpend: true.");
  }
  const target = options.target ?? defaultTarget();
  const policy = options.policy ?? defaultPolicy();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const probe = await probeRun402(target, fetchImpl);
  const verdict = evaluatePaymentRequired(probe.paymentRequired, policy);
  if (verdict.decision === "refuse") {
    return {
      kind: "refused",
      receipt: refuseReceipt(target, verdict, MONID_X402_RUN_URL)
    };
  }

  const wash = await evaluateWashPayTo(verdict.selected.payTo, { fetch: fetchImpl });
  if (wash && "abort" in wash && wash.abort) {
    return {
      kind: "refused",
      receipt: washRefuseReceipt(target, verdict, wash.reason)
    };
  }

  const key = options.privateKey;
  if (!key?.startsWith("0x") || key.length < 66) {
    throw new PayGatedError("Pay requires a 0x PRIVATE_KEY after policy allow. Do not invent one.");
  }

  const selected: X402Accept = verdict.selected;
  try {
    const paidFetch = buildPaidFetch(key, policy, fetchImpl);
    const response = await paidFetch(MONID_X402_RUN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: target.provider,
        endpoint: target.endpoint,
        input: target.input ?? {}
      })
    });
    const body = await response.json().catch(() => null);
    const paymentResponse =
      response.headers.get("PAYMENT-RESPONSE") ??
      response.headers.get("payment-response") ??
      response.headers.get("Payment-Response");
    if (response.status === 402 || response.status >= 400) {
      const snippet = redact(JSON.stringify(body) ?? "").slice(0, 240);
      return {
        kind: "failed",
        receipt: payFailedReceipt(
          target,
          selected,
          MONID_X402_RUN_URL,
          `upstream HTTP ${response.status} after signer construct; body=${snippet}`,
          response.status === 402 ? "still_402" : "upstream_error"
        )
      };
    }
    if (!paymentResponse) {
      return {
        kind: "failed",
        receipt: payFailedReceipt(
          target,
          selected,
          MONID_X402_RUN_URL,
          `upstream HTTP ${response.status} after signer construct; missing PAYMENT-RESPONSE`,
          "no_payment_response"
        )
      };
    }
    return {
      kind: "paid",
      receipt: paidReceipt(target, selected, MONID_X402_RUN_URL, response.status, paymentResponse),
      body
    };
  } catch (error) {
    const reason = redact(error instanceof Error ? error.message : String(error));
    const aborted = reason.match(/Payment creation aborted:\s*(.+)$/);
    if (aborted?.[1] && /twzrd_wash|twzrd gate/.test(aborted[1])) {
      return {
        kind: "refused",
        receipt: washRefuseReceipt(target, verdict, aborted[1])
      };
    }
    return {
      kind: "failed",
      receipt: payFailedReceipt(target, selected, MONID_X402_RUN_URL, reason, failCode(reason))
    };
  }
}
